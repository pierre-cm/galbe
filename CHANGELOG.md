# Changelog

## Unreleased

### Breaking changes
- **Directory groups are on by default**: a route file's directory relative to its glob's static base is now its path prefix (`src/api/users.route.ts` → `/api/...`). Files at the glob base are unaffected; files in subdirectories change URLs. Opt out with `routes: { pattern, dirPrefix: false }`, or per file with a `/** @prefix / */` header.
- **OpenAPI specs no longer bake `basePath` into `paths`**: it is surfaced through `servers` instead (`[{ url: basePath }]` when no explicit `config.openapi.servers` is set; explicit config wins).
- **`GalbeProxy` removed**: route files now receive a plain `Galbe` (or a prefix-bound group registrar) instead of the async proxy, and registrations are synchronous. Files that treated `galbe.get(...)` as a `Promise<Route>` now get the `Route` directly; plain `await`s on those calls keep working.

### Features
- `galbe.onRouteAdded(cb)`: public registration event, firing synchronously for every route added with its final path; returns an unsubscribe function.
- Middleware files: `GalbeConfig.middleware` glob (default `src/**/*.middleware.{js,ts}`); files default-export `Hook | Hook[]`, scoped to their directory subtree, with an optional `export const scope` narrowing and deterministic ordering.
- `@prefix` route-file header annotation declaring an explicit path prefix.
- `galbe generate code` emits the directory-convention layout with relative paths, so generated trees round-trip through the analyzer; route identity in merges is prefix-aware.

### Fixes
- Route-file metadata (tags, summaries, `@galbe-hide`, ...) is no longer silently dropped when `basePath` is set: meta keys are rewritten to final paths relative to `basePath` and all consumers look up accordingly.
- `galbe build` now also copies static assets registered in the main entry file (previously only route-file registrations were copied).

## 0.15.6 — 2026-08-09

### Fixes
- derive server types from Bun.serve

## 0.15.5 — 2026-08-09

### Fixes
- harden types, bound route cache, and validate byteArray length

## 0.15.4 — 2026-05-18

### Fixes
- update release process
