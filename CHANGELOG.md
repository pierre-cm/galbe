# Changelog

## Unreleased

### Breaking changes
- **Request schemas gained a `cookies` slot, and `ctx.cookies` is typed from it**: previously always `Record<string, string>`, it is now `Static<>` of the declared schema (undeclared cookies remain raw strings). `RequestSchema`, `Route`, `Endpoint` and the route builders gained a trailing `C extends STCookies` generic — `Route<…>` users passing `SP`/`SR` positionally must shift them by one.
- **A bare `$T.null()` response means "no body" at every status**, not only `204`/`304`/`1xx`. A genuine JSON `null` body stays expressible through the content-map form `{ 'application/json': $T.null() }`.
- **Directory groups are on by default**: a route file's directory relative to its glob's static base is now its path prefix (`src/api/users.route.ts` → `/api/...`). Files at the glob base are unaffected; files in subdirectories change URLs. Opt out with `routes: { pattern, dirPrefix: false }`, or per file with a `/** @prefix / */` header.
- **OpenAPI specs no longer bake `basePath` into `paths`**: it is surfaced through `servers` instead (`[{ url: basePath }]` when no explicit `config.openapi.servers` is set; explicit config wins).
- **`GalbeProxy` removed**: route files now receive a plain `Galbe` (or a prefix-bound group registrar) instead of the async proxy, and registrations are synchronous. Files that treated `galbe.get(...)` as a `Promise<Route>` now get the `Route` directly; plain `await`s on those calls keep working.

### Features
- **Typed cookies**: a `cookies` property on the request schema parses, coerces and validates each declared cookie like a query parameter, reports failures under a `cookies` key, and emits `in: cookie` parameters in the OpenAPI spec.
- **Response status ranges**: `'1XX'`…`'5XX'` are response-map keys alongside exact statuses and `default`. One resolution rule — exact status, then the range containing it, then `default` — governs response validation, the content type inferred for a string response, the emitted spec and the generated client.
- **New schema options**: `multipleOf` and `format` on numbers (the `int32`/`uint32`/`int64`/`uint64` formats also constrain the range at runtime), `additionalProperties` on objects with the `$T.record(value)` sugar for free-form maps, `readOnly`/`writeOnly` (documentation only), `encoding` on `$T.multipartForm`, `responseLinks` on responses, and `split` on arrays.
- **Object query parameters**: `$T.object` is a legal query schema, read from bracketed keys (`?filter[lat]=1&filter[lon]=2`, OpenAPI's `deepObject`) or from a JSON-encoded value. An array's `split` option sets the delimiter that splits a single value — `'|'` and `' '` being `pipeDelimited` and `spaceDelimited` — and `split: false` keeps a delimiter-bearing value as one item.
- **`@summary` and `@description` annotations** override the JSDoc head split. A bare `@summary` declares an explicitly empty one, which is the only way to express a description with no summary.
- **Route-file header annotations apply to the file's routes**: `@tags` and `@security` above a route file's default export now reach every route it declares, as a middleware file's header already did. Precedence runs from the nearest scope outwards — route, then its file's header, then the middleware files covering it.
- **Document-level OpenAPI config**: `openapi.tags`, `openapi.security`, `openapi.externalDocs` and `openapi.securitySchemes` in `GalbeConfig`.
- **`galbe generate code` reports what it cannot carry**: constructs the schema model cannot express (`not`, `allowEmptyValue`, unimplemented parameter styles, methods with no route builder, unrecognised response keys) are printed instead of dropped silently.
- `galbe.onRouteAdded(cb)`: public registration event, firing synchronously for every route added with its final path; returns an unsubscribe function.
- Middleware files: `GalbeConfig.middleware` glob (default `src/**/*.middleware.{js,ts}`), scoped to their directory subtree, with deterministic ordering. A file default-exports a `MiddlewareDef` (with an optional `export const scope` narrowing) or a registration function receiving a directory-scoped registrar, which may register several middlewares.
- Middleware schema fragments: `galbe.middleware(pattern?, def)`, `group.middleware`, `galbe.group(prefix, def, cb)` and middleware files accept a `MiddlewareDef` (`{ hooks, schema, security }`). The `schema` fragment (`headers`/`query`/`params`) is merged into every matched route at registration — route-declared keys win — so validation, the OpenAPI spec, `generate client` and `generate cli` all pick up a subtree-wide request contract. The `afterHandle` slot name is reserved but not run yet.
- **Middleware `beforeParse` slot**: a definition's `beforeParse` hooks run on every matched route after routing and before the body is read or the request validated, so an auth or rate-limit rejection answers **401 before 400** instead of after a full parse. The context carries `request`, `route`, `state`, `set`, `cookies` and `remoteAddress` — no `body`, `params` or parsed `query`, which do not exist yet. Hooks take no `next()`: they run in registration order and preempt the request by returning a `Response`, like a plugin's `onRoute`. Routes with no matching `beforeParse` skip the stage entirely.
- `middleware(def)` helper (identity at runtime, like `config()`): a definition's `schema` fragment types its own hooks, and `galbe.group(prefix, def, cb)` types every route registered through the group registrar with it — route-declared keys win, nested group definitions stack.
- `@prefix` route-file header annotation declaring an explicit path prefix.
- `galbe generate code` emits the directory-convention layout with relative paths, so generated trees round-trip through the analyzer; route identity in merges is prefix-aware.

### Fixes
- **OpenAPI round-trip**: a shared component schema is no longer corrupted by response metadata; `components.requestBodies` references survive instead of becoming garbage media types; every `components.responses` entry keeps its identity, its description and (new) its response headers; named example `$ref`s no longer dangle; exclusive bounds use the OpenAPI 3.0 boolean form; parameter descriptions are no longer duplicated onto their schema; request-body descriptions are carried rather than inferred from the body schema.
- The route listing printed by `galbe dev`/`galbe build` shows a route's description again: a single-paragraph JSDoc head (the common `/** Greeting endpoint */` case) was analyzed correctly but dropped from the log, which only printed heads carrying a blank line. Log and OpenAPI spec now share one summary/description rule.
- The Automatic Route Analyzer no longer scans `node_modules` and `.git`: an app-wide pattern such as `routes: '**/*.route.ts'` used to import route and middleware files shipped by dependencies, and a dependency directory that isn't a valid route segment aborted boot (`galbe dev` and `galbe build` alike). A pattern that names one of those directories explicitly still opts back in.
- `galbe dev --watch` no longer reloads on `.git` writes (a `git checkout` or `git commit` used to respawn the app), and `--watchignore` now *adds* to the built-in ignores (`node_modules`, `.git`, `.galbe`) instead of replacing them.
- `galbe build` no longer swallows boot errors: a single thrown error (invalid directory name, failed import) was reported as `TypeError: {} is not iterable` instead of itself.
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
