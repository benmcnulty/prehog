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

## Session Replay

Scoped to `/prehog` only, `maskAllInputs: true`,
`maskTextSelector: '[data-ph-mask]'`. Enabled to answer one specific,
written-down question: **is the slide navigation model discoverable on a
phone, or do mobile visitors get stuck?** If replay review answers that
question conclusively, replay should be turned off rather than left running
by default — see `docs/decisions.md`.

## Survey

One two-question survey, targeted at the `prehog_completed` event, shown at
most once per visitor. Optional, dismissible, no gate on content. Exact
question wording is set in the PostHog dashboard (not in this repo, per
PostHog's Surveys product model) so it can be iterated without a deploy.

## Exception capture

`capture_exceptions: true`, scoped to unhandled exceptions and unhandled
promise rejections only — `console.error` capture is left off, since this
page has no `console.error` call sites worth turning into tracked events.
Answers one question: did anyone hit a JavaScript error in production that
Playwright's local test run didn't catch? See `docs/decisions.md` for why
this was added after initially being declined for MVP.

## What is deliberately not collected

Names, email addresses, free-text input, precise/IP-derived geolocation
beyond PostHog's default country-level `$geoip_country_name`, and no
cross-site identity linking (no `identify()` call anywhere in this repo —
every visitor is anonymous).
