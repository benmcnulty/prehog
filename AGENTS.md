# AGENTS.md

Structured context for a coding agent opening this repository. Humans:
prefer `README.md` — this file trades narrative for density.

## Mission

`prehog` is a static, single-page presentation deployed at
`benlive.tv/prehog`, instrumented with PostHog. It is a job-application
artifact for a Context Engineer role, and it is also meant to be a genuinely
good small system on its own terms. Optimize changes for **small surface
area × correctness × explainability**, not feature growth.

## Architecture invariants — do not violate

1. **No build step.** Plain HTML/CSS/vanilla JS only. If a change seems to
   require a bundler or framework, that's a signal to reconsider the change,
   not to add tooling.
2. **`prehog.js` (navigation) and `analytics.js` (PostHog) stay decoupled.**
   `prehog.js` must never reference `window.posthog` or PostHog concepts
   directly. It communicates only via `document.dispatchEvent(new
   CustomEvent(...))`. `analytics.js` only ever *listens*; it never drives
   navigation. This lets navigation be tested with zero network dependency.
3. **Progressive enhancement is load-bearing, not decorative.** With
   JavaScript disabled, `index.html` must render as one readable scrollable
   document with all nine `<section class="slide">` elements visible in
   order. Do not add a feature whose *only* implementation is JS-gated
   content with no fallback.
4. **`index.html` links `benlive.tv`'s shared design tokens directly**
   (the ordered `/css/core/*` links plus `/css/components/_navigation.css`,
   ahead of `prehog.css`). Keep them as direct links instead of CSS
   `@import`s so the browser can fetch them in parallel. This reverses an earlier "must
   render standalone when cloned" rule — that framing was aspirational and
   never actually true once nav/footer markup was copied in verbatim; the
   repo already depended on host-only scripts (`theme-toggle.js`,
   `nav-toggle.js`) with documented degradation, so extending that same
   acknowledged coupling to CSS is consistent, not new. The one exception:
   the footer CSS block is copied verbatim (commented, with its source
   noted) rather than importing `landing.css` wholesale, to avoid pulling
   in unrelated hero/marketing rules — keep that block in sync by hand if
   the source page's footer styling changes.
5. **No meaning may depend solely on motion.** Every `[data-animate-draw]`
   SVG has a paired `<figcaption class="sr-only">` describing what the
   diagram shows. `prefers-reduced-motion: reduce` must disable all
   animation without hiding any content — including SVG SMIL `<animate>`
   elements (`[data-idle-pulse]`), which `animation-play-state` and CSS
   classes do **not** affect; `prehog.js` removes them from the DOM
   directly when `prefers-reduced-motion` is set.
6. **Event names are the public API of `analytics.js`.** The seven
   `prehog_*` custom events (plus the standard PostHog `survey shown` /
   `survey sent` / `survey dismissed` triad) are documented in
   `docs/analytics.md`. Renaming, adding, or removing one requires updating
   that doc and `tests/prehog.spec.js` in the same change — do not let them
   drift.
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
10. **Paged layout is a viewport grid, not fixed-height arithmetic.** The
    controller is an intrinsic bottom row and the deck is the flexible middle
    row. Slides overlap absolutely inside the deck and animate with compositor-
    friendly `transform`/`opacity`; long slides scroll internally. Preserve
    this contract when changing navigation or transitions so the controller
    cannot be clipped or pushed below the fold.

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
  on the transparency panel is the one place ARIA is load-bearing; keep
  focus trap/return behavior (`prehog.js`, `openTransparency`/
  `closeTransparency`) intact if you touch that code.
- Every interactive control needs a minimum 44×44px hit target
  (`--touch` token in `prehog.css`) — this is enforced by convention, not
  a test, so check it by hand when adding a new control.

## Constraints from the host site (`benlive.tv`)

This repo is mounted as a git submodule at `benlive.tv`'s `public/prehog/`.
It depends on three scripts it does not vendor — `/js/theme-toggle.js`,
`/js/nav-toggle.js`, `/js/animation-observer.js` — and now also on the
host's directly linked shared CSS partials (`/css/core/*`, `/css/components/_navigation.css`)
per invariant #4, all absolute-pathed against the host site's domain.
The host's `firebase.json` Content-Security-Policy must allow
`https://us-assets.i.posthog.com` in `script-src` (the SDK's initial module
loads from `cdn.jsdelivr.net`, but it dynamically fetches feature bundles —
config, surveys, exception autocapture — from PostHog's own asset CDN at
runtime regardless) and declare `worker-src 'self' blob:` for Session
Replay to function — see `docs/architecture.md` for the exact required
header delta. If PostHog
events silently stop working in production, check the CSP first — it's
versioned in the host repo, but production headers can still drift from
what's committed, which is what `tests/prehog.spec.js`'s CSP assertion
guards against.
