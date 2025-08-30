# Routes

Routes serve as the entry points for handling client requests in a Galbe application. This section covers route definition, available configuration options, and the Automatic Route Analyzer, which simplifies route setup.

## Defining Routes

Here's how to define routes in Galbe:

```ts
galbe.[method](path: string, schema?: Schema, hooks?: Hooks[], handler: Handler)
```

- **method** (`get` | `post` | `put` | `delete` | `patch` | `options` | `head`)
  - The [HTTP request method](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods) for the route.

- **path** (string)
  - The URL path of the route, composed of segments separated by `/`. Each segment may contain alphanumeric characters and dashes but should not start or end with a dash.
  - Special segments:
    - `:param` → A segment starting with `:` represents a parameter.
    - `*` → A wildcard segment matching any sequence of segments.

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

#### Route with Schemas and Hooks

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

Static routes serve files from the filesystem.

```ts
galbe.static(path: string, target: string, options?: StaticEndpointOptions)
```

- **path** (string): The URL path of the route.

- **target** (string): The path to the directory or file to serve.

- **options** (StaticEndpointOptions) _(Optional)_:
  - **resolve** ((path: string, target: string) => string | null | undefined | void) _(Optional)_
    A function that resolves the path to the file to serve. The function may return a string corresponding to the new target.

### Examples

<!-- prettier-ignore -->
```js
galbe.static('/static', './public')
```

## Automatic Route Analyzer

> [!NOTE]
> This feature is only available if you run or build the app using the [Galbe CLI](getting-started.md#galbe-cli). The CLI is used by default if you followed the [Automatic Installation](getting-started.md#automatic-installation) or configured `package.json` accordingly.

The Automatic Route Analyzer scans all Route Files in your project and sets up route definitions automatically. By default, it looks for files matching `src/**/*.route.{js,ts}`. This behavior can be customized via the `routes` property in your Galbe configuration. Setting it to `false` disables the analyzer.

### Route Files

To be analyzed correctly, a Route File must export a default function that accepts a Galbe instance as its only argument. Define your routes within this function. Example in JavaScript:

```ts
export default g => {
  g.get('/foo/:bar', ctx => ctx.params.bar)
}
```

The Automatic Route Analyzer can also extract metadata from multiline comments. Some plugins utilize this metadata for specific tasks. Example:

```js
/**
 * Header metadata description
 * @annotation Example of a header annotation
 */
export default g => {
  /**
   * Route-specific metadata
   * @deprecated
   * @operationId fooBar
   * @tags tag1 tag2
   */
  g.get('/foo/:bar', ctx => ctx.params.bar)
}
```

> [!TIP]
> To exclude a route from analysis, add `//@galbe-ignore` before its definition. This is useful for preventing certain routes from being included in automatic analysis or documentation generation.

