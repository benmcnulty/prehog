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
    || 'https://cdn.jsdelivr.net/npm/posthog-js@1.413.3/dist/array.full.js';

  var seenSlides = new Set();
  var startedAt = Date.now();

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // Loads PostHog's own published "array.full.js" bundle (the same
  // self-contained build their /static/array.js endpoint serves, published
  // to npm as posthog-js) from jsDelivr, which the host site's CSP already
  // allows in script-src — no snippet reconstruction, no extra CSP entry.
  // The bundle attaches `window.posthog` itself once it finishes loading.
  function loadSnippet(cb) {
    if (window.posthog && typeof window.posthog.init === 'function') { cb(); return; }

    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = POSTHOG_SDK_URL;
    script.onload = cb;
    script.onerror = function () {
      console.warn('[prehog] PostHog script failed to load; analytics disabled for this session.');
    };
    var firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(script, firstScript);
  }

  function initPostHog() {
    var usingStub = PREHOG_CONFIG.testStub === true || window.__PREHOG_TEST_STUB__ === true;

    if (usingStub) {
      if (window.posthog && typeof window.posthog.init === 'function') {
        window.posthog.init('test-stub', { api_host: POSTHOG_HOST, defaults: '2026-05-30' });
      }
      wireEvents();
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
    });
  }

  function capture(event, props) {
    if (!window.posthog || typeof window.posthog.capture !== 'function') return;
    window.posthog.capture(event, props || {});
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
      'prehog:completed': function (d) {
        capture('prehog_completed', {
          slides_seen: d.slidesSeen,
          duration_ms: Date.now() - startedAt
        });
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

  ready(initPostHog);
})();
