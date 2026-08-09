# prehog

**Context before employment.**

A responsive, PostHog-instrumented presentation built for my application to
the **Context Engineer** role on PostHog's **Wizard & Docs** team. Live at
[benlive.tv/prehog](https://benlive.tv/prehog); this repo is the independently
cloneable, inspectable source behind it.

## Results

- 9-slide presentation: keyboard + touch navigation, content-proportional
  auto-advance, full no-JS fallback, zero `wcag2a`/`wcag2aa` violations
- First production PostHog JS SDK implementation: Product Analytics, masked
  Session Replay, exception tracking, a real custom-rendered Survey, and one
  flag-gated feature — all routed through a PostHog-managed reverse proxy
  (`t.benlive.tv`) for ad-blocker resilience
- A self-referential live event log on the page itself, showing exactly what
  this session has sent to PostHog in real time
- Deterministic Playwright coverage in the host repo
  (`tests/prehog.spec.js`), including the guarantee that
  `prehog_slide_viewed` never double-fires on a revisit
- Public repo, truthful commit history, decisions documented — including
  three reversed calls — rather than silently edited

## How it's organized

```
index.html      All nine slide sections in document order; links benlive.tv's
                shared tokens/nav CSS in cascade order (no-JS stays readable)
prehog.css      Local presentation styles built on host tokens
prehog.js       Presentation controller — paging, transitions, keyboard,
                 swipe, hash routing, auto-advance, focus management.
                 Knows nothing about PostHog.
analytics.js    PostHog init, event wiring, Survey render, live-event-log
                 panel. Knows nothing about slide mechanics.
docs/           architecture.md, analytics.md, decisions.md
AGENTS.md       Same project context, structured for a coding agent
```

Mounted into `benlive.tv` as a git submodule at `public/prehog/` rather than
written directly into that site repo, so the deployed page and this
reviewed repository are provably the same tree. Full integration model and
the exact CSP delta the host site needs: [`docs/architecture.md`](docs/architecture.md).

## Run it locally

```bash
npx serve .
```

No build step. Outside `benlive.tv` the page loses shared nav/styling
(intentional, documented degradation — see `docs/decisions.md`); content
stays fully readable.

## Documentation

- [`docs/analytics.md`](docs/analytics.md) — event taxonomy, the question
  each event answers, what's deliberately not collected
- [`docs/decisions.md`](docs/decisions.md) — PostHog products implemented
  vs. declined, and why, including reversed calls
- [`docs/architecture.md`](docs/architecture.md) — integration model, CSP
  requirements, deployment
