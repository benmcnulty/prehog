# prehog

**Context before employment.**

`prehog` is a small, responsive, PostHog-instrumented presentation built as
part of my application for the **Context Engineer** role on PostHog's
**Wizard & Docs** team. It's deployed at [benlive.tv/prehog](https://benlive.tv/prehog)
and lives here as its own repository so the artifact is independently
inspectable — not just a page on someone's portfolio, but a small system you
can clone, read, and run.

It does several jobs at once:

- a responsive, keyboard- and touch-navigable presentation (9 states, with
  a content-proportional auto-advance timer and a visible pause control)
- a real, first production implementation of the PostHog JS SDK — Product
  Analytics, masked Session Replay, exception tracking, a real custom-
  rendered Survey, and one flag-gated feature
- a small self-referential demonstration: a live log of this session's own
  captured events, visible on the page itself
- a technical-communication exercise (this README, `AGENTS.md`, and `docs/`)
- an accessibility demonstration
- a public, inspectable repository with a truthful commit history

## Why a separate repository

`benlive.tv` is a monorepo-ish pair of git repositories (root + a `public`
static-site repo). `prehog` is mounted into that site as a **git submodule**
at `public/prehog/`, rather than being written directly into the site repo,
so that:

- the repo's provenance is unambiguous — anyone can clone `prehog` on its
  own and get a complete, working artifact, not a fragment of a larger site
- the commit history for this specific piece of work stays legible, instead
  of being interleaved with unrelated site changes
- the deployed page and the reviewed repository are provably the same tree

See [`docs/architecture.md`](docs/architecture.md) for the full integration
model, including the exact Content-Security-Policy delta the host site needs.

## Stack

Plain HTML, CSS, and vanilla JavaScript (classic `<script defer>`, no
bundler, no framework), plus the PostHog JS SDK. This matches `benlive.tv`'s
existing architecture philosophy and is also the right choice on its own
merits here: the story this project tells — that context and explanation
matter more than tooling weight — is more credible coming from a page with
no build step.

```
index.html      All nine slide sections in document order; links benlive.tv's
                shared tokens/nav CSS in cascade order so they fetch in parallel
                (no-JS remains a readable scrollable document)
prehog.css      Local presentation styles built on those host tokens
                 (see docs/decisions.md for why that changed)
prehog.js       Presentation controller: paging, transitions, keyboard,
                 swipe, hash routing, auto-advance, focus management, the
                 easter egg. Knows nothing about PostHog.
analytics.js    PostHog init + event wiring, the Survey render, and the
                 recursive live-event-log panel. Knows nothing about slide
                 mechanics — it only listens for events prehog.js emits.
docs/           architecture.md, analytics.md, decisions.md
AGENTS.md       The same project context, structured for a coding agent
```

## Local development

No build step. Any static file server works:

```bash
npx serve .
# or
python3 -m http.server 8080
```

When mounted under `benlive.tv`, the page also depends on shared,
site-level assets it does not vendor itself: two scripts
(`/js/nav-toggle.js`, `/js/animation-observer.js`)
and the document head's directly linked design tokens (`/css/core/*`,
`/css/components/_navigation.css`). Opening `index.html` outside the site
will lose mobile-nav behavior and the visual styling — that's
an intentional, documented degradation (see `docs/decisions.md`), not a
bug, and the content itself stays fully readable regardless.

## Testing

Deterministic Playwright coverage lives in the `benlive.tv` root repo at
`tests/prehog.spec.js` (this repo doesn't own its own test runner, to avoid
duplicating the site's existing Playwright/Firebase-emulator setup). It
covers navigation, deep links, reduced motion, mobile layout, and — the one
that matters most for the "shipped, not just built" claim — that
`prehog_slide_viewed` never double-fires for a revisited slide.

## PostHog implementation

Product Analytics, masked Session Replay, exception tracking, a real
custom-rendered Survey, and one flag-gated feature (the recursive
live-event-log panel). The full event taxonomy, the question each event
answers, and what's deliberately *not* collected are documented in
[`docs/analytics.md`](docs/analytics.md). Which other PostHog products were
evaluated and declined — and why, including two decisions that were
reversed after real evidence — is in
[`docs/decisions.md`](docs/decisions.md).

## Accessibility

Semantic HTML first, ARIA only where native semantics run out. Full
keyboard operation (arrow keys, Home/End, Escape), visible focus states,
`prefers-reduced-motion` respected (no meaning depends on motion alone —
every animated diagram has an `sr-only` text equivalent), and touch targets
sized to 44px minimum.

## Deliberate exclusions

Experiments and Web Analytics were evaluated and declined — not because
they're bad products, but because there was no genuine question here
they'd answer better than what's already implemented. Two earlier declines
(Feature Flags, Error Tracking) were later reversed once a real reason
showed up; `docs/decisions.md` records both the original reasoning and why
it changed, rather than quietly editing history. Site-wide PostHog
instrumentation was also declined: this stays scoped to `/prehog` so the
"No analytics" claim on `benlive.tv/ai-lab/chat/` stays true.

## Lessons learned

Writing the transparency panel — the "what does this page measure?"
disclosure reachable from slide 6 — took longer than the SVG illustrations.
Explaining an analytics decision honestly, in a sentence a stranger can
read in ten seconds, is a harder design problem than drawing the diagram
that motivates it. That was expected, and is more or less the whole thesis
of the role this repo is an application for.
