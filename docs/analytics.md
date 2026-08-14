# Analytics specification

Analytics begins with questions, not events. This document states the
question first for every event; if a question can't be stated plainly, the
event doesn't ship.

## Capture architecture: what owns what

This page's analytics run on `benlive.tv`'s shared layer, not a
`/prehog`-local implementation — this section states that plainly because
it wasn't always true, and older phrasing (in this repo's own git
history, and until this session, its docs) can still describe the
pre-migration shape. See `docs/architecture.md`'s "Where PostHog init
actually lives" and `docs/decisions.md`'s "Reversed: PostHog scoped to
`/prehog` only" for the fuller account. In short:

- **`benlive.tv`'s `public/js/analytics/index.js`** owns `posthog.init()`,
  reads consent (`BenLiveConsent`) before deciding whether a capture call
  actually reaches PostHog, and queues calls made before the SDK finishes
  its async load — drained once ready, with consent rechecked at drain
  time so a call queued before an opt-out is never delivered after one.
- **This repo's `analytics.js` never calls `posthog.init()`.** It's a
  thin domain adapter: it listens for `prehog:*` DOM events (dispatched
  by `prehog.js`, which itself knows nothing about PostHog — invariant 2
  in `AGENTS.md`) and maps them onto `prehog_*` events via
  `window.BenLiveAnalytics.capture()`. That function is the shared
  layer's trusted-adapter boundary (`rawCapture()` internally): it
  bypasses the shared layer's own `bl_*` taxonomy allowlist — that
  allowlist exists for pages using the shared layer's generic event
  bridge directly, and this repo already owns its own `prehog_*`
  contract and dedup rules — but still goes through the *same* consent
  gate, PostHog instance, and pending queue every other page's events do.
  It returns `'sent'`, `'queued'`, or `'rejected'`, which is what the
  recursive live-event-log panel (below) actually reflects.
- **`$pageview` fires conditionally on consent**, not unconditionally.
  `capture_pageview` is set to `true` only when consent is already
  granted at init time (`opt_out_capturing_by_default` covers the
  opposite case), so a visitor who has opted out never generates even the
  standard autocapture pageview. Answers "did anyone open the page" and
  "what referred them" with zero custom code when consent allows it — no
  custom `prehog_viewed` event is defined, to avoid duplicating it.
- **Two taxonomies, one consent gate.** This page's events are all
  `prehog_*`; the rest of the site's are `bl_*` (see the host repo's
  `public/js/analytics/events.js`). Different naming, different
  allowlist enforcement, same shared consent/init/delivery underneath —
  a visitor who opts out on `/prehog/` has opted out everywhere, not just
  here, because the consent key (`bl:analytics-consent`) is shared, not
  page-scoped.

## Custom events

### `prehog_slide_viewed`

| | |
|---|---|
| **Trigger** | A slide becomes the active slide (present/paged mode), or a section scrolls substantially into view in reference mode (a scrollspy `IntersectionObserver` with a centered ~20% band, so a section has to be meaningfully read, not just brush a viewport edge) |
| **Properties** | `slide_id` (string), `slide_index` (0–8), `entry_method` (`load` \| `key` \| `click` \| `swipe` \| `hash` \| `nav` \| `scroll`) |
| **Question answered** | Do people meaningfully progress through the deck? Which sections hold attention vs. get skipped? — answerable in both view modes, not just present mode |
| **Autocapture overlap** | None — autocapture sees DOM clicks, not which slide is logically active in a single-page deck |
| **Privacy** | No PII. `slide_id` is one of nine fixed enum values |
| **Dedup rule** | Fires **at most once per slide per session**, enforced in `analytics.js` via an in-memory `Set` — revisiting a slide does not re-fire it |
| **Test** | `tests/prehog.spec.js`: navigate forward then back to slide 1, assert the stub's capture log contains exactly one `prehog_slide_viewed` for `intro` |

