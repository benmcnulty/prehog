# Architecture

## Integration model

`prehog` is developed and versioned as its own repository
(`github.com/benmcnulty/prehog`) and mounted into the `benlive.tv` static
site as a **git submodule** at `public/prehog/`.

```
benlive.tv/ (root repo, no remote — functions, tests, docs, config)
 └─ public/ (gitlink → github.com/benmcnulty/benlive, Firebase hosting root)
     └─ prehog/ (submodule → github.com/benmcnulty/prehog)
```

Firebase Hosting serves `public/` as static files with **no build step** —
`hosting.ignore` already excludes dotfiles (`**/.*`), so the submodule's
`.git` directory is never deployed, and the checked-out submodule content
deploys exactly as committed. No `firebase.json` rewrite is required:
`hosting.cleanUrls` is unset (default `false`), so
`public/prehog/index.html` serves at the canonical `/prehog/` URL and a
bare `/prehog` request 301-redirects to it, matching every other page on
the site.

**Commit order for any change:** `prehog` submodule commit → `public`
(bumps the submodule ref) → root repo (if tests/config also changed).

## Why not write the page directly into the `public` repo?

Every other static sub-experience on `benlive.tv` (`/ai-lab/`, `/port/`,
`/hire-me/`) is written directly into the `public` repo. `prehog` breaks
that pattern on purpose: this specific artifact needs to be independently
cloneable and reviewable as a complete, self-contained unit — its
provenance *is* part of what it's demonstrating.

## Required Content-Security-Policy delta

`benlive.tv`'s `firebase.json` defines a strict CSP. `analytics.js` loads
PostHog's published `posthog-js` ES module build (`dist/module.js`, pinned
to a specific version) from `cdn.jsdelivr.net` via dynamic `import()`,
rather than PostHog's array.js/array.full.js "snippet" bootstrap — the
latter expects a specific pre-existing `window.posthog` queue-stub shape
that isn't documented anywhere reproducible; two earlier attempts at
hand-reconstructing it both failed (see git history on `analytics.js`).

That choice only covers the *initial* module load, though:

- `script-src` already allows `https://cdn.jsdelivr.net` for other site
  dependencies, so the initial module loads with no change there.
- `connect-src` already includes a bare `https:`, so PostHog's ingestion
  endpoint (`https://us.i.posthog.com`) needs no edit either.
- **But the loaded SDK still dynamically fetches its own feature bundles at
  runtime from `https://us-assets.i.posthog.com`** — `array/<token>/config.js`
  on init, plus `static/surveys.js` and `static/exception-autocapture.js`
  once those features are enabled — regardless of where the initial module
  came from. This was missed on a first pass (assumed jsDelivr covered
  everything) and only surfaced by watching real network requests against
  a live token; the corrected CSP restores this origin.

Two pieces are **required**:

```diff
  script-src 'self' 'unsafe-inline' 'unsafe-eval'
    https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com
-   https://code.jquery.com https://www.gstatic.com https://apis.google.com;
+   https://code.jquery.com https://www.gstatic.com https://apis.google.com
+   https://us-assets.i.posthog.com;
+ worker-src 'self' blob:;
```

`worker-src` doesn't exist in the current policy at all, which means it
falls back to `default-src 'self'`. PostHog's Session Replay compresses
recording data in a `blob:`-sourced web worker; without this directive,
replay fails silently in the browser console with no user-visible symptom
other than "no replays ever show up in PostHog." This is the single most
likely production-only failure for this project — the local emulator has
no CSP enforcement gap to reveal it.

**Why this is guarded by a test, not just this doc:** `firebase.json`
matches a pattern in the host repo's root `.gitignore`, but it was already
tracked before that pattern was added, so ignore rules don't apply to it —
edits to it are versioned normally, in the host repo's git history.
The test exists anyway as a second, independent guard: `tests/prehog.spec.js`
(in the host repo) asserts the *served* `Content-Security-Policy` response
header contains `worker-src 'self' blob:`. If someone regenerates
`firebase.json` from a template, or the deployed value drifts from what's
committed for any other reason, that test fails instead of Session Replay
silently going dark in production.

## Deployment

No build step, so there's no injection point between "committed" and
"served" — whatever's in this repo's `index.html` is what's live. That's
fine here: a PostHog **project API key** (the `posthogToken` value) is a
client-side, write-only identifier by design — the same value ships inside
every PostHog browser SDK on every site that uses one, and PostHog's own
docs embed it directly in the snippet. It is not a secret and doesn't need
server-side injection.

Until a real project exists, `window.__PREHOG_CONFIG__` is left unset in
`index.html` and `analytics.js` reads an empty `posthogToken`, which
resolves to a documented, harmless no-op (see `analytics.js` header
comment and `README.md`). Once a PostHog project is created, the token is
set directly in `index.html`'s `<head>` and committed like any other
content change — no separate secrets pipeline required.

Rollback is simple by construction: `/prehog` is purely additive. Removing
the submodule mount and redeploying `firebase deploy --only hosting`
reverts the site to its exact prior state.
