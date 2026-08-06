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
4. **`prehog.css` is self-contained.** It intentionally does not `@import`
   `benlive.tv`'s shared `/css/core/*` partials, because this repo must
   render correctly when cloned and opened standalone — reviewers are
   expected to do exactly that. Do not add a dependency on the host site's
   global stylesheets.
5. **No meaning may depend solely on motion.** Every `[data-animate-draw]`
   SVG has a paired `<figcaption class="sr-only">` describing what the
   diagram shows. `prefers-reduced-motion: reduce` must disable all
   animation without hiding any content.
6. **Event names are the public API of `analytics.js`.** The five
   `prehog_*` custom events are documented in `docs/analytics.md`. Renaming,
   adding, or removing one requires updating that doc and
   `tests/prehog.spec.js` in the same change — do not let them drift.
7. **`prehog_slide_viewed` fires at most once per slide per browser
   session.** Deduplication happens in `analytics.js` via an in-memory
   `Set`, not in PostHog. This is tested; do not remove the guard to
   "simplify" the code.

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
It depends on two scripts it does not vendor: `/js/theme-toggle.js` and
`/js/nav-toggle.js`, both absolute-pathed against the host site's domain.
The host's `firebase.json` Content-Security-Policy must declare
`worker-src 'self' blob:` for Session Replay to function (the PostHog SDK
itself loads from `cdn.jsdelivr.net`, already allowed for other site
dependencies, so no PostHog-specific `script-src` entry is needed) — see
`docs/architecture.md` for the exact required header delta. If PostHog
events silently stop working in production, check the CSP first — it's
versioned in the host repo, but production headers can still drift from
what's committed, which is what `tests/prehog.spec.js`'s CSP assertion
guards against.
