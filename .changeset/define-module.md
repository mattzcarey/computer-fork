---
"@cloudflare/computer": minor
---

Add `defineModule` for host modules that isolated JavaScript imports by name. A module installed under a `ws:*` specifier in the JavaScript backend's `trustedModules` exposes each of its exports as a named import, runs `execute` on the host with the caller's single argument, accepts and returns `Uint8Array` as well as JSON values, and receives the calling execution's identifier alongside the existing abort signal and deadline. Call-style trusted modules keep working and now also receive the execution identifier.
