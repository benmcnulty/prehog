/**
 * prehog.js — presentation controller.
 *
 * Progressive enhancement contract: without this script, index.html is a
 * single scrollable document with all nine <section class="slide"> visible
 * in order — nothing here is required for the content to be readable.
 * When this script runs, it switches the deck into a "paged" mode (one
 * slide visible at a time, arrow/swipe/dot navigation, deep-linkable via
 * location.hash), adds a content-proportional auto-advance timer with a
 * pause control, and dispatches events on `document` that analytics.js
 * listens for. prehog.js has no knowledge of PostHog — that separation is
 * deliberate so navigation logic stays testable without a network.
 */
(function () {
  'use strict';

  var SLIDE_IDS = [
    'intro', 'posthog', 'context', 'how', 'evidence',
    'learning', 'humans-agents', 'why-now', 'inspect'
  ];

  var AUTOPLAY_MIN_MS = 8000;
  var AUTOPLAY_MAX_MS = 22000;
  var AUTOPLAY_MS_PER_WORD = 60;
  var AUTOPLAY_STORAGE_KEY = 'prehog:autoplay';
  var SLIDE_LEAVE_MS = 380; // lets the overlaid exit transition settle before cleanup

  var root = document.documentElement;
  var deck = document.querySelector('[data-role="deck"]');
  if (!deck) return;

  var slides = SLIDE_IDS.map(function (id) { return document.getElementById(id); });
  var dots = Array.prototype.slice.call(document.querySelectorAll('[data-dot]'));
  var progressBar = document.querySelector('[data-progress-bar]');
  var progressTimer = document.querySelector('[data-progress-timer]');
  var positionEl = document.querySelector('[data-position]');
  var prevBtn = document.querySelector('[data-action="prev"]');
  var nextBtns = Array.prototype.slice.call(document.querySelectorAll('[data-action="next"]'));
  var progressWrap = document.querySelector('.deck-progress');
  var playbackWrap = document.querySelector('[data-playback]');
  var playbackBtn = document.querySelector('[data-action="toggle-playback"]');

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

  // ---------- Slide transitions ----------
  function setActive(index, method) {
    index = Math.max(0, Math.min(SLIDE_IDS.length - 1, index));
    if (index === currentIndex && method !== 'load') return;
    var previousIndex = currentIndex;
    var previousEl = slides[previousIndex];
    var id = SLIDE_IDS[index];
    currentIndex = index;

    root.setAttribute('data-direction', index < previousIndex ? 'backward' : 'forward');

    if (previousEl && previousIndex !== index && method !== 'load' && !reducedMotion) {
      previousEl.classList.add('is-leaving');
      previousEl.classList.remove('is-active');
      window.setTimeout(function () { previousEl.classList.remove('is-leaving'); }, SLIDE_LEAVE_MS);
    }

    slides.forEach(function (slide, i) {
      if (!slide) return;
      var isCurrent = i === index;
      if (isCurrent) slide.classList.remove('is-leaving');
      slide.classList.toggle('is-active', isCurrent);
      slide.inert = !isCurrent;
      slide.setAttribute('aria-hidden', isCurrent ? 'false' : 'true');
    });

    dots.forEach(function (dot) {
      var isCurrent = dot.getAttribute('data-dot') === id;
      dot.setAttribute('aria-current', isCurrent ? 'true' : 'false');
    });

    if (progressBar) progressBar.style.transform = 'scaleX(' + ((index + 1) / SLIDE_IDS.length) + ')';
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

    scheduleAutoAdvance();
  }

  function go(delta, method) {
    var before = currentIndex;
    if (method !== 'auto') pauseAutoplay('manual');
    setActive(currentIndex + delta, method);
    if (currentIndex !== before) {
      emit('prehog:navused', { method: method, direction: delta > 0 ? 'next' : 'prev', from: SLIDE_IDS[before], to: SLIDE_IDS[currentIndex] });
    }
  }

  function goTo(id, method) {
    var idx = SLIDE_IDS.indexOf(id);
    if (idx === -1) return;
    if (method !== 'auto') pauseAutoplay('manual');
    var before = currentIndex;
    setActive(idx, method);
    if (currentIndex !== before) {
      emit('prehog:navused', { method: method, direction: idx > before ? 'next' : 'prev', to: id });
    }
  }

  // ---------- Auto-advance ----------
  var autoplayTimerId = null;
  var autoplayPlaying = false;

  function wordCount(el) {
    if (!el) return 40;
    var text = el.textContent || '';
    var words = text.trim().split(/\s+/).filter(Boolean);
    return words.length;
  }

  function delayForSlide(index) {
    var el = slides[index];
    var ms = AUTOPLAY_MIN_MS + wordCount(el) * AUTOPLAY_MS_PER_WORD;
    return Math.max(AUTOPLAY_MIN_MS, Math.min(AUTOPLAY_MAX_MS, ms));
  }

  function setPlaybackUI(playing) {
    autoplayPlaying = playing;
    if (playbackWrap) playbackWrap.setAttribute('data-playing', String(playing));
    if (playbackBtn) {
      playbackBtn.setAttribute('aria-pressed', String(!playing));
      playbackBtn.setAttribute('aria-label', playing ? 'Pause automatic slide advance' : 'Resume automatic slide advance');
    }
  }

  function clearAutoAdvance() {
    if (autoplayTimerId) { window.clearTimeout(autoplayTimerId); autoplayTimerId = null; }
    if (progressTimer) { progressTimer.style.transition = 'none'; progressTimer.style.transform = 'scaleX(0)'; }
  }

  function scheduleAutoAdvance() {
    clearAutoAdvance();
    if (!autoplayPlaying) return;
    if (currentIndex >= SLIDE_IDS.length - 1) return; // stop at the final slide — this is a read-once artifact, not a kiosk loop
    var ms = delayForSlide(currentIndex);
    if (progressTimer) {
      // force reflow so the width:0 reset above is committed before the transition starts
      // eslint-disable-next-line no-unused-expressions
      progressTimer.offsetWidth;
      progressTimer.style.transition = 'transform ' + ms + 'ms linear';
      progressTimer.style.transform = 'scaleX(1)';
    }
    autoplayTimerId = window.setTimeout(function () {
      go(1, 'auto');
    }, ms);
  }

  function pauseAutoplay(method) {
    if (!autoplayPlaying) return;
    setPlaybackUI(false);
    clearAutoAdvance();
    try { sessionStorage.setItem(AUTOPLAY_STORAGE_KEY, 'paused'); } catch (e) { /* ignore */ }
    emit('prehog:autoplaytoggled', { method: method, state: 'paused' });
  }

  function resumeAutoplay(method) {
    if (autoplayPlaying) return;
    setPlaybackUI(true);
    try { sessionStorage.setItem(AUTOPLAY_STORAGE_KEY, 'playing'); } catch (e) { /* ignore */ }
    emit('prehog:autoplaytoggled', { method: method, state: 'playing' });
    scheduleAutoAdvance();
  }

  function initAutoplay() {
    if (!playbackWrap || !playbackBtn) return;
    var storedPaused = false;
    try { storedPaused = sessionStorage.getItem(AUTOPLAY_STORAGE_KEY) === 'paused'; } catch (e) { /* ignore */ }

    if (reducedMotion) {
      setPlaybackUI(false);
      emit('prehog:autoplaytoggled', { method: 'auto', state: 'paused' });
      return;
    }
    if (storedPaused) {
      setPlaybackUI(false);
      return;
    }
    setPlaybackUI(true);
    scheduleAutoAdvance();
  }

  if (playbackBtn) {
    playbackBtn.addEventListener('click', function () {
      if (autoplayPlaying) pauseAutoplay('manual');
      else resumeAutoplay('manual');
    });
  }

  // Enable paged mode only once JS confirms it can drive the deck.
  root.classList.add('js-paged');
  document.body && document.body.classList.add('js-paged');

  setActive(indexFromHash(), 'load');
  initAutoplay();

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
    else if (e.key === 'Escape') { closeTransparency(); closeSurvey(); }
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
    pauseAutoplay('manual');
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
    pauseAutoplay('manual');
    lastFocused = document.activeElement;
    panel.hidden = false;
    var closeBtn = panel.querySelector('.panel-close');
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

  // Survey panel — analytics.js populates [data-survey-body] and toggles
  // [hidden] once it has a real PostHog Survey to show; prehog.js only owns
  // the generic open/close mechanics, shared with the transparency panel.
  var surveyPanel = document.querySelector('[data-survey-panel]');
  var surveyCloseTriggers = Array.prototype.slice.call(document.querySelectorAll('[data-survey-close]'));
  function closeSurvey() {
    if (!surveyPanel || surveyPanel.hidden) return;
    surveyPanel.hidden = true;
  }
  surveyCloseTriggers.forEach(function (btn) { btn.addEventListener('click', closeSurvey); });
  window.__prehogOpenSurvey = function () {
    if (!surveyPanel) return;
    pauseAutoplay('manual');
    surveyPanel.hidden = false;
    var closeBtn = surveyPanel.querySelector('.panel-close');
    if (closeBtn) closeBtn.focus();
  };

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

  // animation-play-state (and our .reduced-motion class) don't affect SVG
  // SMIL <animate> elements — they need to be explicitly removed.
  if (reducedMotion) {
    document.querySelectorAll('[data-idle-pulse]').forEach(function (node) { node.remove(); });
  }

  // ---------- Easter egg ----------
  // A short, discoverable key sequence — not documented on the page itself,
  // only in the repo's own docs, so finding it is genuinely a "you read the
  // source" moment. Fires its capture event at most once per session; the
  // visual is free to replay.
  var EGG_SEQUENCE = ['h', 'o', 'g'];
  var eggBuffer = [];
  var eggFound = false;

  function spawnHedgehog() {
    var hog = document.createElement('div');
    hog.className = 'egg-hedgehog';
    hog.setAttribute('aria-hidden', 'true');
    // Fully static markup, zero interpolated variables — nothing here
    // originates from user input, URL params, or any external source, so
    // there's no injection surface despite the innerHTML assignment.
    hog.innerHTML = '<svg viewBox="0 0 42 30" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 22 Q2 14 10 10 L30 6 Q40 6 40 14 Q40 20 32 22 L26 22 Q24 26 20 26 Q18 26 18 24 L14 24 Q12 27 9 27 Q7 27 7 25 L7 22 Z" fill="currentColor" opacity="0.9"/>' +
      '<circle cx="35" cy="13" r="1.6" fill="var(--bg)"/>' +
      '<path d="M12 11 L16 4 M16 11 L19 3 M20 11 L23 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      '</svg>';
    document.body.appendChild(hog);
    hog.addEventListener('animationend', function () { hog.remove(); }, { once: true });

    if (!eggFound) {
      eggFound = true;
      emit('prehog:eastereggfound', { slideId: root.getAttribute('data-slide') });
    }

    var badge = document.createElement('div');
    badge.className = 'egg-badge';
    badge.textContent = 'You found the hog. Context Engineers notice details.';
    document.body.appendChild(badge);
    window.setTimeout(function () { badge.remove(); }, 6000);
  }

  document.addEventListener('keydown', function (e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    var key = e.key ? e.key.toLowerCase() : '';
    if (key.length !== 1) return;
    eggBuffer.push(key);
    if (eggBuffer.length > EGG_SEQUENCE.length) eggBuffer.shift();
    if (eggBuffer.join('') === EGG_SEQUENCE.join('')) {
      spawnHedgehog();
      eggBuffer = [];
    }
  });

  window.__prehogController = { goTo: goTo, go: go, getIndex: function () { return currentIndex; }, ids: SLIDE_IDS };
})();
