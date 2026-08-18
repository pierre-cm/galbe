# Middleware

Middleware lets you run [Hooks](hooks.md) across many routes at once, instead of repeating them in every route definition. It is the tool for cross-cutting concerns like authentication, logging, or response timing.

## Declaring Middleware

```ts
galbe.middleware(def: Hook | Hook[] | MiddlewareDef)                   // every route
galbe.middleware(pattern: string, def: Hook | Hook[] | MiddlewareDef)  // routes matching the pattern
```

- **pattern** (string) _(Optional)_
  - A path pattern selecting the routes the middleware applies to. See [Patterns](#patterns) below. When omitted, it applies to every route.

- **def** (Hook | Hook[] | MiddlewareDef)
  - One or more regular [Hooks](hooks.md): they receive the same `context` and `next` arguments, run in the same chain as route hooks, and short-circuit the same way by returning a response.
  - Or a **middleware definition**, which bundles the hooks with the request contract they impose — see [Request Contract](#request-contract):

    ```ts
    type MiddlewareDef = {
      beforeParse?: PreParseHook | PreParseHook[]
      hooks?: Hook | Hook[]
      schema?: { headers?: ...; query?: ...; params?: ... }
      security?: string | string[]
      securitySchemes?: Record<string, SecuritySchemeObject>
    }
    ```

    A bare hook (or hook array) is sugar for `{ hooks }`. `beforeParse` holds hooks that must run before the request body is read — see [Before Parsing](#before-parsing). `security` and `securitySchemes` document the auth the hooks enforce — see [Security](#security).

Wrap a definition in `middleware()` to have its `schema` type its own hooks. The helper is the identity at runtime — it exists so the object literal has something to be contextually typed against, exactly like [`config()`](../reference/configuration.md):

```ts
import { $T, middleware } from 'galbe'

const tenant = middleware({
  schema: { headers: { 'x-tenant-id': $T.string() } },
  hooks: ctx => {
    ctx.state.tenant = ctx.headers['x-tenant-id'] // string — inferred, no annotation
  },
})
```

### Examples

#### Protecting a subtree

```ts
galbe.middleware('/api/*', ctx => {
  if (!isAuthenticated(ctx.headers.authorization)) throw new UnauthorizedError()
})

galbe.get('/api/users', ctx => listUsers()) // runs the auth hook first
galbe.get('/health', ctx => 'ok') // does not
```

#### Timing every request

```ts
galbe.middleware(async (ctx, next) => {
  const start = performance.now()
  await next()
  console.log(`${ctx.route?.path} took ${(performance.now() - start).toFixed(1)}ms`)
})
```

## Request Contract

Hooks usually expect something from the request: an `Authorization` header, an API key, a tenant id. A middleware definition declares that contract once, as a `schema` fragment, and Galbe merges it into the [Schema](schemas.md) of every route it matches:

```ts
galbe.middleware(
  '/api/*',
  middleware({
    schema: { headers: { authorization: $T.string({ pattern: /^Bearer / }) } },
    security: 'bearerAuth',
    hooks: authHook,
  })
)

galbe.get('/api/users', ctx => listUsers()) // requires the authorization header
```

The fragment covers `headers`, `query` and `params` — the parts of a request a route-scoped middleware can reasonably constrain. Merged keys behave exactly as if the route had declared them: they are validated on every request, and they appear in the generated OpenAPI spec, client and CLI.

- **Merging is per key, and the route wins.** A route that declares the same key keeps its own definition, so it can always tighten or override a fragment.
- **Fragments are merged at registration**, whether the middleware is declared before or after the routes it matches, and re-merging is idempotent.

### Security

`security` names the OpenAPI security scheme(s) the hooks enforce, and `securitySchemes` defines them. Both are metadata: they never affect runtime behavior, they document what the hooks already do.

```ts
export const apiKey = middleware({
  schema: { headers: { 'x-api-key': $T.string() } },
  security: 'apiKeyAuth',
  securitySchemes: { apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
  hooks: checkKey,
})
```

Every operation the middleware matches gets `security: [{ apiKeyAuth: [] }]`, and `components.securitySchemes` gets the definition — the same output a [middleware file's `@security` header](#middleware-files) produces, so a packaged middleware documents itself the same whether it is registered in code or discovered as a file.

- **`security`** is a name, or a list of names for alternatives (`['bearerAuth', 'apiKeyAuth']`). Scopes follow the name, space-separated: `'oauth2 read write'` becomes `{ oauth2: ['read', 'write'] }`. `'none'` documents the scope as public (`security: []`), the same escape the annotation has.
- **`securitySchemes`** has the same shape as [`config.openapi.securitySchemes`](../reference/configuration.md#openapi), which wins on conflict. It is only needed for a scheme the app does not already declare — naming `bearerAuth` alone is enough to get `{ type: 'http', scheme: 'bearer' }`.
- **The scheme owns its credential.** A scheme that says where the credential travels (`http` ⇒ `Authorization`, `apiKey` ⇒ its `name`/`in`) replaces the fragment's own parameter for it, rather than documenting the same header twice. The header is still validated at runtime.

**Precedence** runs from the nearest scope outwards, first declaration winning outright — unlike `@tags`, which accumulate:

1. the route's own `@security`;
2. its [route file's header](routes.md#route-files);
3. the middleware covering it — nearest pattern first (`/api/admin/*` before `/api/*` before `*`), and at one scope a file's `@security` header ahead of the `security` of the def it annotates;
4. failing all of those, a route schema declaring an `authorization` header with a `/^Bearer /` pattern still infers `bearerAuth`. That inference is legacy support for hand-declared schemas, not the mechanism.

### Fragments and Types

A fragment types the code that can be linked to it statically:

| Where                                                    | Typed by the fragment               |
| -------------------------------------------------------- | ----------------------------------- |
| The definition's own `hooks`                             | ✅ — wrap the def in `middleware()` |
| Routes registered through `galbe.group(prefix, def, cb)` | ✅                                  |
| Routes matched by `galbe.middleware(pattern, def)`       | ❌                                  |
| Routes in other files matched by a middleware file       | ❌                                  |

```ts
galbe.group('/v1', tenant, g => {
  g.get('/users', ctx => {
    ctx.headers['x-tenant-id'] // string — from the group's fragment
  })

  g.get('/orders', { headers: { 'x-tenant-id': $T.integer() } }, ctx => {
    ctx.headers['x-tenant-id'] // number — the route's own declaration wins
  })
})
```

Nested groups stack: an inner def's fragment merges over the outer one, in types as at runtime.

The pattern form cannot be typed, and that is deliberate as much as it is technical. `'/api/*'` is a runtime string matched against route paths at registration — including routes registered later, in other files, discovered by a glob — so there is no static link from the pattern to any particular `galbe.get(...)` call. A fragment still merges into those routes and is validated on every request; it just does not reach `ctx`'s type. When a handler needs the value typed, declare the key on the route as well (the route wins, so nothing changes at runtime), read it from `ctx.state` if a hook puts it there, or scope the middleware with a group instead of a pattern.

## Patterns

Patterns are composed of `/`-separated segments. Each segment is either a literal or `*`:

- A literal matches an identical route segment.
- `*` matches any single route segment, including `:param` and `*` segments.
- A trailing `*` matches the whole subtree, including the prefix itself: `/api/*` matches `/api`, `/api/foo` and `/api/foo/bar`.
- `:param` segments are not allowed in patterns; use `*` instead.
- Like route paths, patterns are relative to the configured `basePath`.

> [!NOTE]
> Patterns are matched against **registered route paths**, not against request URLs. Matching is resolved when a route is registered — matched hooks are composed into the route's hook chain once — so middleware adds no per-request matching cost. Two consequences:
>
> - A literal segment only matches an identical route segment: `/user/me` does not attach to a route declared as `/user/:id`, even though a request to `/user/me` would reach it. Write patterns in terms of route shapes: `/user/*`.
> - Middleware only runs when a route matched. To act on unrouted requests (custom 404s, CORS preflights, ...), use a [Plugin](plugins.md) with `onFetch` or `onRoute`.

## Execution Order

Middleware hooks run ahead of route hooks, in registration order, within the same chain:

```
plugins → middleware (registration order) → route hooks → handler
```

They follow the same nesting rules as route hooks: code after `await next()` runs after the handler and the route hooks have completed.

<!-- prettier-ignore -->
```ts
galbe.middleware('/example', async (ctx, next) => {
  console.log('middleware start')
  await next()
  console.log('middleware end')
})

galbe.get('/example', [async (ctx, next) => {
  console.log('hook start')
  await next()
  console.log('hook end')
}], ctx => {
  console.log('handler')
})
```

```bash
$ curl http://localhost:3000/example
middleware start
hook start
handler
hook end
middleware end
```

> [!NOTE]
> Like route hooks, middleware hooks run after the request has been parsed and validated: an invalid request is rejected with a 400 before any of them runs. To act earlier, use the [`beforeParse`](#before-parsing) slot.

Middleware can be declared at any time, including after the routes it targets: matching routes are recomposed on registration.

## Before Parsing

A definition's `beforeParse` hooks run earlier than everything above: right after routing, and before the body is read or the request validated.

```ts
galbe.middleware(
  '/api/*',
  middleware({
    beforeParse: ctx => {
      if (!isAuthenticated(ctx.request.headers.get('authorization'))) throw new UnauthorizedError()
    },
  })
)
```

The full order:

```
plugins.onFetch → routing → plugins.onRoute → beforeParse → parsing & validation → plugins.beforeHandle → middleware hooks → route hooks → handler
```

That position is the whole point of the slot. An authentication or rate-limiting check written as a regular hook lets an unauthenticated request be read and validated first, so a malformed unauthenticated request is answered with a **400 before the 401** — leaking the shape of your schema to a caller that should have been turned away outright. In `beforeParse`, the rejection comes first and the body is never read.

The context is restricted to what actually exists at that point: `request`, `route`, `state`, `set`, `cookies` and `remoteAddress`. There is no `body`, no `params` and no parsed `query`; raw headers and search params remain reachable through `ctx.request`. Hooks take no `next()` — they run sequentially in registration order and preempt the request by returning a `Response`, like a [Plugin](plugins.md)'s `onRoute`. Throwing works as well: errors take the usual [Error Handler](error-handler.md) path. Anything a hook leaves on `ctx.state` is visible to the rest of the chain.

> [!NOTE]
> `beforeParse` is still middleware: it runs only for requests that matched a route, and only for routes matching its pattern. Work that must also cover unrouted requests belongs in a [Plugin](plugins.md)'s `onFetch`.

## Middleware Files

> [!NOTE]
> Like [Route Files](routes.md#route-files), this feature requires running or building the app with the [Galbe CLI](../reference/cli.md).

The [Automatic Route Analyzer](routes.md#automatic-route-analyzer) also discovers middleware files, matching the [`middleware`](../reference/configuration.md#middleware) configuration glob (default: `src/**/*.middleware.{js,ts}`). A middleware file default-exports a **middleware definition**:

```ts
// src/api/tenant.middleware.ts
import { $T, middleware } from 'galbe'

export default middleware({
  schema: { headers: { 'x-tenant-id': $T.string() } },
  hooks: ctx => {
    ctx.state.tenant = ctx.headers['x-tenant-id'] // string
  },
})
```

A packaged middleware is a definition, so installing one is the export itself — no wrapper:

```ts
// src/api/auth.middleware.ts
export default jwt({ publicKey })
```

Alternatively, a file may default-export a **registration function**, which receives a registrar scoped to the file's directory. Use it when one file registers several middlewares, or registers conditionally:

```ts
// src/api/admin.middleware.ts
import { type Galbe } from 'galbe'

export default (g: Galbe) => {
  g.middleware(auditDef) // /api/admin/*
  g.middleware('/billing/*', billingDef) // /api/admin/billing/*
  if (Bun.env.BUN_ENV === 'development') g.middleware(debugDef)
}
```

> [!NOTE]
> A bare hook or array of hooks is **not** a valid default export — a function is read as a registration function. Wrap hooks in a definition (`middleware({ hooks })`); you get the fragment typing with it.

**Placement decides scope**: the file's directory, relative to the glob's static base, becomes the pattern — `src/api/auth.middleware.ts` registers as `galbe.middleware('/api/*', ...)`; a file at the base applies globally. For a definition export, an optional named export narrows the pattern, relative to the file's directory scope (a registration function narrows with its pattern argument instead):

```ts
// src/api/admin.middleware.ts — applies to /api/admin/*
export const scope = '/admin/*'
export default middleware({ hooks: auditHook })
```

**Ordering** is deterministic; since the chain runs in registration order, this is user-visible:

1. entry-file registrations (the app's own `galbe.middleware(...)` calls) — outermost;
2. middleware files, sorted by directory depth (shallowest first) then path — outer scopes wrap inner ones;
3. registrations inside route files, in file import order.

A `@galbe-ignore` comment above the default export skips the file. Header annotations (`/** @security bearerAuth */`, `@tags`) apply to every operation in the file's scope in the generated OpenAPI spec, and a `@security` header overrides the `security` of the def it annotates — the app's own word on a middleware it may not own. See [Security](#security) for the whole precedence chain.

### Scoping Summary

Code-level API:

| Definition              | Example                                                     | Scope                                                                  |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Global middleware       | `galbe.middleware(log)`                                     | every route                                                            |
| Prefix middleware       | `galbe.middleware('/api/*', auth)`                          | routes matching the pattern, wherever registered                       |
| Middleware definition   | `galbe.middleware('/api/*', middleware({ hooks, schema }))` | as above, and the schema fragment is merged into every matched route   |
| Route hooks             | `galbe.get('/x', [h], handler)`                             | that route only                                                        |
| Group                   | `galbe.group('/v1', g => ...)`                              | prefixes the routes registered through `g`                             |
| Group hooks             | `galbe.group('/v1', [auth], g => ...)`                      | the whole `/v1/*` subtree, incl. routes registered outside the group   |
| Group definition        | `galbe.group('/v1', def, g => ...)`                         | as above, and the fragment **types** the routes registered through `g` |
| Group-scoped middleware | `g.middleware(h)` / `g.middleware('/sub/*', h)`             | group subtree / pattern relative to the group prefix                   |

Analyzer level:

| Definition                     | Example                                                       | Scope                                                          |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------- |
| Directory group _(default on)_ | `src/api/users.route.ts`                                      | the file's routes get `/api`; nested dirs compose              |
| `@prefix` annotation           | `/** @prefix /v2 */` atop a route file                        | replaces the dir-derived prefix for that file                  |
| Middleware file                | `src/api/auth.middleware.ts` exporting a `MiddlewareDef`      | `/api/*` — the file's directory subtree                        |
| Middleware file (registrar)    | `src/api/auth.middleware.ts` exporting `(g: Galbe) => void`   | each `g.middleware(...)` call, relative to the directory scope |
| Scope override export          | `export const scope = '/admin/*'` next to a definition export | narrows within the directory scope                             |
| In-file registration           | `g.middleware(...)` / `g.group(...)` inside a route file      | relative to the file's prefix                                  |

## Route Groups

To register many routes under a shared prefix — optionally with hooks covering the whole subtree — see [Route Groups](routes.md#route-groups).