### `prehog_navigation_used`

| | |
|---|---|
| **Trigger** | Any successful navigation input (button, arrow key, dot, swipe, hash, Contents panel) |
| **Properties** | `method` (`click` \| `key` \| `swipe` \| `hash` \| `toc`), `direction` (`next` \| `prev`), `from`, `to` |
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
| **Trigger** | The deck's automatic slide advance is paused or resumed — by the user clicking the top-right control, automatically disabled once at load under `prefers-reduced-motion`, or paused as a side effect of switching to reference view (auto-advance doesn't apply once every slide is already visible) |
| **Properties** | `method` (`manual` \| `auto` \| `mode`), `state` (`playing` \| `paused`) |
| **Question answered** | Does anyone let the deck run itself, or does everyone immediately take control? |
| **Autocapture overlap** | None — autocapture sees the button click but not the resulting playback state |
| **Privacy** | None |
| **Test** | Click the playback button, assert the event and that the state alternates correctly on repeated clicks |

### `prehog_view_mode_changed`

| | |
|---|---|
| **Trigger** | Toggling between present (paged, default) and reference (scrollable, all sections visible) view via the toolbar button |
| **Properties** | `mode` (`present` \| `reference`), `method` (currently always `toggle`, kept as a distinct prop rather than folded into `mode` in case a second trigger — e.g. a keyboard shortcut — is added later) |
| **Question answered** | Does anyone actually use reference mode, or is the guided narrative sufficient on its own? |
| **Autocapture overlap** | Partial — autocapture would see the button click but not which mode it resolved to |
| **Privacy** | None |
| **Test** | Toggle the view twice; assert one event per toggle with the correct `mode` |

### `prehog_easter_egg_found`

| | |
|---|---|
| **Trigger** | The hidden key-sequence easter egg is triggered for the first time this session |
| **Properties** | `slide_id` (where it was found) |
| **Question answered** | Does anyone read closely enough — the deck, the repo, or both — to find something not advertised on the page? A soft signal of engagement depth, nothing more |
| **Autocapture overlap** | None |
| **Privacy** | None |
| **Test** | Trigger the sequence twice; assert exactly one capture despite the visual replaying both times |

### `prehog_chat_opened`

| | |
|---|---|
| **Trigger** | The "Ask about PostHog fit" chat panel is opened, via the toolbar button |
| **Properties** | None |
| **Question answered** | Does anyone engage with the chat feature at all? |
| **Autocapture overlap** | Partial — autocapture would see the button click but not that it resulted in the chat panel specifically opening (vs. Contents or the transparency panel) |
| **Privacy** | None |
| **Test** | `tests/prehog-chat.spec.js`: open the panel via the toolbar button; assert one `prehog_chat_opened` |

### `prehog_chat_starter_selected`

| | |
|---|---|
| **Trigger** | One of the four preset starter questions is clicked |
| **Properties** | `starter` — a fixed short label (`culture` \| `throughline` \| `analytics` \| `why-now`) identifying *which* preset was used |
| **Question answered** | Which topics do visitors actually want to go deeper on? |
| **Autocapture overlap** | Partial — autocapture would see the click but not which fixed question it corresponds to |
| **Privacy** | The property is a closed four-value enum, never the question's own text and never anything the visitor typed |
| **Test** | Click each starter button; assert the matching `starter` value |

### `prehog_chat_conversation_initiated`

| | |
|---|---|
| **Trigger** | The first message is actually sent in the chat (starter chip or typed), once per session — mirrors `benlive.tv`'s own `bl_chat_engaged` aggregate semantics for `ai-lab/chat/` |
| **Properties** | None |
| **Question answered** | Of the people who open the chat, how many actually use it — opening is not the same as engaging |
| **Autocapture overlap** | None |
| **Privacy** | None — deliberately fires on send, not per-message, so message count/frequency is never derivable from this event |
| **Test** | Send two messages in one session; assert exactly one `prehog_chat_conversation_initiated` |

