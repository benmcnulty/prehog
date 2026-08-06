# prehog

**Context before employment.**

`prehog` is a small, responsive, PostHog-instrumented presentation built as
part of my application for the **Context Engineer** role on PostHog's
**Wizard & Docs** team. It's deployed at [benlive.tv/prehog](https://benlive.tv/prehog)
and lives here as its own repository so the artifact is independently
inspectable — not just a page on someone's portfolio, but a small system you
can clone, read, and run.

It does several jobs at once:

- a responsive, keyboard- and touch-navigable presentation (9 states)
- a real, first production implementation of the PostHog JS SDK
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
index.html      All nine slide sections, in document order (no-JS fallback
                 renders as a single scrollable page — see prehog.js header
                 comment for the full progressive-enhancement contract)
prehog.css      Self-contained token system (does not import benlive.tv's
                 shared CSS — see docs/architecture.md for why)
prehog.js       Presentation controller: paging, keyboard, swipe, hash
                 routing, focus management. Knows nothing about PostHog.
analytics.js    PostHog init + event wiring. Knows nothing about slide
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

When mounted under `benlive.tv`, the page also depends on two shared,
site-level scripts it does not vendor itself: `/js/theme-toggle.js` and
`/js/nav-toggle.js`. Opening `index.html` standalone (outside the site) will
render correctly but those two behaviors (theme persistence, mobile nav)
will no-op — that's an intentional, documented degradation, not a bug.

## Testing

Deterministic Playwright coverage lives in the `benlive.tv` root repo at
`tests/prehog.spec.js` (this repo doesn't own its own test runner, to avoid
duplicating the site's existing Playwright/Firebase-emulator setup). It
covers navigation, deep links, reduced motion, mobile layout, and — the one
that matters most for the "shipped, not just built" claim — that
`prehog_slide_viewed` never double-fires for a revisited slide.

## PostHog implementation

Product Analytics, masked Session Replay, and one end-of-deck Survey. The
full event taxonomy, the question each event answers, and what's
deliberately *not* collected are documented in
[`docs/analytics.md`](docs/analytics.md). Which other PostHog products were
evaluated and declined — and why — is in
[`docs/decisions.md`](docs/decisions.md).

## Accessibility

Semantic HTML first, ARIA only where native semantics run out. Full
keyboard operation (arrow keys, Home/End, Escape), visible focus states,
`prefers-reduced-motion` respected (no meaning depends on motion alone —
every animated diagram has an `sr-only` text equivalent), and touch targets
sized to 44px minimum.

## Deliberate MVP exclusions

Feature Flags, Experiments, Web Analytics, and Error Tracking were evaluated
against this project and declined — not because they're bad products, but
because there was no genuine question here that they'd answer. See
`docs/decisions.md`. Site-wide PostHog instrumentation was also declined:
this stays scoped to `/prehog` so the "No analytics" claim on
`benlive.tv/ai-lab/chat/` stays true.

## Lessons learned

Writing the transparency panel — the "what does this page measure?"
disclosure reachable from slide 6 — took longer than the SVG illustrations.
Explaining an analytics decision honestly, in a sentence a stranger can
read in ten seconds, is a harder design problem than drawing the diagram
that motivates it. That was expected, and is more or less the whole thesis
of the role this repo is an application for.
