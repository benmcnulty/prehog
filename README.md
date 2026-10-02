# prehog

**Context before employment.**

A maintained context-engineering and PostHog analytics case study, originally
built while exploring a Context Engineer opportunity. That application is complete;
I am now considering other opportunities centered on clear context, autonomy and
thoughtful delivery. The generalized companion is [Context First](https://benlive.tv/context-first/).
Live at [benlive.tv/prehog](https://benlive.tv/prehog).

## Results

- Works two ways: a guided, paged narrative (9 slides, keyboard and touch
  navigation, content-proportional auto-advance) or, toggled and persisted,
  a normal browsable long-form document. Same content, a visitor's choice,
  not two different pages.
- A no-JS document fallback and accessibility-oriented navigation, focus
  management and reduced-motion handling. Automated accessibility checks are
  scoped to the host's tested pages/states; they are not a WCAG compliance certification.
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

## Historical status and verification

This is a maintained historical case study of a completed application, not an
active hiring submission, an endorsement by PostHog or evidence of private hiring
decisions. Shared usability improvements may continue; this is not an untouched
archive of the original source.

There is no package manifest or build step. `python -m http.server 8000` provides
a partial source preview at <http://localhost:8000>, but host-absolute shared CSS,
navigation, analytics and chat resources are absent from this tree. No API key is
required to inspect the source. Cloning alone does not recreate the hosted behavior.

Public CI checks JavaScript/CSS linting and tracked-content secret patterns. The
documented Playwright suite belongs to the separate host checkout. It was not
rerun during the 2026-10-02 portfolio documentation review; current analytics
delivery, mobile/keyboard journeys, reduced-motion behavior and complete
accessibility coverage remain unverified by that review. Existing architectural
descriptions explain the implementation, not a fresh certification of every live service.

Contributions should preserve historical context, stable anchors, event names,
navigation/analytics separation and the privacy rules in [AGENTS.md](AGENTS.md).
No standalone license file is present in this snapshot; preserve existing
authorship and provenance.

## Documentation

- [`docs/analytics.md`](docs/analytics.md) — event taxonomy, the question
  each event answers, what's deliberately not collected
- [`docs/decisions.md`](docs/decisions.md) — PostHog products implemented
  vs. declined, and why, including reversed calls
- [`docs/architecture.md`](docs/architecture.md) — integration model, CSP
  requirements, deployment
