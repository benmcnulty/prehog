# prehog

**Context before employment.**

A responsive, PostHog-instrumented presentation that began as my application
to the **Context Engineer** role on PostHog's **Wizard & Docs** team, and is
now also a shipped analytics case study in its own right. Both are true at
once, stated as such on the page itself, not one quietly replacing the
other. Live at [benlive.tv/prehog](https://benlive.tv/prehog); this repo is
the inspectable source behind it, mounted into the host site as a git
submodule so the deployed page and this reviewed repository are provably the
same tree.

## Results

- Works two ways: a guided, paged narrative (9 slides, keyboard and touch
  navigation, content-proportional auto-advance) or, toggled and persisted,
  a normal browsable long-form document. Same content, a visitor's choice,
  not two different pages.
- Full no-JS fallback (every section readable without JavaScript), zero
  `wcag2a`/`wcag2aa` violations in either view mode.
- First production PostHog JS SDK implementation: Product Analytics, masked
  Session Replay, exception tracking, a real custom-rendered Survey, and one
  flag-gated feature, all routed through a PostHog-managed reverse proxy
  (`t.benlive.tv`) for ad-blocker resilience.
- A self-referential live event log on the page itself, showing exactly what
  this session has had accepted for delivery to PostHog, in real time
  (queued events are logged when accepted, not only once actually
  delivered; see `docs/analytics.md`).
- Deterministic Playwright coverage in the host repo
  (`tests/prehog.spec.js`), including the guarantee that
  `prehog_slide_viewed` never double-fires on a revisit, across both view
  modes.
- Public repo, truthful commit history, decisions documented, including
  reversed calls and post-ship review findings, rather than silently edited.

## Reviewing this implementation

This repo is meant to be read, not run. The page depends on the host site
for shared tokens, nav behavior, the consent UI, and the PostHog layer
itself (see [`docs/architecture.md`](docs/architecture.md) for exactly what
and why), so cloning it standalone won't reproduce the live experience.
The fastest path to understanding what's actually built:

1. **Start with the live page** — [benlive.tv/prehog](https://benlive.tv/prehog) — then open this repo alongside it.
2. **`index.html`** — all nine slide sections in document order. Read the HTML comments; they explain non-obvious CSS and layout decisions inline.
3. **`prehog.js`** — the controller: paging, transitions, keyboard and swipe handling, hash routing, auto-advance, focus management, the present/reference view-mode toggle and its scrollspy, and the shared modal (focus-trap) behavior every panel on the page uses. It knows nothing about PostHog.
4. **`analytics.js`** — the domain adapter onto the host site's shared analytics layer (`/js/analytics/*`, which owns PostHog init, consent gating, and delivery). It maps this page's own events onto that layer, and renders the Survey and the live-event-log panel. It knows nothing about slide mechanics.
5. **`docs/decisions.md`** — which PostHog products got implemented, which got declined, and why, including calls that were reversed after review.
6. **`docs/analytics.md`** — the event taxonomy: what each event answers, what's deliberately not collected, and the privacy line around AI chat content.
7. **`docs/architecture.md`** — the integration model and the exact CSP requirements the host site carries for this page.
8. **`AGENTS.md`** — the same project context, restructured as a set of invariants, aimed at a coding agent picking up this repo cold. It's a useful second pass if you want the "what would break if you changed X" view rather than the narrative one.

## How it's organized

```
index.html      All nine slide sections in document order; links benlive.tv's
                shared tokens/nav CSS in cascade order (no-JS stays readable)
prehog.css      Local presentation styles built on host tokens
prehog.js       Controller: paging, transitions, keyboard, swipe, hash
                routing, auto-advance, focus management, the present/
                reference view-mode toggle and its scrollspy, and the
                shared modal (focus-trap) behavior all three of the page's
                panels use. Knows nothing about PostHog.
analytics.js    Domain adapter onto benlive.tv's shared analytics layer
                (/js/analytics/*, which owns PostHog init, consent
                gating, and delivery). Maps this page's own events onto
                it, renders the Survey and the live-event-log panel.
                Knows nothing about slide mechanics.
docs/           architecture.md, analytics.md, decisions.md
AGENTS.md       Same project context, structured for a coding agent
```

## Documentation

- [`docs/analytics.md`](docs/analytics.md) — event taxonomy, the question
  each event answers, what's deliberately not collected
- [`docs/decisions.md`](docs/decisions.md) — PostHog products implemented
  vs. declined, and why, including reversed calls
- [`docs/architecture.md`](docs/architecture.md) — integration model, CSP
  requirements, deployment
