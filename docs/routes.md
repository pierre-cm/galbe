# Routes

## Route Definition

Here is how to define routes in Galbe.

```ts
galbe.[method](path: string, schema?: Schema, hooks?: Hooks[], handler: Handler)
```

**method** ( get | post | put | delete | patch | options )

The [HTTP Request Method](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods) for the defined route.

**path** (string)

The path of the route. It should be composed of a sequence of segments separated by `/`. Each segment can be composed alphanumeric characters and dashes, but should not start or end with a dash.

There are two special segments:

- `:param` Any segment starting with `:` indicates a parameter segment.
- `*` To indicate a wildcard segment. This will match any segment or sequence of segments.

**schema** (Schema) _Optional_

See [Schemas](schemas.md) section.

**hooks** (Hook[]) _Optional_

See [Hooks](hooks.md) section.

**handler** (Handler)

See [Handler](handler.md) section.

### Examples

**Basic route**

```js
galbe.get('/foo', ctx => 'Hello World!')
```

**Route with Schema**

<!-- prettier-ignore -->
```js
galbe.get(
  '/foo/:bar',
  { params: { bar: $T.string() } },
  ctx => `Hello ${ctx.params.bar} !`
)
```

**Route with Hooks**

<!-- prettier-ignore -->
```js
galbe.get(
  '/foo/:bar',
  [() => console.log('Hook1'), () => console.log('Hook2')],
  ctx => `Hello ${ctx.params.bar} !`
)
```

**Route with Schemas and Hooks**

<!-- prettier-ignore -->
```js
galbe.get(
  '/foo/:bar',
  { params: { bar: $T.string() } },
  [() => console.log('Hook')],
  ctx => `Hello ${ctx.params.bar} !`
)
```

## Automatic Route Analyzer

> [!NOTE]
> This feature is only available if you run/build the app via the [Galbe CLI](getting-started.md#galbe-cli), which is the case by default if you created your app following the [Automatic Installation](getting-started.md#automatic-installation) step or properly configured your package.json to do so.

The Automatic Route Analyzer is in charge of analyzing all the Route Files of your project and set up the routes defintions to your Glabe server automatically.

By default, the analyzer will search for Route Files matching paths like `'src/**/*.route.{js,ts}'`. This can be configured by modifying the value of `routes` property of your Galbe configuration. A value of `false` will disable the analyzer.

### Route Files

In order to be properly analyzed, Route Files must export a default function that takes a Galbe instance as unique argument. Your routes should be defined using that Galbe instance. Here a basic js example:

```ts
export default g => {
  g.get('/foo/:bar', ctx => ctx.params.bar)
}
```

The same example using Typescript:

```ts
import type { Galbe } from 'galbe'
export default (g: Galbe) => {
  g.get('/foo/:bar', ctx => ctx.params.bar)
}
```

The Automatic Route Analyzer is also capable of collecting metadata about your Routefile and your routes by analyzing multiline comments. This can be used by some plugins to perform specific tasks. Here is an example of Route File with multiline comments metadata.

```js
/**
 * This is the header's head comment
 * @annotation example of header's annotation
 */
export default g => {
  /**
   * This is a route head comment
   * @deprecated
   * @tag tag1
   * @tag tag2
   */
  g.get('/foo/:bar', ctx => ctx.params.bar)
}
```

You will find more information about comment's metadata and how to use them along with examples in the [Plugin](plugins.md) section.