### `prehog_chat_reset`

| | |
|---|---|
| **Trigger** | The "Reset conversation" control is used |
| **Properties** | None |
| **Question answered** | Does the reset control get used — a soft signal the conversation went somewhere the visitor wanted to restart from |
| **Autocapture overlap** | Partial — autocapture would see the click but not that it cleared conversation state |
| **Privacy** | None |
| **Test** | Send a message, reset, assert one `prehog_chat_reset` and that the transcript is empty afterward |

**Chat message text and AI responses are never sent to PostHog, in any
event above or anywhere else.** This is a hard line inherited from
`benlive.tv/ai-lab/chat/`'s own privacy contract (see that repo's
`docs/decisions.md`), not something evaluated per-event here. `chat.js`
never places conversation content into any `capture()`-bound event
detail — see `tests/prehog-chat.spec.js`'s dedicated privacy test in the
host repo, which stubs PostHog, sends a distinctive sentinel string
through the chat, and asserts it never appears in any captured event.

## Session Replay

Configured via this page's `window.__BL_ANALYTICS_CONFIG__.sessionRecording`
override (`index.html`), read by the shared layer's `posthog.init()` call —
this page is the only one that currently sets it, which is what scopes it
to `/prehog` only, `maskAllInputs: true`,
`maskTextSelector: '[data-ph-mask]'`. Enabled to answer one specific,
written-down question: **is the slide navigation model discoverable on a
phone, or do mobile visitors get stuck?** If replay review answers that
question conclusively, replay should be turned off rather than left running
by default — see `docs/decisions.md`. The masking config is no longer
theoretical: the survey's free-text `<textarea>` carries `data-ph-mask`
directly, so an open-ended answer is never visible in a recording even
though the response text is captured as normal event data. The chat
panel's entire dialog (`[data-chat-panel] .panel-dialog`) carries the
same attribute — `maskAllInputs` only masks the `<input>` element itself
while text is being typed into it; it does not mask ordinary rendered DOM
text, which is exactly what the chat transcript is once a message
renders. Masking the whole dialog (not just the transcript container)
also covers the starter-question buttons and any error text, on the same
"privacy-sensitive rendered text" reasoning.

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
enabled for a visitor, the transparency panel (slide 6) gains a live list
of every `prehog_*` and `survey *` event this session has had **accepted
for delivery** to PostHog — logged the moment the shared layer's
`rawCapture()` returns `'sent'` *or* `'queued'`, not only once actually
delivered (a call that comes back `'rejected'`, meaning consent wasn't
granted, is never logged, since as far as this panel is concerned it
never happened). A queued call is drained and delivered once the SDK
finishes loading in the ordinary case; the one gap this label doesn't
cover is the rare race where consent changes to denied in the moment
between a call being queued and the queue draining, which discards it at
drain time (see `public/js/analytics/index.js`'s `drainPending()` in the
host repo) — "accepted for delivery" is the accurate claim, "delivered"
would not always be. The panel also shows a relative timestamp per event
plus a chip with that session's anonymous `distinct_id`. It reads
directly off the same in-memory log `analytics.js`'s `capture()` wrapper
already keeps — no new event, no new data collection, just a render layer
making the existing capture stream visible to the person it's about.
This is the demonstration, not a description, of slide 6's claim that
analytics begins with questions: the question "what is this page sending
about me, right now" gets an answer you can watch update live.

## Exception capture

`window.__BL_ANALYTICS_CONFIG__.captureExceptions = true` on this page
(read by the shared layer's init call the same way as Session Replay,
above) — the shared layer's own default is `false`, so this is an
explicit per-page opt-in, not something every instrumented page gets.
Scoped to unhandled exceptions and unhandled promise rejections only —
`console.error` capture is left off, since this page has no
`console.error` call sites worth turning into tracked events.
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
