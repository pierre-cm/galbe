# Middleware

Middleware lets you run [Hooks](hooks.md) across many routes at once, instead of repeating them in every route definition. It is the tool for cross-cutting concerns like authentication, logging, or response timing.

## Declaring Middleware

```ts
galbe.middleware(hooks: Hook | Hook[])                   // every route
galbe.middleware(pattern: string, hooks: Hook | Hook[])  // routes matching the pattern
```

- **pattern** (string) _(Optional)_
  - A path pattern selecting the routes the hooks apply to. See [Patterns](#patterns) below. When omitted, the hooks apply to every route.

- **hooks** (Hook | Hook[])
  - One or more regular [Hooks](hooks.md): they receive the same `context` and `next` arguments, run in the same chain as route hooks, and short-circuit the same way by returning a response.

### Examples

#### Protecting a subtree

```ts
galbe.middleware('/api/*', ctx => {
  if (!isAuthenticated(ctx.headers.authorization)) throw new UnauthorizedError()
})

galbe.get('/api/users', ctx => listUsers())   // runs the auth hook first
galbe.get('/health', ctx => 'ok')             // does not
```

#### Timing every request

```ts
galbe.middleware(async (ctx, next) => {
  const start = performance.now()
  await next()
  console.log(`${ctx.route?.path} took ${(performance.now() - start).toFixed(1)}ms`)
})
```

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
> Like route hooks, middleware runs after the request has been parsed and validated: an invalid request is rejected before any middleware runs. Logic that must run before parsing belongs in a [Plugin](plugins.md).

Middleware can be declared at any time, including after the routes it targets: matching routes are recomposed on registration.

## Middleware Files

> [!NOTE]
> Like [Route Files](routes.md#route-files), this feature requires running or building the app with the [Galbe CLI](../reference/cli.md).

The [Automatic Route Analyzer](routes.md#automatic-route-analyzer) also discovers middleware files, matching the [`middleware`](../reference/configuration.md#middleware) configuration glob (default: `src/**/*.middleware.{js,ts}`). A middleware file default-exports a hook or an array of hooks — not a registration function:

```ts
// src/api/auth.middleware.ts
export default ctx => {
  if (!isAuthenticated(ctx.headers.authorization)) throw new UnauthorizedError()
}
```

**Placement decides scope**: the file's directory, relative to the glob's static base, becomes the pattern — `src/api/auth.middleware.ts` registers as `galbe.middleware('/api/*', ...)`; a file at the base applies globally. An optional named export narrows the pattern, relative to the file's directory scope:

```ts
// src/api/admin.middleware.ts — applies to /api/admin/*
export const scope = '/admin/*'
export default auditHook
```

**Ordering** is deterministic; since the chain runs in registration order, this is user-visible:

1. entry-file registrations (the app's own `galbe.middleware(...)` calls) — outermost;
2. middleware files, sorted by directory depth (shallowest first) then path — outer scopes wrap inner ones;
3. registrations inside route files, in file import order.

A `@galbe-ignore` comment above the default export skips the file. Header annotations (`/** @security bearerAuth */`, `@tags`) apply to every operation in the file's scope in the generated OpenAPI spec; route-level metadata wins on conflict.

### Scoping Summary

Code-level API:

| Definition | Example | Scope |
| --- | --- | --- |
| Global middleware | `galbe.middleware(log)` | every route |
| Prefix middleware | `galbe.middleware('/api/*', auth)` | routes matching the pattern, wherever registered |
| Route hooks | `galbe.get('/x', [h], handler)` | that route only |
| Group | `galbe.group('/v1', g => ...)` | prefixes the routes registered through `g` |
| Group hooks | `galbe.group('/v1', [auth], g => ...)` | the whole `/v1/*` subtree, incl. routes registered outside the group |
| Group-scoped middleware | `g.middleware(h)` / `g.middleware('/sub/*', h)` | group subtree / pattern relative to the group prefix |

Analyzer level:

| Definition | Example | Scope |
| --- | --- | --- |
| Directory group *(default on)* | `src/api/users.route.ts` | the file's routes get `/api`; nested dirs compose |
| `@prefix` annotation | `/** @prefix /v2 */` atop a route file | replaces the dir-derived prefix for that file |
| Middleware file | `src/api/auth.middleware.ts` exporting `Hook \| Hook[]` | `/api/*` — the file's directory subtree |
| Scope override export | `export const scope = '/admin/*'` in a middleware file | narrows within the directory scope |
| In-file registration | `g.middleware(...)` / `g.group(...)` inside a route file | relative to the file's prefix |

## Route Groups

To register many routes under a shared prefix — optionally with hooks covering the whole subtree — see [Route Groups](routes.md#route-groups).
