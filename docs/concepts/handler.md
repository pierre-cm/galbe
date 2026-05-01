# Handler

A handler is a function that runs when a request matches a route definition. It is responsible for processing the request and producing a response.

## Handler Declaration

The handler must be the last argument of the [Route Definition](routes.md#defining-routes) method.

```js
galbe.get('/foo', schema, [hook1, hook2], ctx => {})
```

Handlers run after the last hook, or right after request parsing if no hook is declared. See the [Lifecycle](https://galbe.dev/documentation/lifecycle) section for more details on the request lifecycle.

## Handler Definition

```js
const handler = ctx => {
  const { name } = ctx.query
  return `Hello ${name}!`
}
```

A handler takes a `context` object as its single argument and may return a response value.

### Context

The `context` object carries the request information as well as a `set` object used to shape the response. See the [Context](context.md) section for full details.

### Response

To send a response, the handler returns a value. The actual HTTP response is derived from the type of that value. The next section enumerates each supported return type.

## Response Types

> [!NOTE]
> This section only covers response body payloads. To set the response status or headers, mutate `context.set` before returning. See the [Context](context.md) section for details.

### String

A `string` returned by the handler.

- status: `200` (or `ctx.set.status`)
- content-type: `text/plain` (or `application/json` if a JSON response schema is declared for the status)

#### Example

```js
galbe.get('/example', ctx => 'Hello Mom!')
```

### Object

Any plain object (including arrays) returned by the handler.

- status: `200` (or `ctx.set.status`)
- content-type: `application/json`

#### Example

```js
galbe.get('/example', ctx => {
  return { message: 'Hello Mom!' }
})
```

### Uint8Array

A `Uint8Array` returned by the handler is sent as a binary response.

- status: `200` (or `ctx.set.status`)
- content-type: `application/octet-stream` (unless overridden via `ctx.set.headers`)

#### Example

```js
galbe.get('/example', () => new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
```

### Response Instance

A [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) instance returned by the handler is sent verbatim. In this case, `ctx.set` is **not** applied — the `Response` is responsible for its own status and headers.

#### Example

<!-- prettier-ignore -->
```js
galbe.get('/example', ctx => {
  return new Response(
    'Hello Mom',
    { status: 200, headers: { 'content-type': 'text/plain' } }
  )
})
```

### Generator / ReadableStream

A [Generator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator), [AsyncGenerator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator), or [ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) returned by the handler is streamed to the client as [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) (SSE).

- status: `200` (or `ctx.set.status`)
- content-type: `text/event-stream`

Each yielded value becomes one SSE message (`id:<uuid>\ndata:<value>\n\n`). If the request includes a `Last-Event-ID` header, that ID is used for the first message.

#### Example

```js
async function* generator(array) {
  for (const item of array) {
    await Bun.sleep(500)
    yield item
  }
}

galbe.get('/example', () => generator(['one', 'two', 'three']))
```

## Throwing Errors

Throwing a `RequestError` at any point during request handling produces a response with the specified status and payload.

#### Example

```ts
import { RequestError } from 'galbe'

galbe.get('/test', () => {
  throw new RequestError({ status: 418, payload: '🫖' })
})
```

Any other thrown value results in a `500` response with the message `"Internal Server Error"` by default. You can customize this by registering a custom [Error Handler](error-handler.md).