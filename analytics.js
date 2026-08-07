/**
 * analytics.js — PostHog init + event layer for /prehog.
 *
 * Deliberately separate from prehog.js: this file is the only place that
 * knows PostHog exists. Navigation logic in prehog.js dispatches plain
 * DOM CustomEvents on `document`; this file listens and translates them
 * into the event spec documented in docs/analytics.md. If PostHog fails
 * to load, is blocked, or has no token configured, the deck still works —
 * this script only ever *adds* behavior, never gates it.
 *
 * Test determinism: Playwright specs set `window.__PREHOG_TEST_STUB__ = true`
 * and install `window.posthog` themselves via page.addInitScript() *before*
 * this deferred script runs. When that flag is present we skip loading the
 * real snippet and call init()/capture() straight against the test stub —
 * no network involved. See tests/prehog.spec.js.
 */
(function () {
  'use strict';

  // Replace with the real PostHog project token before the first production
  // deploy. Until then this file loads and does nothing observable — the
  // deck is fully functional with analytics absent. See docs/decisions.md.
  var PREHOG_CONFIG = window.__PREHOG_CONFIG__ || {};
  var POSTHOG_TOKEN = PREHOG_CONFIG.posthogToken || '';
  var POSTHOG_HOST = PREHOG_CONFIG.posthogHost || 'https://us.i.posthog.com';

  // Pinned to a specific published version rather than an unpinned "latest"
  // tag, so this page's behavior can't change out from under it on a day
  // nobody touched this repo. Bump deliberately.
  var POSTHOG_SDK_URL = PREHOG_CONFIG.posthogSdkUrl
    || 'https://cdn.jsdelivr.net/npm/posthog-js@1.413.3/dist/module.js';

  // Gates the recursive live-event-log panel (see docs/decisions.md for why
  // this is a genuine flag, not decoration). Create it in the PostHog
  // dashboard (Feature Flags → New) with this exact key to turn the panel
  // on for some or all visitors; it defaults to hidden until you do.
  var RECURSIVE_PANEL_FLAG = 'prehog-recursive-panel';

  var seenSlides = new Set();
  var startedAt = Date.now();
  var capturedLog = []; // { event, atMs } — only events actually sent to PostHog
  var recursivePanelEnabled = false;
  var surveyShown = false;
  var surveySubmitted = false;
  var currentSurvey = null;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // Loads PostHog's own published ES module build (posthog-js's
  // dist/module.js — the same package used by `import posthog from
  // "posthog-js"`) from jsDelivr, which the host site's CSP already allows
  // in script-src. A dynamic import() is used rather than a classic
  // `<script src>` tag: module.js uses `export default`, which is a syntax
  // error outside an actual module context, but dynamic import() works
  // from any script. This sidesteps PostHog's array.js/array.full.js
  // "snippet" bootstrap entirely — that format expects a specific
  // pre-existing window.posthog queue-stub shape that isn't documented
  // anywhere reproducible, which is what broke the two earlier attempts
  // at this (see git history). The ESM default export is unambiguous: it's
  // always a ready-to-use PostHog instance with a real .init() method.
  function loadSnippet(cb) {
    if (window.posthog && typeof window.posthog.init === 'function') { cb(); return; }

    import(/* webpackIgnore: true */ POSTHOG_SDK_URL)
      .then(function (module) {
        window.posthog = module.default;
        cb();
      })
      .catch(function (err) {
        console.warn('[prehog] PostHog module failed to load; analytics disabled for this session.', err);
      });
  }

  function initPostHog() {
    var usingStub = PREHOG_CONFIG.testStub === true || window.__PREHOG_TEST_STUB__ === true;

    if (usingStub) {
      if (window.posthog && typeof window.posthog.init === 'function') {
        window.posthog.init('test-stub', { api_host: POSTHOG_HOST, defaults: '2026-05-30' });
      }
      wireEvents();
      initRecursivePanel();
      return;
    }

    if (!POSTHOG_TOKEN) {
      // No token configured yet — no-op, deck stays fully functional.
      console.info('[prehog] PostHog token not configured; analytics disabled.');
      return;
    }

    loadSnippet(function () {
      window.posthog.init(POSTHOG_TOKEN, {
        api_host: POSTHOG_HOST,
        defaults: '2026-05-30',
        capture_pageview: true,  // single static page — 'history_change' would never fire here
        capture_exceptions: true, // unhandled errors / unhandled promise rejections only — this page has no console.error call sites worth capturing separately
        respect_dnt: true,
        persistence: 'localStorage+cookie',
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: '[data-ph-mask]'
        }
      });
      wireEvents();
      initRecursivePanel();
    });
  }

  function capture(event, props) {
    if (!window.posthog || typeof window.posthog.capture !== 'function') return;
    window.posthog.capture(event, props || {});
    capturedLog.push({ event: event, atMs: Date.now() - startedAt });
    renderLogEntry(event, Date.now() - startedAt);
  }

  function wireEvents() {
    var handlers = {
      'prehog:slidechange': function (d) {
        if (seenSlides.has(d.id)) return; // prehog_slide_viewed fires at most once per slide per session
        seenSlides.add(d.id);
        capture('prehog_slide_viewed', {
          slide_id: d.id,
          slide_index: d.index,
          entry_method: d.entryMethod
        });
      },
      'prehog:navused': function (d) {
        capture('prehog_navigation_used', {
          method: d.method,
          direction: d.direction,
          from: d.from,
          to: d.to
        });
      },
      'prehog:autoplaytoggled': function (d) {
        capture('prehog_autoplay_toggled', { method: d.method, state: d.state });
      },
      'prehog:transparencyopen': function (d) {
        capture('prehog_measurement_panel_opened', { slide_id: d.slideId });
      },
      'prehog:outbound': function (d) {
        capture('prehog_outbound_clicked', {
          destination: d.destination,
          label: d.label,
          slide_id: d.slideId
        });
      },
      'prehog:eastereggfound': function (d) {
        capture('prehog_easter_egg_found', { slide_id: d.slideId });
      },
      'prehog:completed': function (d) {
        capture('prehog_completed', {
          slides_seen: d.slidesSeen,
          duration_ms: Date.now() - startedAt
        });
        maybeShowSurvey();
      }
    };

    // prehog.js may have already emitted events (e.g. the initial slide
    // view on load) before this script attached any listeners — drain that
    // buffer first, synchronously, before subscribing to live events.
    (window.__prehogEvents || []).forEach(function (item) {
      var handler = handlers[item.name];
      if (handler) handler(item.detail);
    });

    Object.keys(handlers).forEach(function (name) {
      document.addEventListener(name, function (e) { handlers[name](e.detail); });
    });
  }

  // ---------- Recursive, self-referential live-event-log panel ----------
  // Gated behind a real feature flag (RECURSIVE_PANEL_FLAG) — see
  // docs/decisions.md for why this reverses the earlier "declined" call on
  // Feature Flags. Reads straight off `capturedLog`, which is populated by
  // every real capture() call above — no new data plumbing, just a render
  // layer over data this file already produces.
  var eventLogList = document.querySelector('[data-event-log-list]');
  var eventLogEmpty = document.querySelector('[data-event-log-empty]');
  var sessionChip = document.querySelector('[data-session-chip]');
  var sessionChipText = document.querySelector('[data-session-chip-text]');

  function renderLogEntry(eventName, atMs) {
    if (!recursivePanelEnabled || !eventLogList) return;
    if (eventLogEmpty && eventLogEmpty.parentNode) eventLogEmpty.remove();
    var item = document.createElement('li');
    item.className = 'event-log-item';
    var nameEl = document.createElement('span');
    nameEl.className = 'event-log-name';
    nameEl.textContent = eventName;
    var timeEl = document.createElement('span');
    timeEl.className = 'event-log-time';
    timeEl.textContent = '+' + (atMs / 1000).toFixed(1) + 's';
    item.appendChild(nameEl);
    item.appendChild(timeEl);
    eventLogList.appendChild(item);
    eventLogList.scrollTop = eventLogList.scrollHeight;
  }

  function showSessionChip() {
    if (!sessionChip) return;
    var distinctId = (window.posthog && typeof window.posthog.get_distinct_id === 'function')
      ? window.posthog.get_distinct_id() : null;
    if (sessionChipText && distinctId) {
      sessionChipText.textContent = 'session ' + distinctId.slice(0, 8) + '…';
    }
    sessionChip.hidden = false;
  }

  function enableRecursivePanel() {
    if (recursivePanelEnabled) return;
    recursivePanelEnabled = true;
    // Replay everything captured before the flag resolved (flags load
    // asynchronously, so early events would otherwise never appear).
    capturedLog.forEach(function (entry) { renderLogEntry(entry.event, entry.atMs); });
    showSessionChip();
  }

  function initRecursivePanel() {
    if (!window.posthog || typeof window.posthog.onFeatureFlags !== 'function') return;
    window.posthog.onFeatureFlags(function () {
      if (window.posthog.isFeatureEnabled && window.posthog.isFeatureEnabled(RECURSIVE_PANEL_FLAG)) {
        enableRecursivePanel();
      }
    });
  }

  // ---------- Survey: real PostHog Survey object, custom-rendered ----------
  // Timing is decided entirely in this file (only after prehog_completed),
  // not via PostHog display conditions — simpler and fully within our own
  // test coverage than guessing at conditions-JSON shape. The survey object
  // itself is real (created via PostHog's Surveys API, type "api"), and
  // responses are submitted via the documented manual-survey capture
  // pattern so they show up in PostHog's own Surveys reporting UI.
  function maybeShowSurvey() {
    if (surveyShown) return;
    if (!window.posthog || typeof window.posthog.getActiveMatchingSurveys !== 'function') return;
    window.posthog.getActiveMatchingSurveys(function (surveys) {
      var survey = surveys && surveys[0];
      if (!survey || !survey.questions || survey.questions.length < 2) return;
      surveyShown = true;
      currentSurvey = survey;
      renderSurvey(survey);
      capture('survey shown', {
        $survey_id: survey.id,
        $survey_questions: survey.questions.map(function (q) { return { id: q.id, question: q.question }; })
      });
      if (window.__prehogOpenSurvey) window.__prehogOpenSurvey();
    }, true);
  }

  function renderSurvey(survey) {
    var titleEl = document.querySelector('[data-survey-title]');
    var bodyEl = document.querySelector('[data-survey-body]');
    if (!bodyEl) return;
    if (titleEl) titleEl.textContent = survey.name || 'Quick feedback';

    var ratingQ = survey.questions[0];
    var openQ = survey.questions[1];
    var state = { rating: null, text: '' };

    bodyEl.textContent = '';

    var ratingWrap = document.createElement('div');
    ratingWrap.className = 'survey-question';
    var ratingLabel = document.createElement('label');
    ratingLabel.textContent = ratingQ.question;
    ratingWrap.appendChild(ratingLabel);

    var scaleWrap = document.createElement('div');
    scaleWrap.className = 'survey-scale';
    var scaleButtons = [];
    var scaleMax = ratingQ.scale || 5;
    for (var i = 1; i <= scaleMax; i += 1) {
      (function (value) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = String(value);
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', function () {
          state.rating = value;
          scaleButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        });
        scaleButtons.push(btn);
        scaleWrap.appendChild(btn);
      })(i);
    }
    ratingWrap.appendChild(scaleWrap);
    bodyEl.appendChild(ratingWrap);

    var openWrap = document.createElement('div');
    openWrap.className = 'survey-question';
    var openLabel = document.createElement('label');
    openLabel.textContent = openQ.question;
    var textarea = document.createElement('textarea');
    textarea.className = 'survey-textarea';
    textarea.setAttribute('data-ph-mask', ''); // free text may contain anything — masked in session replay
    textarea.setAttribute('aria-label', openQ.question);
    textarea.addEventListener('input', function (e) { state.text = e.target.value; });
    openWrap.appendChild(openLabel);
    openWrap.appendChild(textarea);
    bodyEl.appendChild(openWrap);

    var actions = document.createElement('div');
    actions.className = 'slide-actions';
    var submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = 'Send feedback';
    submitBtn.addEventListener('click', function () { submitSurvey(survey, state, bodyEl); });
    actions.appendChild(submitBtn);
    bodyEl.appendChild(actions);
  }

  function submitSurvey(survey, state, bodyEl) {
    capture('survey sent', {
      $survey_id: survey.id,
      $survey_questions: survey.questions.map(function (q) { return { id: q.id, question: q.question }; }),
      $survey_response_0: state.rating,
      $survey_response_1: state.text
    });
    surveySubmitted = true;
    if (bodyEl) {
      bodyEl.textContent = '';
      var thanks = document.createElement('p');
      thanks.className = 'survey-thanks';
      thanks.textContent = 'Thanks — that helps.';
      bodyEl.appendChild(thanks);
    }
    window.setTimeout(function () {
      var closeBtn = document.querySelector('[data-survey-close]');
      if (closeBtn) closeBtn.click();
    }, 1400);
  }

  // Track dismissal (closed without submitting) separately from submission.
  // Shares the same [data-survey-close] triggers prehog.js already wires
  // for the panel's generic open/close mechanics — submitSurvey() sets
  // surveySubmitted before programmatically clicking close, so a real
  // submission never also fires a spurious "survey dismissed".
  document.addEventListener('DOMContentLoaded', function () {
    var closeTriggers = document.querySelectorAll('[data-survey-close]');
    closeTriggers.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (surveyShown && !surveySubmitted && currentSurvey) {
          capture('survey dismissed', {
            $survey_id: currentSurvey.id,
            $survey_questions: currentSurvey.questions.map(function (q) { return { id: q.id, question: q.question }; })
          });
          surveySubmitted = true; // one dismiss capture per survey render, even if closed multiple times
        }
      });
    });
  });

  ready(initPostHog);
})();
