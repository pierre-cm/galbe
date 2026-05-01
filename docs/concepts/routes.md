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

> [!TIP]
> To exclude a route or a whole route file from analysis, add a `@galbe-ignore` comment immediately before its definition (or before the file's default export). Use `@galbe-hide` instead to keep the route registered but hide it from generated artifacts (e.g. OpenAPI specs, generated clients).
