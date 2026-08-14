# AGENTS.md

Structured context for a coding agent opening this repository. Humans:
prefer `README.md` — this file trades narrative for density.

## Mission

`prehog` is a static, single-page presentation deployed at
`benlive.tv/prehog`, instrumented with PostHog. It began as a
job-application artifact for a Context Engineer role and is now also a
shipped analytics case study in its own right — both framings are true
and stated explicitly (see the page's own metadata and the "why now"
slide), not one silently replacing the other. It is meant to be a
genuinely good small system on its own terms. Optimize changes for
**small surface area × correctness × explainability**, not feature
growth.

The page works two ways: **present** mode (default) is the original
guided, paged narrative; **reference** mode is the same content as a
normal scrollable, browsable document — a visitor's choice, persisted,
not two different pages. Most invariants below describe present mode
specifically; where reference mode's contract differs, it's called out
(see invariant 11).

## Architecture invariants — do not violate

1. **No build step.** Plain HTML/CSS/vanilla JS only. If a change seems to
   require a bundler or framework, that's a signal to reconsider the change,
   not to add tooling.
2. **`prehog.js` (navigation) and `analytics.js` (PostHog) stay decoupled.**
   `prehog.js` must never reference `window.posthog` or PostHog concepts
   directly. It communicates only via `document.dispatchEvent(new
   CustomEvent(...))`. `analytics.js` only ever *listens*; it never drives
   navigation. This lets navigation be tested with zero network dependency.
   `chat.js` follows the same rule: it never references `window.posthog`
   either, dispatching `prehog:chat*` CustomEvents the same way `prehog.js`
   dispatches its own — `analytics.js` is still the only file that knows
   PostHog exists.
3. **Progressive enhancement is load-bearing, not decorative.** With
   JavaScript disabled, `index.html` must render as one readable scrollable
   document with all nine `<section class="slide">` elements visible in
   order. Do not add a feature whose *only* implementation is JS-gated
   content with no fallback. `.deck-toolbar` (the view-mode toggle and
   Contents button) starts `hidden` in the markup for exactly this reason
   — without JS there's no controller to drive either one, and the page is
   already the reference-style document those controls would otherwise
   promise; a new JS-only control should default to hidden the same way,
   not render as dead UI for no-JS visitors.
4. **`index.html` links `benlive.tv`'s shared design tokens directly**
   (the ordered `/css/core/*` links plus `/css/components/_navigation.css`,
   ahead of `prehog.css`). Keep them as direct links instead of CSS
   `@import`s so the browser can fetch them in parallel. This reverses an earlier "must
   render standalone when cloned" rule — that framing was aspirational and
   never actually true once the shared nav was introduced; the repo already
   depended on host-only scripts (`nav-toggle.js`, `animation-observer.js`)
   with documented degradation, so extending that same acknowledged
   coupling to CSS is consistent, not new. This presentation deliberately
   has no site footer. In present (paged) mode the persistent deck
   controller is the bottom edge of the interface; in reference mode
   (see invariant 11) the deck controller is hidden and `.deck-toolbar`
   — `position: sticky`, not the site's usual pattern — is the thing that
   stays reachable instead, since that mode's document can run several
   viewports long.
5. **No meaning may depend solely on motion.** Every `[data-animate-draw]`
   SVG has a paired `<figcaption class="sr-only">` describing what the
   diagram shows. `prefers-reduced-motion: reduce` must disable all
   animation without hiding any content — including SVG SMIL `<animate>`
   elements (`[data-idle-pulse]`), which `animation-play-state` and CSS
   classes do **not** affect; `prehog.js` removes them from the DOM
   directly when `prefers-reduced-motion` is set.
6. **Event names are the public API of `analytics.js`.** The twelve
   `prehog_*` custom events (plus the standard PostHog `survey shown` /
   `survey sent` / `survey dismissed` triad) are documented in
   `docs/analytics.md`. Renaming, adding, or removing one requires updating
   that doc and `tests/prehog.spec.js` (or `tests/prehog-chat.spec.js` for
   the `prehog_chat_*` events) in the same change — do not let them drift.
7. **`prehog_slide_viewed` fires at most once per slide per browser
   session.** Deduplication happens in `analytics.js` via an in-memory
   `Set`, not in PostHog. This is tested; do not remove the guard to
   "simplify" the code.
8. **The recursive live-event-log panel is gated behind the
   `prehog-recursive-panel` feature flag**, checked via
   `posthog.onFeatureFlags` / `isFeatureEnabled` in `analytics.js`. It
   defaults to hidden until that flag is created in the PostHog dashboard —
   this is intentional (a genuine, inspectable rollout control, not fake
   decoration; see `docs/decisions.md`). Don't make it unconditionally
   visible without updating that reasoning.
9. **The Survey shown on the final slide is a real PostHog Survey object**
   (type `"api"`, created via PostHog's Surveys API — not PostHog's default
   popover). `analytics.js` renders it with the site's own CSS and submits
   responses via the documented manual `survey sent` capture pattern so
   they land in PostHog's own Surveys reporting UI. Timing (only after
   `prehog_completed`) is decided client-side in `analytics.js`, not via
   PostHog display conditions — simpler and fully covered by
   `tests/prehog.spec.js` rather than depending on an unverified
   conditions-JSON shape.
10. **Paged layout is a viewport grid, not fixed-height arithmetic — but
    this only describes present mode.** The controller is an intrinsic
    bottom row and the deck is the flexible middle row (`body.js-paged`'s
    4-row grid — nav, `.deck-toolbar`, `.deck`, `.deck-chrome`). Slides
    overlap absolutely inside the deck and animate with compositor-friendly
    `transform`/`opacity`; long slides scroll internally. Preserve this
    contract when changing navigation or transitions so the controller
    cannot be clipped or pushed below the fold.
