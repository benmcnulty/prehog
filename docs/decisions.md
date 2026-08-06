# Decisions

Records choices that weren't obvious, including products and features that
were evaluated and declined. The judgment is part of the artifact.

## PostHog products: implemented vs. declined

| Product | Status | Reasoning |
|---|---|---|
| **Product Analytics** | Implemented | Baseline requirement — the whole project is about turning questions into a small event model. |
| **Session Replay** | Implemented, scoped + masked | Real diagnostic question: is slide navigation discoverable on mobile. Turned on for this page only, with `maskAllInputs: true`. Should be turned off once that question is answered, not left running indefinitely. |
| **Surveys** | Implemented, minimal | One two-question, dismissible, end-of-deck prompt. Chosen over a longer survey specifically to demonstrate restraint — a single well-placed question beats a form. |
| **Feature Flags** | Declined | There is no rollout happening on this page — it's a single static deck shown identically to everyone. Creating a flag with no real branch behind it would be exactly the "fake experiment for résumé optics" this project explicitly tries to avoid. Revisit only if a genuine A/B question emerges (e.g., testing two different intro copy variants pre-launch). |
| **Experiments** | Declined, same reasoning as Feature Flags | No hypothesis with enough traffic to reach significance exists for a single-page job-application artifact. |
| **Web Analytics** | Declined | Would duplicate Product Analytics' pageview/session data for this use case with a different UI. Not enough distinct value to justify a second product surface for one page. |
| **Error Tracking** | Implemented, narrow | Revised from an earlier "declined for MVP" call. The original reasoning (no server-side logic to fail, Playwright already catches regressions faster than a dashboard) still holds for *development-time* bugs. What it missed: production has no Playwright running — a runtime error on someone's actual phone during the actual application review is exactly the kind of failure this project can't afford to be blind to, and `capture_exceptions: true` on the SDK already loaded on this page costs nothing to enable (no new dependency, no new product surface, one boolean). Scoped narrowly: unhandled exceptions and unhandled promise rejections only, not `console.error` capture — this page has no console.error call sites worth turning into tracked events. Full PostHog Error Tracking (issue grouping, alerting workflows) is still out of scope; this is just "don't fly blind in production." |
| **AI-related PostHog capabilities** (e.g. LLM observability) | Declined | Not applicable — this page makes no LLM calls at runtime. Noted here so it's clear the surface was reviewed, not missed. |

## Scoping PostHog to `/prehog` only, not site-wide

`benlive.tv/ai-lab/chat/` currently displays "No analytics" as a stated
privacy property. Instrumenting the whole site would make that claim false
without a corresponding copy change, and would meaningfully increase the
blast radius of adding a new third-party script. Scoping to `/prehog` (and,
per the resume-alignment work, optionally `/about`) keeps the analytics
story honest and the risk contained to the one page that's explicitly about
demonstrating PostHog competence.

## Why `prehog_viewed` doesn't exist

PostHog's default `$pageview` autocapture already answers "did someone open
this page" with zero custom code. Adding a synonymous custom event would be
exactly the kind of autocapture-overlap noise `docs/analytics.md` is meant
to prevent. Documented instead of silently omitted, so the absence reads as
a decision, not an oversight.

## Why `prehog_outbound_clicked` exists despite autocapture overlap

This is the one event kept even though PostHog's autocapture would already
record the underlying clicks. The `label` and `slide_id` properties give
attribution that's much easier to query than reconstructing intent from
autocaptured DOM selectors — and outbound engagement (does anyone actually
open the repo, does anyone continue to `/about`) is the single most
important signal this whole project exists to produce.

## Reverse proxy for PostHog ingestion

Not implemented. `connect-src` in the host CSP already permits
`us.i.posthog.com` directly (see `docs/architecture.md`), so a Firebase
Function reverse-proxy would add operational surface (a new endpoint, a new
failure mode, cold starts) with no corresponding benefit for a page at this
scale. Worth revisiting only if ad-blocker interference with direct
PostHog domains becomes a measured problem.

## Live event capture can't be verified through headless Playwright

PostHog's SDK includes bot/automation filtering that checks
`navigator.webdriver` (true for every browser automation tool, including
Playwright) alongside other headless-Chromium fingerprints, and silently
drops `.capture()` calls for anything it flags. This was confirmed directly
against the real project during setup: `posthog.init()`, the `/flags/`
handshake, and PostHog's own dynamically-loaded feature scripts all
succeeded with real network requests and a 200 response — only the actual
event-capture call never produced a request, and it stopped exactly when
`navigator.webdriver` was true.

This is the SDK behaving correctly, not a bug to work around. It does mean
`tests/prehog.spec.js`'s analytics assertions run against a stubbed
`window.posthog` (see `window.__PREHOG_TEST_STUB__` in `analytics.js`) by
necessity, not just for speed — a real-SDK equivalent test would silently
pass for the wrong reason (bot-filtered, not delivered) or require
defeating PostHog's own anti-bot protection, which isn't something a test
suite should be doing. Confirming true production delivery means checking
PostHog's Activity/Live Events view from an actual, non-automated browser
after deploy — there's no way to fully substitute for that from CI.
