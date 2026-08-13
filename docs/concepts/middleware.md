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

## Route Groups

To register many routes under a shared prefix — optionally with hooks covering the whole subtree — see [Route Groups](routes.md#route-groups).