11. **Reference mode is normal document flow, on purpose — do not give it
    its own layout.** Toggling to reference mode removes `.js-paged`
    entirely rather than switching to a second bespoke layout; every slide
    becomes a normal, scrollable, non-`inert` block using the *same* base
    CSS the no-JS fallback already relies on (invariant 3). If a change
    needs reference-mode-specific layout rules beyond hiding
    `.deck-chrome` and making `.deck-toolbar` sticky, that's a sign the
    change should be reconsidered, not that reference mode needs its own
    grid. `prehog.js`'s scrollspy (`startReferenceTracking`) keeps
    `currentIndex`/hash/`data-slide` in sync with manual scrolling in this
    mode — any code path that changes `currentIndex` needs to stay correct
    whichever mode is active, since `setActive()` is shared and mode-aware
    rather than duplicated per mode.

## Commands

There is no `package.json` in this repo (no dependencies to install). To
preview:

```bash
npx serve .
```

Tests for this repo live in the parent site's repo, not here:
`benlive.tv/tests/prehog.spec.js`, run via
`PW_USE_EXISTING_SERVER=1 bunx playwright test tests/prehog.spec.js`
against a running `firebase emulators:start`.

## Testing expectations

Before proposing a change to `prehog.js` or `analytics.js`, trace it against
`tests/prehog.spec.js` in the site repo: next/prev, arrow keys, deep link
restore (`#context` on load must show the context slide, not slide 1),
swipe, `prefers-reduced-motion`, mobile viewport (390px), and the
slide-view-dedup guarantee. A change that isn't coverable by that spec
without network mocking is probably breaking invariant #2.

Any change touching navigation, `setActive()`, or the analytics event
bridge needs to be traced against **both** view modes, not just present —
the `prehog: view mode` describe block covers mode persistence (including
across a reload, with the actual layout checked, not just the state
attributes), position sync in both switch directions, the sticky
toolbar's reachability, and the Contents panel's focus trap. A change that
only makes sense in one mode is a signal to check invariant 11.

## Analytics rules

- Every new custom event must answer a **question**, stated in
  `docs/analytics.md` before the event is added — not the reverse.
- No event may carry free text, an email, a name, or precise location.
- If a new event's information is already available from PostHog's
  autocapture or the standard `$pageview`, don't add it — document the
  overlap and skip it (see `prehog_viewed`'s omission in `docs/decisions.md`
  as the precedent).
- Session Replay stays scoped to this one page and stays masked
  (`maskAllInputs: true`). Don't broaden its scope without updating
  `docs/decisions.md` with the new question it's answering.

## Accessibility expectations

- Native HTML semantics before ARIA. `role="dialog"` + `aria-modal="true"`
  is load-bearing, not decorative, on all three of this page's panels
  (transparency, survey, Contents) — a review caught a first pass where it
  was declared but not actually enforced (Tab could escape to background
  controls). All three now share one implementation,
  `openPanelModal`/`closePanelModal` in `prehog.js`: background content
  (`nav`, `.deck-toolbar`, `main.deck`, `.deck-chrome`) goes `inert` while
  any panel is open, Tab/Shift+Tab is trapped to the topmost open panel,
  and focus returns to whatever triggered it on close. A new dialog-role
  panel must go through this shared pair, not a bespoke open/close — that
  was exactly the gap the review found.
- Every interactive control needs a minimum 44×44px hit target
  (`--touch` token in `prehog.css`) — this is enforced by convention, not
  a test, so check it by hand when adding a new control.

## Constraints from the host site (`benlive.tv`)

This repo is mounted as a git submodule at `benlive.tv`'s `public/prehog/`.
It depends on scripts and styles it does not vendor, all absolute-pathed
against the host site's domain:
- `/js/nav-toggle.js`, `/js/animation-observer.js` — nav behavior and
  off-screen animation pausing.
- `/js/analytics/consent.js`, `/js/analytics/events.js`,
  `/js/analytics/index.js` — the shared analytics layer this repo's own
  `analytics.js` is a domain adapter onto. It owns PostHog init, consent
  gating, and delivery; this repo's `analytics.js` has no init code path
  of its own (see `docs/architecture.md`'s "Where PostHog init actually
  lives"). Without these three loading, `window.BenLiveAnalytics` doesn't
  exist and `analytics.js`'s own `capture()` no-ops — the deck stays fully
  functional, just uninstrumented (see invariant #2).
- The host's directly linked shared CSS partials (`/css/core/*`,
  `/css/components/_navigation.css`, `/css/components/_analytics-consent.css`)
  per invariant #4 — the last one styles the consent link the shared
  layer injects into this page's nav (see invariant 11).
The host's `firebase.json` Content-Security-Policy must allow
`https://t.benlive.tv` in `script-src` (the SDK's initial module loads from
`cdn.jsdelivr.net`, but it dynamically fetches feature bundles — config,
surveys, exception autocapture — from `api_host` at runtime regardless, and
`api_host` is the PostHog reverse proxy, not PostHog's asset CDN directly;
see `docs/decisions.md`), plus `https://us-assets.i.posthog.com` as a
defensive fallback, and declare `worker-src 'self' blob:` for Session
Replay to function — see `docs/architecture.md` for the exact required
header delta. If PostHog
events silently stop working in production, check the CSP first — it's
versioned in the host repo, but production headers can still drift from
what's committed, which is what `tests/prehog.spec.js`'s CSP assertion
guards against.
