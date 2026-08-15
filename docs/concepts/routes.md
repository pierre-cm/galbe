# Routes

Routes are the entry points for handling client requests in a Galbe application. This section covers route definition, available configuration options, and the Automatic Route Analyzer that simplifies route setup.

## Defining Routes

Here's how to define routes in Galbe:

```ts
galbe.[method](path: string, schema?: Schema, hooks?: Hook[], handler: Handler)
```

- **method** (`get` | `post` | `put` | `delete` | `patch` | `options` | `head`)
  - The [HTTP request method](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods) for the route.

- **path** (string)
  - The URL path of the route, composed of segments separated by `/`. Segments may contain alphanumeric characters, dashes, and dots, and must not start or end with a dash.
  - A leading `/` is added automatically if missing.
  - Special segments:
    - `:param` → A segment starting with `:` represents a path parameter.
    - `*` → A wildcard segment that matches any single path segment. When used as the last segment of a path, it also matches the parent path (e.g. `/foo/*` matches both `/foo/bar` and `/foo`).

- **schema** (Schema) _(Optional)_
  - See the [Schemas](schemas.md) section.

- **hooks** (Hook[]) _(Optional)_
  - See the [Hooks](hooks.md) section.

- **handler** (Handler)
  - See the [Handler](handler.md) section.

### Examples

#### Basic Route

```js
galbe.get('/foo', ctx => 'Hello, World!')
```

#### Route with a Schema

<!-- prettier-ignore -->
```js
galbe.get(
  '/foo/:bar',
  { params: { bar: $T.string() } },
  ctx => `Hello, ${ctx.params.bar}!`
)
```

#### Route with Hooks

<!-- prettier-ignore -->
```js
galbe.get(
  '/foo/:bar',
  [() => console.log('Hook1'), () => console.log('Hook2')],
  ctx => `Hello, ${ctx.params.bar}!`
)
```

#### Route with Schema and Hooks

<!-- prettier-ignore -->
```js
galbe.get(
  '/foo/:bar',
  { params: { bar: $T.string() } },
  [() => console.log('Hook')],
  ctx => `Hello, ${ctx.params.bar}!`
)
```

## Route Groups

Route groups register a set of routes under a shared path prefix:

```ts
galbe.group(prefix: string, hooks?: Hook[], cb: (group) => void)
```

- **prefix** (string)
  - Prepended to every path registered on the group. Follows the same rules as route paths and may contain `:param` segments.

- **hooks** (Hook[]) _(Optional)_
  - [Middleware](middleware.md) covering the whole `<prefix>/*` subtree — including matching routes registered outside the group.

- **cb** (`(group) => void`)
  - Receives a group registrar exposing the route methods (`get`, `post`, ..., `static`), plus `middleware` (patterns relative to the group prefix) and `group` for nesting.

### Examples

<!-- prettier-ignore -->
```js
galbe.group('/v1', [authHook], g => {
  g.get('/users', ctx => listUsers())        // GET /v1/users, runs authHook first
  g.group('/admin', a => {
    a.get('/stats', ctx => stats())          // GET /v1/admin/stats
  })
})
```

Path parameters declared in the prefix are available in the route context:

<!-- prettier-ignore -->
```js
galbe.group('/team/:teamId', g => {
  g.get('/members/:id', ctx => getMember(ctx.params.teamId, ctx.params.id))
})
```

## Defining Static Routes

Static routes serve files from the filesystem. If the target is a directory, all files within it are served recursively.

```ts
galbe.static(path: string, target: string, options?: StaticEndpointOptions)
```

- **path** (string): The URL path under which the files are served.

- **target** (string): The path to the directory or file to serve.

- **options** (StaticEndpointOptions) _(Optional)_:
  - **resolve** (`(path: string, target: string) => string | null | undefined | void`) _(Optional)_
    A function that maps a request path to a file on disk. Return a string to override the resolved file, or a falsy value to skip serving that path.

### Examples

<!-- prettier-ignore -->
```js
galbe.static('/static', './public')
```

> [!NOTE]
> When a static route is built (`galbe build`), the targeted assets are copied next to the bundle so the executable remains self-contained.

## Automatic Route Analyzer

