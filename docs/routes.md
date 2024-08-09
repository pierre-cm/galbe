# Routes

Routes are the entry points for handling client requests in a Galbe application. In this section, we'll cover how to define routes, the various options available for route definitions, and how to use the Automatic Route Analyzer to simplify route setup.

## Route definition

Here is how to define routes in Galbe.

```ts
galbe.[method](path: string, schema?: Schema, hooks?: Hooks[], handler: Handler)
```

**method** ( get | post | put | delete | patch | options | head )

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
> This feature is only available if you run/build the app via the [Galbe CLI](getting-started.md#galbe-cli), which is the case by default if you created your app following the [Automatic Installation](getting-started.md#automatic-installation) step or if you configured your package.json to do so.

The Automatic Route Analyzer is responsible for analyzing all the Route Files of your project and setting up the route definitions for your Galbe server automatically. By default, the analyzer will search for Route Files matching paths like `src/**/*.route.{js,ts}`. This can be configured by modifying the value of `routes` property of your Galbe configuration. A value of `false` will disable the route analyzer.

### Route Files

In order to be properly analyzed, Route Files must export a default function that takes a Galbe instance as unique argument. Your routes should be defined using that Galbe instance. Here's a basic example in JavaScript:

```ts
export default g => {
  g.get('/foo/:bar', ctx => ctx.params.bar)
}
```

The Automatic Route Analyzer can also collect metadata about your Route File and your routes by analyzing multiline comments. This can be used by some plugins to perform specific tasks. Here's an example of a Route File with multiline comment metadata:

```js
/**
 * This is the header's head comment
 * @annotation example of header's annotation
 */
export default g => {
  /**
   * This is a route head comment
   * @deprecated
   * @operationId fooBar
   * @tags tag1 tag2
   */
  g.get('/foo/:bar', ctx => ctx.params.bar)
}
```
