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

  var seenSlides = new Set();
  var startedAt = Date.now();

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function loadSnippet(cb) {
    /* eslint-disable */
    !function (t, e) {
      var o, n, p, r; e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) {
        function g(t, e) { var o = e.split('.'); 2 == o.length && (t = t[o[0]], e = o[1]), t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } }
        (p = t.createElement('script')).type = 'text/javascript', p.crossOrigin = 'anonymous', p.async = !0, p.src = s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js', (r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(p, r);
        var u = e; for (void 0 !== a ? u = e[a] = [] : a = 'posthog', u.people = u.people || []; u.people.toString = function () { return u.toString(1) + '.people (stub)' };
          n = ('capture identifyIdentify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId').split(' '), o = 0; o < n.length; o++) g(u, n[o]);
        e._i.push([i, s, a])
      }, e.__SV = 1)
    }(document, window.posthog || []);
    /* eslint-enable */
    cb();
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
    document.addEventListener('prehog:slidechange', function (e) {
      var d = e.detail;
      if (seenSlides.has(d.id)) return; // prehog_slide_viewed fires at most once per slide per session
      seenSlides.add(d.id);
      capture('prehog_slide_viewed', {
        slide_id: d.id,
        slide_index: d.index,
        entry_method: d.entryMethod
      });
    });

    document.addEventListener('prehog:navused', function (e) {
      var d = e.detail;
      capture('prehog_navigation_used', {
        method: d.method,
        direction: d.direction,
        from: d.from,
        to: d.to
      });
    });

    document.addEventListener('prehog:transparencyopen', function (e) {
      capture('prehog_measurement_panel_opened', { slide_id: e.detail.slideId });
    });

    document.addEventListener('prehog:outbound', function (e) {
      var d = e.detail;
      capture('prehog_outbound_clicked', {
        destination: d.destination,
        label: d.label,
        slide_id: d.slideId
      });
    });

    document.addEventListener('prehog:completed', function (e) {
      capture('prehog_completed', {
        slides_seen: e.detail.slidesSeen,
        duration_ms: Date.now() - startedAt
      });
    });
  }

  ready(initPostHog);
})();
