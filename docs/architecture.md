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

`benlive.tv`'s `firebase.json` defines a strict CSP. Two pieces are already
sufficient for PostHog and don't need to change:

- `connect-src` already includes a bare `https:`, so PostHog's ingestion
  endpoint (`https://us.i.posthog.com`) is allowed with no edit.
- `script-src` already includes `'unsafe-inline'`, so the inline bootstrap
  snippet in `analytics.js` is allowed to run.

Two pieces are **missing** and must be added:

```diff
  script-src 'self' 'unsafe-inline' 'unsafe-eval'
    https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com
    https://code.jquery.com https://www.gstatic.com https://apis.google.com
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

**Why this is guarded by a test, not just this doc:** `firebase.json` is
listed in the host repo's root `.gitignore`, so this exact header value is
versioned in no git repository. `tests/prehog.spec.js` (in the host repo)
asserts the *served* `Content-Security-Policy` response header contains
both additions. If someone regenerates `firebase.json` from a template and
drops the delta, that test fails instead of Session Replay silently going
dark in production.

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