> [!NOTE]
> This feature is only available when you run or build the app using the [Galbe CLI](../reference/cli.md). The CLI is used by default if you followed the [Automatic Installation](../introduction/getting-started.md#automatic-installation-recommended) or configured your `package.json` accordingly.

The Automatic Route Analyzer scans all Route Files in your project and registers their routes automatically. By default, it looks for files matching `src/**/*.route.{js,ts}`. This behavior can be customized via the `routes` property in your Galbe configuration. Setting it to `false` disables the analyzer.

`node_modules` and `.git` are never scanned, so a broad pattern like `**/*.route.ts` only ever picks up your own files, not those shipped by your dependencies. A pattern that names one of these directories explicitly (e.g. `node_modules/my-routes/*.route.ts`) opts back in.

### Route Files

To be analyzed correctly, a Route File must export a default function that accepts a Galbe instance as its only argument. Define your routes within this function:

```ts
export default galbe => {
  galbe.get('/foo/:bar', ctx => ctx.params.bar)
}
```

The Automatic Route Analyzer can also extract metadata from JSDoc-style block comments. Some plugins consume this metadata for tasks such as documentation generation. Example:

```js
/**
 * Header metadata description
 * @annotation Example of a header annotation
 */
export default galbe => {
  /**
   * Route-specific metadata
   * @deprecated
   * @operationId fooBar
   * @tags tag1 tag2
   */
  galbe.get('/foo/:bar', ctx => ctx.params.bar)
}
```

The first paragraph of a comment is captured as the route's description (its first line is used as a summary). Lines starting with `@tag` are stored as tag metadata; tags repeated multiple times are exposed as arrays.

**File header annotations apply to every route in the file.** `@tags` and `@security` above the default export are inherited by each route the file declares, exactly as a [middleware file's header](middleware.md) is inherited by its scope:

```js
/**
 * @tags admin
 * @security apiKey
 */
export default galbe => {
  galbe.get('/stats', ctx => {}) // tags: ['admin'], security: [{ apiKey: [] }]

  /** @security none */
  galbe.get('/health', ctx => {}) // tags: ['admin'], security: []
}
```

Precedence runs from the nearest scope outwards — the route, then its file's header, then the middleware files covering it. `@security` takes the first one that names anything (`none` being the explicit "no security" escape); `@tags` accumulate across all three.

The head convention expresses "summary, then description" and nothing else. Two annotations override it, each on its own half:

```js
/**
 * @summary
 * @description An operation with a description but no summary.
 */
galbe.get('/foo', ctx => {})
```

- `@summary <text>` replaces the summary the head would have produced. Written bare, with no text, it declares an explicitly empty summary — the one way to write a description with no summary.
- `@description <text>` replaces the description. Repeat the annotation for a multi-line one.

Both fall back to the head split when absent, so existing comments are unaffected.

> [!TIP]
> To exclude a route or a whole route file from analysis, add a `@galbe-ignore` comment immediately before its definition (or before the file's default export). Use `@galbe-hide` instead to keep the route registered but hide it from generated artifacts (e.g. OpenAPI specs, generated clients).

### Directory Groups

By default, a route file's directory becomes its path prefix. The prefix is the file's directory relative to the *static base* of its glob pattern — the part of the pattern before the first segment containing a glob character. With the default pattern `src/**/*.route.{js,ts}`, the base is `src/`:

```txt
src/
  health.route.ts          g.get('/health')     → GET /health
  api/
    users.route.ts         g.get('/users/:id')  → GET /api/users/:id
    admin/
      stats.route.ts       g.get('/stats')      → GET /api/admin/stats
```

Rules:

- **Filenames never contribute** to the path — this is grouping, not filesystem routing. There is no `index.*` special-casing.
- Directory names must be valid **literal** route segments; a directory name that is not (spaces, `:param`-like names, ...) fails at startup. Use [`@prefix`](#prefix-annotation) for prefixes containing parameters.
- When `routes` is a list of patterns, each pattern anchors its own base. A pattern naming an exact file has the file's own directory as base, so no prefix.
- Prefixed files receive a group registrar bound to their prefix: nested `g.group(...)` and `g.middleware(...)` calls inside the file are scope-relative.

To opt out, use the object form of the [`routes`](../reference/configuration.md#routes) configuration:

```ts
export default {
  routes: { pattern: 'src/**/*.route.ts', dirPrefix: false }
}
```

### @prefix Annotation

The `@prefix` header annotation declares a file's route prefix explicitly, replacing the directory-derived one entirely (it is absolute, not composed):

```ts
/**
 * @prefix /v2
 */
export default g => {
  g.get('/users', listUsers)  // GET /v2/users, wherever the file lives
}
```

- `@prefix /` opts a file out of `dirPrefix` — the escape hatch for e.g. a health-check file living in a nested directory.
- The prefix may contain `:param` segments and must be a valid route path (startup error otherwise).
- It also works with `dirPrefix: false`: the annotation is the primitive, the directory convention is sugar for it.

### Registration Events

The analyzer observes registrations through `galbe.onRouteAdded(cb)`, a public API you can use too: the callback fires synchronously for every route added to the router, with the final (prefixed) path, and returns an unsubscribe function.

```ts
const unsub = galbe.onRouteAdded(({ route }) => console.log(route.method, route.path))
```
