/**
 * prehog.js — presentation controller.
 *
 * Progressive enhancement contract: without this script, index.html is a
 * single scrollable document with all nine <section class="slide"> visible
 * in order — nothing here is required for the content to be readable.
 * When this script runs, it switches the deck into a "paged" mode (one
 * slide visible at a time, arrow/swipe/dot navigation, deep-linkable via
 * location.hash) and dispatches events on `document` that analytics.js
 * listens for. prehog.js has no knowledge of PostHog — that separation is
 * deliberate so navigation logic stays testable without a network.
 */
(function () {
  'use strict';

  var SLIDE_IDS = [
    'intro', 'posthog', 'context', 'how', 'evidence',
    'learning', 'humans-agents', 'why-now', 'inspect'
  ];

  var root = document.documentElement;
  var deck = document.querySelector('[data-role="deck"]');
  if (!deck) return;

  var slides = SLIDE_IDS.map(function (id) { return document.getElementById(id); });
  var dots = Array.prototype.slice.call(document.querySelectorAll('[data-dot]'));
  var progressBar = document.querySelector('[data-progress-bar]');
  var positionEl = document.querySelector('[data-position]');
  var prevBtn = document.querySelector('[data-action="prev"]');
  var nextBtns = Array.prototype.slice.call(document.querySelectorAll('[data-action="next"]'));
  var progressWrap = document.querySelector('.deck-progress');

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) root.classList.add('reduced-motion');

  var currentIndex = 0;
  var seenSlideIds = {}; // used only to decide 'entry_method' framing locally; analytics.js does its own dedup
  var completedEmitted = false; // 'prehog:completed' fires at most once per session, landing on the last slide repeatedly must not re-fire it

  // analytics.js is a deferred script that runs *after* prehog.js, so the
  // very first slidechange (fired synchronously on load, before analytics.js
  // has attached any listeners) would otherwise be missed entirely. Every
  // emitted event is buffered here in addition to being dispatched live;
  // analytics.js drains the buffer once on startup, then listens normally.
  // prehog.js still knows nothing about PostHog — this is a generic queue.
  window.__prehogEvents = window.__prehogEvents || [];
  function emit(name, detail) {
    var payload = detail || {};
    window.__prehogEvents.push({ name: name, detail: payload });
    document.dispatchEvent(new CustomEvent(name, { detail: payload }));
  }

  function indexFromHash() {
    var id = (location.hash || '').replace('#', '');
    var idx = SLIDE_IDS.indexOf(id);
    return idx === -1 ? 0 : idx;
  }

  function setActive(index, method) {
    index = Math.max(0, Math.min(SLIDE_IDS.length - 1, index));
    var id = SLIDE_IDS[index];
    currentIndex = index;

    slides.forEach(function (slide, i) {
      if (!slide) return;
      slide.classList.toggle('is-active', i === index);
    });

    dots.forEach(function (dot) {
      var isCurrent = dot.getAttribute('data-dot') === id;
      dot.setAttribute('aria-current', isCurrent ? 'true' : 'false');
    });

    if (progressBar) progressBar.style.width = (((index + 1) / SLIDE_IDS.length) * 100) + '%';
    if (progressWrap) progressWrap.setAttribute('aria-valuenow', String(index + 1));
    if (positionEl) positionEl.textContent = (index + 1) + ' / ' + SLIDE_IDS.length;
    if (prevBtn) prevBtn.disabled = index === 0;

    root.setAttribute('data-slide', id);

    if (location.hash !== '#' + id) {
      history.replaceState(null, '', '#' + id);
    }

    var entryMethod = seenSlideIds[id] ? (method || 'nav') : (method || 'load');
    seenSlideIds[id] = true;

    emit('prehog:slidechange', { id: id, index: index, entryMethod: entryMethod });

    var activeSlideEl = slides[index];
    if (activeSlideEl) {
      var illos = activeSlideEl.querySelectorAll('[data-animate-draw]');
      illos.forEach(function (svg) { svg.classList.add('is-visible'); });
      var focusTarget = activeSlideEl.querySelector('h1, h2');
      if (focusTarget && method && method !== 'load') {
        focusTarget.setAttribute('tabindex', '-1');
        focusTarget.focus({ preventScroll: true });
      }
    }

    if (index === SLIDE_IDS.length - 1 && !completedEmitted) {
      completedEmitted = true;
      emit('prehog:completed', { slidesSeen: Object.keys(seenSlideIds).length });
    }
  }

  function go(delta, method) {
    var before = currentIndex;
    setActive(currentIndex + delta, method);
    emit('prehog:navused', { method: method, direction: delta > 0 ? 'next' : 'prev', from: SLIDE_IDS[before], to: SLIDE_IDS[currentIndex] });
  }

  function goTo(id, method) {
    var idx = SLIDE_IDS.indexOf(id);
    if (idx === -1) return;
    setActive(idx, method);
    emit('prehog:navused', { method: method, direction: idx > currentIndex ? 'next' : 'prev', to: id });
  }

  // Enable paged mode only once JS confirms it can drive the deck.
  root.classList.add('js-paged');
  document.body && document.body.classList.add('js-paged');

  setActive(indexFromHash(), 'load');

  nextBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { go(1, 'click'); });
  });
  if (prevBtn) prevBtn.addEventListener('click', function () { go(-1, 'click'); });

  dots.forEach(function (dot) {
    dot.addEventListener('click', function () {
      goTo(dot.getAttribute('data-dot'), 'click');
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(1, 'key'); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1, 'key'); e.preventDefault(); }
    else if (e.key === 'Home') { goTo(SLIDE_IDS[0], 'key'); e.preventDefault(); }
    else if (e.key === 'End') { goTo(SLIDE_IDS[SLIDE_IDS.length - 1], 'key'); e.preventDefault(); }
    else if (e.key === 'Escape') { closeTransparency(); }
  });

  // Touch swipe (single axis, deliberately simple — no gesture library).
  var touchStartX = null, touchStartY = null;
  deck.addEventListener('touchstart', function (e) {
    var t = e.changedTouches[0];
    touchStartX = t.clientX; touchStartY = t.clientY;
  }, { passive: true });
  deck.addEventListener('touchend', function (e) {
    if (touchStartX === null) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStartX;
    var dy = t.clientY - touchStartY;
    touchStartX = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1, 'swipe');
    }
  }, { passive: true });

  window.addEventListener('hashchange', function () {
    setActive(indexFromHash(), 'hash');
  });

  // Outbound / evidence link tracking — one listener, data-attribute driven.
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('[data-outbound]');
    if (!link) return;
    emit('prehog:outbound', {
      destination: link.href,
      label: link.getAttribute('data-outbound'),
      slideId: root.getAttribute('data-slide')
    });
  });

  // Transparency panel
  var panel = document.querySelector('[data-transparency-panel]');
  var openTriggers = Array.prototype.slice.call(document.querySelectorAll('[data-action="open-transparency"]'));
  var closeTriggers = Array.prototype.slice.call(document.querySelectorAll('[data-transparency-close]'));
  var lastFocused = null;

  function openTransparency() {
    if (!panel) return;
    lastFocused = document.activeElement;
    panel.hidden = false;
    var closeBtn = panel.querySelector('.transparency-close');
    if (closeBtn) closeBtn.focus();
    emit('prehog:transparencyopen', { slideId: root.getAttribute('data-slide') });
  }
  function closeTransparency() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if (lastFocused) lastFocused.focus();
  }
  openTriggers.forEach(function (btn) { btn.addEventListener('click', openTransparency); });
  closeTriggers.forEach(function (btn) { btn.addEventListener('click', closeTransparency); });

  // Draw-in animation trigger for illustrations reached via normal scroll
  // (paged mode already marks the active slide's SVGs visible in setActive,
  // this observer covers the no-JS-scroll-still-enabled edge case and
  // re-triggers if a user resizes past the paged breakpoint).
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) entry.target.classList.add('is-visible');
      });
    }, { threshold: 0.4 });
    document.querySelectorAll('[data-animate-draw]').forEach(function (svg) { io.observe(svg); });
  }

  window.__prehogController = { goTo: goTo, go: go, getIndex: function () { return currentIndex; }, ids: SLIDE_IDS };
})();
