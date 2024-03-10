# Error handler

Any error happening during a request lifecycle will be intercepted by the error handler.

You can customize the default error handling behavior by defining a custom error handler using Galbe's intance `onError` method.

```js
const galbe = new Galbe()
galbe.onError(customErrorHandler)
```

## Definition

The error handler should be a function that takes two aguments: an [Error](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error) and a [Context](context.md). This function may potentially return a [Response type](handler.md#response-types).

```js
galbe.onErrorHandler((error, ctx) => {
  if (error.status === 500) {
    return new Response(`Server error ❌`, { status: 500 })
  }
  if (error.status === 404) {
    return new Response(`Not found 🔎`, { status: 404 })
  }
})
```

The `error` argument could be any type of error thrown by your application. If the error originates from Galbe framework, it will be an instance of [RequestError](#request-error).

For instance, the [Router](router.md) will throw a `RequestError` with a `404` status if no route matches the incoming request path. Similarly, the Parser will throw a `RequestError` with a `400` status.

## Request Error

The `RequestError` class is utilized to instanciate a runtime request error in Galbe. It has two optional attributes: a `status` and a `payload`.

If your application throws a `RequestError` instance, Galbe will, by default, construct a Response from your `RequestError` and send it back to the client.

```js
import { Galbe, RequestError } from 'galbe'

const galbe = new Galbe()

galbe.get('/coffee', () => throw new RequestError({ status: 418, payload: '🫖' }))
```

When called, above endpoint should respond:

```bash
curl -i http://localhost:3000/coffee
HTTP/1.1 418 I'm a Teapot
Content-Type: application/json
Content-Length: 6

"🫖"
```
