# Error Handler

Any error occurring during a request lifecycle is intercepted by the error handler.

You can customize the default error-handling behavior by defining a custom error handler using Galbe's instance `onError` method.

```js
const galbe = new Galbe()
galbe.onError(customErrorHandler)
```

## Definition

The error handler should be a function that takes two arguments: an [Error](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error) and a [Context](context.md). This function may return a [Response type](handler.md#response-types).

```js
galbe.onError((error, ctx) => {
  if (error.status === 500) {
    return new Response(`Server error ❌`, { status: 500 })
  }
  if (error.status === 404) {
    return new Response(`Not found 🔎`, { status: 404 })
  }
})
```

The `error` argument can be any type of error thrown by your application. If the error originates from the Galbe framework, it will be an instance of [RequestError](#request-error).

For example, the [Router](router.md) will throw a `RequestError` with a `404` status if no route matches the incoming request path. Similarly, the parser will throw a `RequestError` with a `400` status in case of invalid input.

## Request Error

The `RequestError` class is used to instantiate a runtime request error in Galbe. It has three optional attributes: `status`, `payload`, and `headers`.

If your application throws a `RequestError` instance, Galbe will, by default, construct a Response from your `RequestError` and send it back to the client.

```js
import { RequestError } from 'galbe'

galbe.get('/coffee', () => {
  throw new RequestError({ status: 418, payload: '🫖' })
})
```

When called, the above endpoint should respond:

```bash
$ curl -i http://localhost:3000/coffee
HTTP/1.1 418 I'm a Teapot
Content-Type: application/json
Content-Length: 6

🫖
```