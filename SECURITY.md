# Security

This repository is a static presentation with no server-side code and no
secrets. Analytics traffic goes to a PostHog reverse proxy owned by the site
author; the chat panel calls the host site's rate-limited API and never
embeds provider credentials.

If you find a problem (an XSS vector in the rendering code, a privacy issue
in the analytics wiring, a dependency concern), please open a GitHub issue
or email the address on https://benlive.tv/hire-me/. Reports are read by the
sole maintainer, Ben McNulty.
