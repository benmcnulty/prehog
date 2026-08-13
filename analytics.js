/**
 * analytics.js — /prehog's thin domain adapter onto the shared site-wide
 * analytics layer (public/js/analytics/{consent,events,index}.js in the
 * benlive repo, loaded ahead of this script — see index.html). The
 * shared layer owns PostHog init, consent gating, and the shared bl_*
 * taxonomy; this file only maps prehog's own `prehog:*` DOM CustomEvents
 * (dispatched by prehog.js) onto `prehog_*` PostHog events via
 * `window.BenLiveAnalytics.capture()`, and keeps the parts that are
 * genuinely local to this one page: the survey UI and the recursive
 * live-event-log panel. See docs/analytics.md for the full event spec.
 */
(function () {
  'use strict';

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

  function capture(event, props) {
    if (!window.BenLiveAnalytics) return; // shared layer failed to load — deck stays fully functional
    var status = window.BenLiveAnalytics.capture(event, props || {});
    // Only log what the shared layer actually accepted or queued for
    // delivery — 'rejected' (consent denied) never happened as far as
    // this panel is concerned. Matches its own stated contract: "only
    // events actually sent to PostHog" (queued-then-delivered still
    // counts; a call that was flatly refused does not).
    if (status === 'rejected') return;
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
      'prehog:viewmodechanged': function (d) {
        capture('prehog_view_mode_changed', { mode: d.mode, method: d.method });
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

  ready(function () {
    wireEvents();
    if (window.BenLiveAnalytics) window.BenLiveAnalytics.onReady(initRecursivePanel);
  });
})();
