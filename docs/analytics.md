# Analytics specification

Analytics begins with questions, not events. This document states the
question first for every event; if a question can't be stated plainly, the
event doesn't ship.

## Standard capture

`$pageview` — PostHog's default autocapture, fired once on load
(`capture_pageview: true`; the page never changes URL path, so
`'history_change'` mode would never fire and is intentionally not used).
This alone answers "did anyone open the page" and "what referred them" —
no custom `prehog_viewed` event is defined, to avoid duplicating it.

## Custom events

### `prehog_slide_viewed`

| | |
|---|---|
| **Trigger** | A slide becomes the active slide (paged mode) |
| **Properties** | `slide_id` (string), `slide_index` (0–8), `entry_method` (`load` \| `key` \| `click` \| `swipe` \| `hash` \| `nav`) |
| **Question answered** | Do people meaningfully progress through the deck? Which sections hold attention vs. get skipped? |
| **Autocapture overlap** | None — autocapture sees DOM clicks, not which slide is logically active in a single-page deck |
| **Privacy** | No PII. `slide_id` is one of nine fixed enum values |
| **Dedup rule** | Fires **at most once per slide per session**, enforced in `analytics.js` via an in-memory `Set` — revisiting a slide does not re-fire it |
| **Test** | `tests/prehog.spec.js`: navigate forward then back to slide 1, assert the stub's capture log contains exactly one `prehog_slide_viewed` for `intro` |

### `prehog_navigation_used`

| | |
|---|---|
| **Trigger** | Any successful navigation input (button, arrow key, dot, swipe, hash) |
| **Properties** | `method`, `direction` (`next` \| `prev`), `from`, `to` |
| **Question answered** | Are the navigation controls discoverable? Does the interaction model actually work on mobile (swipe vs. tap ratio)? |
| **Autocapture overlap** | Partial — autocapture would see the click but not the resulting slide transition or the swipe gesture |
| **Privacy** | None |
| **Test** | Simulate a swipe via synthetic touch events; assert `method: 'swipe'` appears |

### `prehog_measurement_panel_opened`

| | |
|---|---|
| **Trigger** | The "What does this page measure?" transparency panel is opened |
| **Properties** | `slide_id` (which slide it was opened from) |
| **Question answered** | Do reviewers care about the analytics reasoning itself, not just the content? |
| **Autocapture overlap** | Autocapture would see the button click; this event captures the *outcome* (panel actually opened) and the originating slide |
| **Privacy** | None |
| **Test** | Click the trigger on slide 6, assert the event and its `slide_id` |

### `prehog_outbound_clicked`

| | |
|---|---|
| **Trigger** | Any click on a link carrying `data-outbound` (evidence repo links, GitHub CTA, `/about` CTA, AGENTS.md link, inspect-grid links) |
| **Properties** | `destination` (URL), `label` (the `data-outbound` value), `slide_id` |
| **Question answered** | Do reviewers inspect the repository? Do they continue to `/about`? Which evidence links matter most? |
| **Autocapture overlap** | Significant — PostHog autocapture would record these clicks by default. This event is kept anyway because `label` and `slide_id` give cleaner attribution than parsing autocaptured DOM selectors, and because it's the primary signal this project exists to produce |
| **Privacy** | `destination` is always a known, hardcoded URL — never user input |
| **Test** | Click each `[data-outbound]` element in slides 5, 7, and 9; assert one event per click with the correct `label` |

### `prehog_completed`

| | |
|---|---|
| **Trigger** | The final slide (`inspect`) becomes active |
| **Properties** | `slides_seen` (count of unique slides visited), `duration_ms` (time since page load) |
| **Question answered** | Do people meaningfully finish the deck, and how long does a full read take? |
| **Autocapture overlap** | None |
| **Privacy** | No content, only counts and durations |
| **Test** | Navigate to the final slide via `Home` then repeated `ArrowRight`; assert exactly one `prehog_completed` with `slides_seen: 9` |

### `prehog_autoplay_toggled`

