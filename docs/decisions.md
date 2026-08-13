# Decisions

Records choices that weren't obvious, including products and features that
were evaluated and declined. The judgment is part of the artifact.

## PostHog products: implemented vs. declined

| Product | Status | Reasoning |
|---|---|---|
| **Product Analytics** | Implemented | Baseline requirement — the whole project is about turning questions into a small event model. |
| **Session Replay** | Implemented, scoped + masked | Real diagnostic question: is slide navigation discoverable on mobile. Turned on for this page only, with `maskAllInputs: true`. Should be turned off once that question is answered, not left running indefinitely. |
| **Surveys** | Implemented, minimal, real | A real Survey object (type `"api"`, two questions: 1–5 rating + open text), created via PostHog's Surveys API and custom-rendered in this page's own CSS rather than PostHog's default popover. Chosen over a longer survey specifically to demonstrate restraint — a single well-placed exchange beats a form. Display timing is decided client-side (after `prehog_completed`) rather than via PostHog conditions — see `docs/analytics.md`. |
| **Feature Flags** | Implemented, one flag, narrow | Reverses an earlier "declined" call. The original reasoning (no rollout happening, a flag with no real branch is the "fake experiment for résumé optics" this project explicitly avoids) still holds for A/B-style flags. What changed: the recursive live-event-log panel (§ below) is a genuine candidate for a real rollout control — something worth being able to turn on for specific visitors without a redeploy — and `prehog-recursive-panel` is exactly that, not a fake variant test. Still declined: anything resembling an A/B experiment, since there's no hypothesis with enough traffic to reach significance on a single-page artifact. |
| **Experiments** | Declined, same reasoning as Feature Flags | No hypothesis with enough traffic to reach significance exists for a single-page job-application artifact. |
| **Web Analytics** | Declined | Would duplicate Product Analytics' pageview/session data for this use case with a different UI. Not enough distinct value to justify a second product surface for one page. |
| **Error Tracking** | Implemented, narrow | Revised from an earlier "declined for MVP" call. The original reasoning (no server-side logic to fail, Playwright already catches regressions faster than a dashboard) still holds for *development-time* bugs. What it missed: production has no Playwright running — a runtime error on someone's actual phone during the actual application review is exactly the kind of failure this project can't afford to be blind to, and `capture_exceptions: true` on the SDK already loaded on this page costs nothing to enable (no new dependency, no new product surface, one boolean). Scoped narrowly: unhandled exceptions and unhandled promise rejections only, not `console.error` capture — this page has no console.error call sites worth turning into tracked events. Full PostHog Error Tracking (issue grouping, alerting workflows) is still out of scope; this is just "don't fly blind in production." |
| **AI-related PostHog capabilities** (e.g. LLM observability) | Declined | Not applicable — this page makes no LLM calls at runtime. Noted here so it's clear the surface was reviewed, not missed. |

## Reversed: PostHog scoped to `/prehog` only, not site-wide

The original call here was to keep PostHog scoped to this one page.
`benlive.tv/ai-lab/chat/` displayed "No analytics" as a stated privacy
property at the time, instrumenting the whole site would have made that
claim false without a corresponding copy change, and adding a new
third-party script site-wide meaningfully increases blast radius. Scoping
to `/prehog` kept the analytics story honest and the risk contained to
the one page explicitly about demonstrating PostHog competence.

