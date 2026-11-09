# Codex baseline review — November 2, 2026

Reviewed starting commit: `5624142`. No UI or Figma changes.

## Verified

- `npm ci --no-audit --no-fund` succeeded with the existing lockfile.
- `npm run build` passed (TypeScript and production Vite build).
- All five original tests passed: budget calculations, independent WebSocket clients, awareness, room isolation, persistence after restart, static hosting, and SPA fallback.
- Added a regression test for malformed HTTP/WebSocket URL encoding. Before the fix it reproduced an uncaught `URIError`; after the fix all six tests pass. HTTP returns 400; the malformed WebSocket connection closes with code 1008 before creating a room. Valid connections still synchronize afterward.
- Production-server smoke check against the actual `dist` output passed for `/health`, `/`, trip/plan/budget deep links, malformed URL rejection, and JavaScript/CSS assets with immutable cache headers.
- `npm run lint` exits successfully with 12 existing warnings; none added by the server fix. Most concern Fast Refresh exports; two flag state updates in effects.
- `git diff --check` passes.

Environment: Node 24.22.1, npm 11.9.0. The Dockerfile targets Node 22, so this is not a validation of the container runtime. Vite reports a roughly 577 kB main JavaScript chunk before gzip; consider route splitting later if load performance warrants it.

## Remaining verification

- Browser flows, real-device collaboration, map interaction, and mobile touch behavior remain unverified. Playwright is available but Chromium is absent; the browser download returned invalid archives.
- Docker is not installed, so the Dockerfile and hosting configurations remain untested.
- No deployment has been performed.

## Next work

1. Complete browser/device checks when a usable browser environment is available.
2. Confirm hosting target and validate the Node 22 container with durable storage before deployment.
3. Improve concurrent note editing and offline recovery after preserving seed/reset/delete semantics with targeted checks.

Source review clarified that phone-width trip boards intentionally stack widgets and disable drag/resize. Test that behavior as implemented; enabling mobile free-positioning would be a separate Figma-first design change.
