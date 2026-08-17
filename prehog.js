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
  var AUTOPLAY_MAX_MS = 28000;
  var AUTOPLAY_MS_PER_WORD = 130; // ~180-250wpm effective pace once the floor/diagram bonus are folded in — the old 60ms/word averaged 400+wpm on dense slides, too fast to actually read
  var AUTOPLAY_DIAGRAM_BONUS_MS = 2200; // slides with an SVG figure need time to look at the art, not just read the copy
  var AUTOPLAY_STORAGE_KEY = 'prehog:autoplay';
  var SLIDE_LEAVE_MS = 380; // lets the overlaid exit transition settle before cleanup
  var VIEWMODE_STORAGE_KEY = 'prehog:viewmode'; // durable preference, like the site's own 'theme' key — unlike autoplay's per-visit sessionStorage

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
  var viewMode = 'reference'; // 'reference' (scrollable, default — reuses the no-JS fallback CSS) | 'present' (paged slide show, opt-in) — see setViewMode()

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
  // Present-mode-only concerns (is-active/inert toggling, dots, progress
  // bar, position readout, autofocus on navigate, completion, auto-advance)
  // are skipped in reference mode, where every slide is already visible at
  // once and none of that paging machinery applies — see setViewMode().
  // currentIndex/hash/data-slide/prehog:slidechange stay mode-agnostic so
  // "what slide is current" survives a mode switch either direction.
  function setActive(index, method) {
    index = Math.max(0, Math.min(SLIDE_IDS.length - 1, index));
    if (index === currentIndex && method !== 'load') return;
    var previousIndex = currentIndex;
    var previousEl = slides[previousIndex];
    var id = SLIDE_IDS[index];
    currentIndex = index;
    if (previousIndex !== index) autoplayRemainingMs = null; // a resume-with-remaining-time offer only applies to the slide it was paused on

    if (viewMode === 'present') {
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
    }

    root.setAttribute('data-slide', id);

    // Skipped on 'load': writing a hash that matches a real element id
    // triggers the browser's own async "scroll to fragment" behavior,
    // independent of any explicit JS scroll call — on a fresh, hash-less
    // visit that silently scrolled the page down on load (see the
    // hadHashOnLoad handling below setActive()'s call site). A real deep
    // link's hash is already in the URL at load and needs no write here;
    // every later navigation (click, scroll, key) still syncs normally.
    if (method !== 'load' && location.hash !== '#' + id) {
      history.replaceState(null, '', '#' + id);
    }

    var entryMethod = seenSlideIds[id] ? (method || 'nav') : (method || 'load');
    seenSlideIds[id] = true;

    emit('prehog:slidechange', { id: id, index: index, entryMethod: entryMethod });

    var activeSlideEl = slides[index];
    if (activeSlideEl) {
      var illos = activeSlideEl.querySelectorAll('[data-animate-draw]');
      illos.forEach(function (svg) { svg.classList.add('is-visible'); });
      if (viewMode === 'present') {
        var focusTarget = activeSlideEl.querySelector('h1, h2');
        if (focusTarget && method && method !== 'load') {
          focusTarget.setAttribute('tabindex', '-1');
          focusTarget.focus({ preventScroll: true });
        }
      }
    }

    if (viewMode === 'present') {
      if (index === SLIDE_IDS.length - 1 && !completedEmitted) {
        completedEmitted = true;
        emit('prehog:completed', { slidesSeen: Object.keys(seenSlideIds).length });
      }
      scheduleAutoAdvance();
    }
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
  var autoplayDurationMs = 0;
  var autoplayStartedAt = null;
  var autoplayRemainingMs = null; // set by pauseAutoplay when it stops mid-countdown; consumed once by the next resumeAutoplay
  var imminentTimerId = null; // fires shortly before auto-advance so the timer bar can pulse instead of relying on a fill visitors have to notice

  function wordCount(el) {
    if (!el) return 40;
    var text = el.textContent || '';
    var words = text.trim().split(/\s+/).filter(Boolean);
    return words.length;
  }

  function delayForSlide(index) {
    var el = slides[index];
    var hasDiagram = !!(el && el.querySelector('.slide-figure'));
    var ms = AUTOPLAY_MIN_MS + wordCount(el) * AUTOPLAY_MS_PER_WORD + (hasDiagram ? AUTOPLAY_DIAGRAM_BONUS_MS : 0);
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
  }

  function clearImminentTimer() {
    if (imminentTimerId) { window.clearTimeout(imminentTimerId); imminentTimerId = null; }
  }

  function resetProgressTimer() {
    clearImminentTimer();
    if (progressTimer) {
      progressTimer.removeAttribute('data-imminent');
      progressTimer.style.transition = 'none';
      progressTimer.style.transform = 'scaleX(0)';
    }
  }

  // Freezes the progress bar at its current visual fill instead of snapping
  // it back to empty — used on manual pause so the bar holds still rather
  // than glitching to zero while paused.
  function freezeProgressTimer() {
    clearImminentTimer();
    if (!progressTimer) return;
    progressTimer.removeAttribute('data-imminent');
    var computed = window.getComputedStyle(progressTimer).transform;
    progressTimer.style.transition = 'none';
    progressTimer.style.transform = (computed && computed !== 'none') ? computed : 'scaleX(0)';
  }

  function scheduleAutoAdvance(msOverride) {
    clearAutoAdvance();
    resetProgressTimer();
    if (!autoplayPlaying) return;
    if (currentIndex >= SLIDE_IDS.length - 1) return; // stop at the final slide — this is a read-once artifact, not a kiosk loop
    var ms = typeof msOverride === 'number' ? msOverride : delayForSlide(currentIndex);
    autoplayDurationMs = ms;
    autoplayStartedAt = Date.now();
    if (progressTimer) {
      // force reflow so the width:0 reset above is committed before the transition starts
      // eslint-disable-next-line no-unused-expressions
      progressTimer.offsetWidth;
      progressTimer.style.transition = 'transform ' + ms + 'ms linear';
      progressTimer.style.transform = 'scaleX(1)';
    }
    // The fill alone was easy to miss — a low-contrast bar creeping across
    // the same strip as the bold overall-progress bar gave no clear cue
    // that a slide change was close. data-imminent triggers a CSS pulse
    // (opacity/glow, not transform, so it doesn't fight the fill's own
    // transition) for a window scaled to the slide's own duration: short
    // enough not to overstay on a long slide, long enough to register on
    // the 8s floor.
    var imminentMs = Math.min(2200, Math.round(ms * 0.25));
    imminentTimerId = window.setTimeout(function () {
      if (progressTimer) progressTimer.setAttribute('data-imminent', 'true');
    }, Math.max(0, ms - imminentMs));
    autoplayTimerId = window.setTimeout(function () {
      go(1, 'auto');
    }, ms);
  }

  function pauseAutoplay(method) {
    if (!autoplayPlaying) return;
    setPlaybackUI(false);
    if (autoplayStartedAt !== null && autoplayDurationMs) {
      var elapsed = Date.now() - autoplayStartedAt;
      autoplayRemainingMs = Math.max(600, autoplayDurationMs - elapsed);
    }
    freezeProgressTimer();
    clearAutoAdvance();
    try { sessionStorage.setItem(AUTOPLAY_STORAGE_KEY, 'paused'); } catch (e) { /* ignore */ }
    emit('prehog:autoplaytoggled', { method: method, state: 'paused' });
  }

  function resumeAutoplay(method) {
    if (autoplayPlaying) return;
    setPlaybackUI(true);
    try { sessionStorage.setItem(AUTOPLAY_STORAGE_KEY, 'playing'); } catch (e) { /* ignore */ }
    emit('prehog:autoplaytoggled', { method: method, state: 'playing' });
    var remaining = autoplayRemainingMs;
    autoplayRemainingMs = null;
    scheduleAutoAdvance(remaining === null ? undefined : remaining);
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

  // ---------- View mode (present / reference) ----------
  // 'reference' is the default landing experience: a normal scrollable
  // document, reusing the existing no-JS fallback CSS — every slide
  // already renders this way without .js-paged, since that's exactly what
  // a visitor with JS disabled sees today. 'present' is the opt-in paged
  // slide show. Persisted in
  // localStorage (a durable preference, like the site's own 'theme' key) —
  // not sessionStorage like autoplay's pause state, which is deliberately
  // per-visit.
  var toolbar = document.querySelector('.deck-toolbar');
  if (toolbar) toolbar.hidden = false; // starts hidden in markup — see index.html's comment on why
  var toolbarToggleBtn = document.querySelector('[data-action="toggle-view"]');
  var tocBtn = document.querySelector('[data-action="open-toc"]');
  var tocPanel = document.querySelector('[data-toc-panel]');
  var tocList = document.querySelector('[data-toc-list]');
  var tocCloseTriggers = Array.prototype.slice.call(document.querySelectorAll('[data-toc-close]'));
  var tocLastFocused = null;

  function clearPagedSlideState() {
    slides.forEach(function (slide) {
      if (!slide) return;
      slide.classList.remove('is-active', 'is-leaving');
      slide.inert = false;
      slide.removeAttribute('aria-hidden');
    });
  }

  // Scrollspy for reference mode: keeps currentIndex/hash/data-slide (and,
  // once per section, prehog:slidechange) in sync with manual scrolling, so
  // "what section is current" survives a switch back to present mode and
  // section-progress analytics stay meaningful in reference mode too — not
  // just at whichever section reference mode happened to be entered on.
  // Each slide is roughly one viewport tall (min-height: 100dvh minus nav),
  // often taller — a threshold requiring 50% of the *slide's* area inside a
  // narrow center band is geometrically impossible once the slide exceeds
  // roughly twice the band's height, so this uses the opposite approach: a
  // thin trigger line at vertical center (threshold: 0, ~10% tall band) that
  // fires the instant a slide's boundary crosses it, the standard
  // "scrollspy via center trigger line" pattern.
  var referenceObserver = null;
  var referenceTrackingPrimed = false; // see startReferenceTracking()
  function handleReferenceIntersection(entries) {
    // IntersectionObserver callbacks are queued asynchronously — disconnect()
    // stops *future* observations but does not retract a callback already
    // queued at the moment it's called, so a stale one can in principle
    // still arrive after stopReferenceTracking() has run. referenceObserver
    // is nulled out synchronously by stop, so checking it here rejects any
    // such callback outright.
    if (!referenceObserver) return;
    // The observer's first callback after (re)starting just reports
    // whatever is already at the trigger line, which is exactly the state
    // scrollSlideIntoView() was called to establish right before this —
    // discard it as a no-op baseline read rather than treat it as a change,
    // so only genuine subsequent scroll-driven movement updates state.
    if (!referenceTrackingPrimed) { referenceTrackingPrimed = true; return; }
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var idx = slides.indexOf(entry.target);
      if (idx === -1 || idx === currentIndex) return;
      currentIndex = idx;
      var id = SLIDE_IDS[idx];
      root.setAttribute('data-slide', id);
      if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
      if (!seenSlideIds[id]) {
        seenSlideIds[id] = true;
        emit('prehog:slidechange', { id: id, index: idx, entryMethod: 'scroll' });
      }
    });
  }
  function startReferenceTracking() {
    if (referenceObserver || !('IntersectionObserver' in window)) return;
    referenceTrackingPrimed = false;
    referenceObserver = new IntersectionObserver(handleReferenceIntersection, {
      threshold: 0,
      rootMargin: '-45% 0px -45% 0px'
    });
    slides.forEach(function (slide) { if (slide) referenceObserver.observe(slide); });
  }
  function stopReferenceTracking() {
    if (referenceObserver) { referenceObserver.disconnect(); referenceObserver = null; }
  }
  function scrollSlideIntoView(index, behavior) {
    var slide = slides[index];
    if (!slide) return;
    slide.scrollIntoView({ behavior: behavior, block: 'start' });
  }

  // The button's own label ("Slide show") stays fixed — aria-pressed alone
  // communicates state, per the W3C toggle-button pattern. An earlier
  // draft changed the label text between two directional strings
  // alongside aria-pressed, which a review flagged as conflicting: if the
  // label already names the action and its inverse, aria-pressed is
  // redundant at best and confusing at worst. Reference view is now the
  // default landing experience, so the button represents opting *into*
  // the slide show — pressed means present/paged mode is active.
  function updateViewToggleUI() {
    var isPresent = viewMode === 'present';
    if (toolbarToggleBtn) toolbarToggleBtn.setAttribute('aria-pressed', String(isPresent));
    root.setAttribute('data-view-mode', viewMode);
  }

  function setViewMode(mode, method) {
    if (mode !== 'present' && mode !== 'reference') return; // public API — reject anything but the two real states
    if (mode === viewMode) return;
    viewMode = mode;
    try { localStorage.setItem(VIEWMODE_STORAGE_KEY, mode); } catch (e) { /* ignore */ }
    if (mode === 'reference') {
      pauseAutoplay('mode');
      clearAutoAdvance();
      root.classList.remove('js-paged');
      document.body && document.body.classList.remove('js-paged');
      clearPagedSlideState();
      // data-view-mode drives [data-view-mode='reference'] .slide's
      // shorter, content-sized layout — it must be set *before* the scroll
      // below is calculated, not just before updateViewToggleUI() runs
      // later. Getting this backwards was a real bug: scrollIntoView ran
      // against the still-tall paged-mode slide heights, then the page
      // collapsed to its shorter reference layout immediately after,
      // leaving the scroll position overshooting well past the target.
      root.setAttribute('data-view-mode', mode);
      // Land on the section that was open in present mode, not the top of
      // the document — without this the reader's place is silently lost.
      // Instant, not smooth: a smooth scroll takes time, and the scrollspy
      // starting right after would see the pre-animation position on its
      // first (discarded-as-baseline) check, not the actual destination.
      scrollSlideIntoView(currentIndex, 'auto');
      startReferenceTracking();
    } else {
      stopReferenceTracking();
      root.classList.add('js-paged');
      document.body && document.body.classList.add('js-paged');
      // currentIndex already reflects manual scrolling in reference mode
      // (see handleReferenceIntersection) — setActive(currentIndex, 'load')
      // restores paging at whichever section was actually being read.
      setActive(currentIndex, 'load');
      window.scrollTo(0, 0);
    }
    updateViewToggleUI();
    emit('prehog:viewmodechanged', { mode: mode, method: method });
  }

  if (toolbarToggleBtn) {
    toolbarToggleBtn.addEventListener('click', function () {
      setViewMode(viewMode === 'present' ? 'reference' : 'present', 'toggle');
    });
  }

  // Jumps to a slide from the Contents panel. In present mode this is just
  // the existing goTo() pipeline; in reference mode there is no "active
  // slide" to page to, so it scrolls the target section into view instead
  // and still emits prehog:navused (method: 'toc') for parity with present
  // mode's dot/button navigation.
  function jumpTo(id, method) {
    var idx = SLIDE_IDS.indexOf(id);
    if (idx === -1) return;
    if (viewMode === 'present') {
      goTo(id, method);
      return;
    }
    var before = currentIndex;
    currentIndex = idx;
    var slide = slides[idx];
    if (slide) {
      // Instant, not smooth — the scrollspy observer is running continuously
      // in reference mode and would otherwise fire for whichever slide is
      // still on-screen partway through a smooth scroll, transiently
      // overwriting the currentIndex/hash this function just set (see the
      // identical reasoning in setViewMode's own scroll-into-view call).
      slide.scrollIntoView({ behavior: 'auto', block: 'start' });
      var focusTarget = slide.querySelector('h1, h2');
      if (focusTarget) { focusTarget.setAttribute('tabindex', '-1'); focusTarget.focus({ preventScroll: true }); }
    }
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    // Confirmed via a live trace (not guessed): on WebKit, updating the URL
    // fragment via history.replaceState() here can still trigger the
    // browser's own async native "scroll to element with this ID"
    // correction shortly after this function returns — even though the
    // originating click already called preventDefault(), and even though
    // this correction runs on a delay, not synchronously. It landed on
    // whatever the page's OWN scroll position happened to be right before
    // this call (in one measured case, snapping a correct scrollY of 4539
    // back down to 153). Re-asserting the scroll one frame later wins that
    // race instead of trying to prevent it.
    if (slide) {
      requestAnimationFrame(function () { slide.scrollIntoView({ behavior: 'auto', block: 'start' }); });
    }
    if (before !== idx) {
      emit('prehog:navused', { method: method, direction: idx > before ? 'next' : 'prev', to: id });
    }
  }

  // Built once from each slide's own heading — single source of truth,
  // same reasoning as SLIDE_IDS — rather than a second hand-authored list
  // in index.html that could drift from the actual slide titles.
  function buildToc() {
    if (!tocList) return;
    SLIDE_IDS.forEach(function (id, i) {
      var slide = slides[i];
      if (!slide) return;
      var heading = slide.querySelector('h1, h2');
      var title = heading ? heading.textContent.trim() : id;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + id;
      a.textContent = (i + 1) + '. ' + title;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        closeToc();
        jumpTo(id, 'toc');
      });
      li.appendChild(a);
      tocList.appendChild(li);
    });
  }

  function openToc() {
    if (!tocPanel) return;
    if (viewMode === 'present') pauseAutoplay('manual');
    tocLastFocused = openPanelModal(tocPanel);
  }
  function closeToc() {
    closePanelModal(tocPanel, tocLastFocused);
  }
  if (tocBtn) tocBtn.addEventListener('click', openToc);
  tocCloseTriggers.forEach(function (btn) { btn.addEventListener('click', closeToc); });
  buildToc();

  // Reference view is the default landing experience (a normal scrollable
  // page) — paged slide-show mode is opt-in, enabled only by an explicit
  // stored preference from a previous visit.
  var storedViewMode = 'reference';
  try {
    var storedVM = localStorage.getItem(VIEWMODE_STORAGE_KEY);
    if (storedVM === 'reference' || storedVM === 'present') storedViewMode = storedVM;
  } catch (e) { /* ignore */ }
  viewMode = storedViewMode;

  if (viewMode === 'present') {
    root.classList.add('js-paged');
    document.body && document.body.classList.add('js-paged');
  } else {
    // The early synchronous inline script in index.html (which runs before
    // this deferred script, to set data-slide before first paint) always
    // adds js-paged to <html> unconditionally, since it has no way to read
    // localStorage that early without risking a flash of unstyled content.
    // A stored 'reference' preference must explicitly remove it here,
    // otherwise .js-paged-scoped CSS still matches everything descended
    // from <html> even though body never got the class — the paged layout
    // partially applies despite viewMode already being 'reference'.
    root.classList.remove('js-paged');
  }

  // Captured before setActive() below, which unconditionally rewrites
  // location.hash to the current slide's id via history.replaceState (even
  // on a fresh, hash-less load) — reading location.hash after that call
  // could never tell a real deep link apart from the page's own default,
  // so every fresh visit was wrongly treated as a deep link to #intro.
  var hadHashOnLoad = !!location.hash;

  setActive(indexFromHash(), 'load');

  // In reference mode there's no paging to land the deep-linked slide in
  // view — the browser's own fragment scroll normally handles this, but
  // that's driven by the URL bar/history, not something automated
  // navigation (or every browser) reliably replicates. Doing it explicitly
  // makes deep links deterministic in reference mode instead of assuming
  // native behavior always fires.
  if (viewMode === 'reference' && hadHashOnLoad) {
    var deepLinkSlide = slides[indexFromHash()];
    if (deepLinkSlide) deepLinkSlide.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  if (viewMode === 'present') {
    initAutoplay();
  } else {
    clearPagedSlideState();
    startReferenceTracking();
  }
  updateViewToggleUI();

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
    // Escape is checked before the input/textarea guard below — a modal
    // dialog (Contents, transparency, survey, chat) must be closable by
    // Escape from its normal typing position, same as any other web
    // dialog. The input/textarea guard exists only to stop arrow/paging
    // keys from hijacking normal text-field editing (Home/End moving the
    // caret, arrow keys moving within free text), which doesn't apply to
    // Escape at all.
    if (e.key === 'Escape') { closeTransparency(); closeSurvey(); closeToc(); if (window.__prehogCloseChat) window.__prehogCloseChat(); return; }
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (viewMode !== 'present') return; // arrow/paging keys are native scroll in reference mode
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(1, 'key'); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1, 'key'); e.preventDefault(); }
    else if (e.key === 'Home') { goTo(SLIDE_IDS[0], 'key'); e.preventDefault(); }
    else if (e.key === 'End') { goTo(SLIDE_IDS[SLIDE_IDS.length - 1], 'key'); e.preventDefault(); }
  });

  // Touch swipe (single axis, deliberately simple — no gesture library).
  // Present-mode-only — in reference mode a horizontal swipe has no paging
  // meaning and should fall through to native scroll instead.
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
    if (viewMode !== 'present') return;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1, 'swipe');
    }
  }, { passive: true });

  window.addEventListener('hashchange', function () {
    if (viewMode !== 'present') return; // native anchor scroll already handles this in reference mode
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

  // ---------- Shared modal panel behavior ----------
  // role="dialog" + aria-modal="true" (transparency, survey, and Contents
  // all use it — see index.html) is a claim, not just a label: the W3C
  // modal-dialog pattern requires Tab to stay inside the dialog and the
  // rest of the page to be inert while it's open. One implementation here
  // rather than three separately-maintained copies.
  var INERT_BACKGROUND_SELECTOR = 'nav, .deck-toolbar, main.deck, .deck-chrome';
  var openPanels = []; // stack — supports the (unlikely) case of one panel opening while another is still open
  function getFocusableIn(container) {
    var nodes = container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    return Array.prototype.filter.call(nodes, function (el) { return el.offsetParent !== null; });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !openPanels.length) return;
    var topPanel = openPanels[openPanels.length - 1];
    var focusable = getFocusableIn(topPanel);
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });
  function openPanelModal(panel) {
    if (!panel || !panel.hidden) return null;
    var lastFocused = document.activeElement;
    document.querySelectorAll(INERT_BACKGROUND_SELECTOR).forEach(function (el) { el.inert = true; });
    panel.hidden = false;
    openPanels.push(panel);
    var closeBtn = panel.querySelector('.panel-close');
    if (closeBtn) closeBtn.focus();
    return lastFocused;
  }
  function closePanelModal(panel, lastFocused) {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    var idx = openPanels.indexOf(panel);
    if (idx !== -1) openPanels.splice(idx, 1);
    if (!openPanels.length) {
      document.querySelectorAll(INERT_BACKGROUND_SELECTOR).forEach(function (el) { el.inert = false; });
    }
    // preventScroll: true — a TOC link's handler calls closeToc()
    // immediately before jumpTo(), which does its own deliberate
    // scrollIntoView() to the target section. Without this, refocusing
    // lastFocused (typically the toolbar button that opened the panel,
    // near the top of the page) could trigger the browser's own
    // implicit scroll-into-view for the refocused element, landing at a
    // scroll offset jumpTo()'s later, real scroll doesn't fully correct
    // for on every engine — confirmed via bounding-rect measurement:
    // window.scrollY ended up stuck around 150px instead of the several
    // thousand needed to reach a section near the end of the page.
    if (lastFocused) lastFocused.focus({ preventScroll: true });
  }

  // Exposed so a separate chat controller (chat.js) can reuse this exact
  // open/close pair instead of a bespoke implementation — the shared-pair
  // requirement AGENTS.md states for any new dialog-role panel. Mirrors
  // the window.__prehogOpenSurvey cross-file hook below. pauseAutoplay is
  // included so opening the chat panel pauses the deck the same way the
  // other three panels already do.
  window.__prehogPanelModal = { open: openPanelModal, close: closePanelModal, pauseAutoplay: pauseAutoplay };

  // Transparency panel
  var panel = document.querySelector('[data-transparency-panel]');
  var openTriggers = Array.prototype.slice.call(document.querySelectorAll('[data-action="open-transparency"]'));
  var closeTriggers = Array.prototype.slice.call(document.querySelectorAll('[data-transparency-close]'));
  var lastFocused = null;

  function openTransparency() {
    if (!panel) return;
    pauseAutoplay('manual');
    lastFocused = openPanelModal(panel);
    emit('prehog:transparencyopen', { slideId: root.getAttribute('data-slide') });
  }
  function closeTransparency() {
    closePanelModal(panel, lastFocused);
  }
  openTriggers.forEach(function (btn) { btn.addEventListener('click', openTransparency); });
  closeTriggers.forEach(function (btn) { btn.addEventListener('click', closeTransparency); });

  // Survey panel — analytics.js populates [data-survey-body] and toggles
  // [hidden] once it has a real PostHog Survey to show; prehog.js only owns
  // the generic open/close mechanics, shared with the transparency panel.
  var surveyPanel = document.querySelector('[data-survey-panel]');
  var surveyCloseTriggers = Array.prototype.slice.call(document.querySelectorAll('[data-survey-close]'));
  var surveyLastFocused = null;
  function closeSurvey() {
    closePanelModal(surveyPanel, surveyLastFocused);
  }
  surveyCloseTriggers.forEach(function (btn) { btn.addEventListener('click', closeSurvey); });
  window.__prehogOpenSurvey = function () {
    if (!surveyPanel) return;
    pauseAutoplay('manual');
    surveyLastFocused = openPanelModal(surveyPanel);
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

  window.__prehogController = {
    goTo: goTo,
    go: go,
    getIndex: function () { return currentIndex; },
    ids: SLIDE_IDS,
    setViewMode: setViewMode,
    getViewMode: function () { return viewMode; }
  };
})();