**Reversed in the host site's own Session B** (`benlive.tv`'s
`docs/ARCHITECTURE.md` §3). What changed: building `/prehog`'s
instrumentation properly — a real consent gate, a real taxonomy, real
"what's deliberately not collected" discipline — surfaced that the same
architecture was worth having site-wide, not kept as a one-page
demonstration. `public/js/analytics/{consent,events,index}.js` in the
host repo generalizes exactly the pattern this repo's own `analytics.js`
established: pages emit semantic DOM events, one shared file decides
whether they become real `capture()` calls, gated on consent. It now runs
across the site's primary public surfaces — landing, About, Portfolio,
Hire Me, Blog, AI Lab (hub and all four sub-apps), `/prehog/` itself
(via this repo's own adapter), and `/privacy/` — with `/login/`, `/port/`,
`/webxr/`, `/benu/`, `/menus/`, and `/tools/` still deliberately excluded
(see the host repo's own architecture doc for why each). The AI Lab
chat page's privacy copy was updated alongside the rollout: it no longer
says "No analytics," and instead states precisely what is and isn't
collected there (one aggregate `bl_chat_engaged` event per session; chat
message text, prompts, and responses are never sent).

What made this acceptable where the original narrow-scope reasoning
correctly said it wasn't: the risk the original decision was weighing —
adding a third-party script's blast radius without the consent/
disclosure discipline to back it up — is exactly what the shared layer
now provides everywhere it runs, not just here. A visitor gets the same
opt-out-with-visible-notice contract on any instrumented page, the same
taxonomy discipline (a new event has to answer a stated question, same
rule as this repo's own `AGENTS.md`), and the same "no free text, no PII"
constraint. The blast-radius concern was really an architecture-maturity
concern, and once the architecture existed, scoping to one page stopped
being the safer choice and started being an inconsistency — a
`bl_*`-taxonomy event on `/about/` and a `prehog_*` one here disclose
under the same consent gate and the same `/privacy/` page now, so keeping
them artificially separated no longer served the honesty goal it was
originally protecting.

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

## The recursive live-event-log panel, and why it needs a real flag

The brief for this project asked for a self-referential layer — a way for
the page's own PostHog implementation to show up *in* the page, not just
run quietly behind it. The panel added to slide 6 (a live list of every
event this session has actually sent, plus the session's anonymous
`distinct_id`) is that layer. It reads entirely off data `analytics.js`
already produces — no new collection, just visibility.

Gating it behind `prehog-recursive-panel` rather than shipping it
unconditionally does two things at once: it's a genuine, inspectable use of
Feature Flags (see the table above), and it means the panel's visibility
can be dialed in production — turned on for review, or for specific
visitors — without a redeploy. The flag isn't decorative; it's the actual
mechanism controlling whether this feature is live. It has to be created
manually in the PostHog dashboard (this repo's setup didn't include
feature-flag write access) — see `AGENTS.md` for the exact key.

## Linking benlive.tv's shared CSS, reversing the earlier "standalone" rule

`prehog.css` originally declared itself deliberately self-contained — no
host-site `/css/core/*` partials — reasoning that the
repo needed to render correctly when cloned and opened outside
`benlive.tv`. In practice that was never fully true: the shared nav meant
the page already depended on the host's *behavior* (via
`/js/nav-toggle.js`) without depending on its *look*, which produced the
generic, off-brand visual result flagged in review — the actual site never
uses its own token system before v2.

The fix extends the same acknowledged coupling one layer further: link
`/css/core/_variables.css`, `_gradients.css`, `_animations.css`,
`_utilities.css`, and `/css/components/_navigation.css` directly from the
document head, in cascade order. This avoids an `@import` waterfall while
preserving the same host dependency. The presentation does not render the
site footer; its controller is deliberately the persistent bottom edge.
Standalone-clone legibility is preserved differently now: the code and
comments explain what's happening and why, even where the visual result
depends on the host's stylesheets being present.

## Reverse proxy for PostHog ingestion

Reverses the earlier "not implemented" call. The original reasoning (a
self-hosted Firebase Function reverse-proxy would add operational surface —
a new endpoint, a new failure mode, cold starts — with no corresponding
benefit at this scale) still holds *for a self-hosted proxy*. What changed:
PostHog provisioned a managed reverse proxy at `t.benlive.tv` directly, which
removes the exact cost the original decision was weighing — no new endpoint
to operate, no new failure mode to own, nothing self-hosted. `analytics.js`'s
`api_host` now points at `t.benlive.tv` instead of `us.i.posthog.com`,
avoiding ad-blocker interference with PostHog's own domains — the specific
"measured problem" the original entry named as the only thing that would
justify revisiting it. `ui_host` stays pinned to `https://us.posthog.com`
since the proxy only forwards ingestion traffic, not the toolbar/survey
authentication flow. See `docs/architecture.md` for the resulting CSP delta.

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