| | |
|---|---|
| **Trigger** | The deck's automatic slide advance is paused or resumed — by the user clicking the top-right control, or automatically disabled once at load under `prefers-reduced-motion` |
| **Properties** | `method` (`manual` \| `auto`), `state` (`playing` \| `paused`) |
| **Question answered** | Does anyone let the deck run itself, or does everyone immediately take control? |
| **Autocapture overlap** | None — autocapture sees the button click but not the resulting playback state |
| **Privacy** | None |
| **Test** | Click the playback button, assert the event and that the state alternates correctly on repeated clicks |

### `prehog_easter_egg_found`

| | |
|---|---|
| **Trigger** | The hidden key-sequence easter egg is triggered for the first time this session |
| **Properties** | `slide_id` (where it was found) |
| **Question answered** | Does anyone read closely enough — the deck, the repo, or both — to find something not advertised on the page? A soft signal of engagement depth, nothing more |
| **Autocapture overlap** | None |
| **Privacy** | None |
| **Test** | Trigger the sequence twice; assert exactly one capture despite the visual replaying both times |

## Session Replay

Scoped to `/prehog` only, `maskAllInputs: true`,
`maskTextSelector: '[data-ph-mask]'`. Enabled to answer one specific,
written-down question: **is the slide navigation model discoverable on a
phone, or do mobile visitors get stuck?** If replay review answers that
question conclusively, replay should be turned off rather than left running
by default — see `docs/decisions.md`. The masking config is no longer
theoretical: the survey's free-text `<textarea>` carries `data-ph-mask`
directly, so an open-ended answer is never visible in a recording even
though the response text is captured as normal event data.

## Survey

A real PostHog Survey (type `"api"`, created via PostHog's Surveys API —
not their default popover), rendered with this page's own CSS instead of
PostHog's UI. Two questions: a 1–5 rating and one open-text follow-up.
Shown at most once per visitor, only after `prehog_completed` fires —
that gate is decided client-side in `analytics.js`
(`posthog.getActiveMatchingSurveys`), not via PostHog display conditions,
so the timing logic is fully covered by `tests/prehog.spec.js` instead of
depending on an unverified conditions-JSON shape. Standard PostHog survey
lifecycle events, captured with the documented manual-response pattern so
responses appear in PostHog's own Surveys reporting UI:

| Event | Trigger | Key properties |
|---|---|---|
| `survey shown` | Rendered after `prehog_completed` | `$survey_id`, `$survey_questions` |
| `survey sent` | Both questions answered and submitted | `$survey_id`, `$survey_questions`, `$survey_response_0` (rating), `$survey_response_1` (open text) |
| `survey dismissed` | Closed without submitting | `$survey_id`, `$survey_questions` |

PostHog's own per-person targeting flag (auto-created alongside the survey)
prevents it from being shown again to someone who already dismissed or
responded — enforced server-side, not by this repo's code.

## The recursive live-event-log panel

Gated behind the `prehog-recursive-panel` feature flag (see
`docs/decisions.md` for why this is a real flag, not decoration). When
enabled for a visitor, the transparency panel (slide 6) gains a live list of
every `prehog_*` and `survey *` event this session has actually sent to
PostHog, with a relative timestamp, plus a chip showing that session's
anonymous `distinct_id`. It reads directly off the same in-memory log
`analytics.js`'s `capture()` wrapper already keeps — no new event, no new
data collection, just a render layer making the existing capture stream
visible to the person it's about. This is the demonstration, not a
description, of slide 6's claim that analytics begins with questions: the
question "what is this page sending about me, right now" gets an answer
you can watch update live.

## Exception capture

`capture_exceptions: true`, scoped to unhandled exceptions and unhandled
promise rejections only — `console.error` capture is left off, since this
page has no `console.error` call sites worth turning into tracked events.
Answers one question: did anyone hit a JavaScript error in production that
Playwright's local test run didn't catch? See `docs/decisions.md` for why
this was added after initially being declined for MVP.

## What is deliberately not collected

Names, email addresses, precise/IP-derived geolocation beyond PostHog's
default country-level `$geoip_country_name`, and no cross-site identity
linking (no `identify()` call anywhere in this repo — every visitor is
anonymous). The one piece of free text this page ever collects is the
survey's optional open-answer question, which exists specifically because
someone chose to type it into a labeled feedback box — not incidental
capture — and is masked in Session Replay even though it's present in the
event data.
