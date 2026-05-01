# Error Handler

Any error occurring during a request lifecycle is intercepted by the error handler.

You can customize the default error-handling behavior by defining a custom error handler using the `onError` method of the Galbe instance.

```js
const galbe = new Galbe()
galbe.onError(customErrorHandler)
```

> [!NOTE]
> `onError` can be called more than once. Each registered handler is invoked, in registration order, for every error. The last truthy return value is used as the response.

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

For example, the [Router](router.md) throws a `RequestError` with a `404` status if no route matches the incoming request path, or `405` if the path matches but the method is not allowed. Similarly, the parser and validator throw a `RequestError` with a `400` status in case of invalid input.

## Request Error

The `RequestError` class represents a runtime request error in Galbe. It accepts three optional fields: `status` (defaults to `400`), `payload`, and `headers`.

If your application throws a `RequestError` instance, Galbe will, by default, construct a Response from your `RequestError` and send it back to the client.

```js
import { RequestError } from 'galbe'

galbe.get('/coffee', () => {
  throw new RequestError({ status: 418, payload: '🫖' })
})
```

When called, the above endpoint responds:

```bash
$ curl -i http://localhost:3000/coffee
HTTP/1.1 418 I'm a teapot
Content-Type: text/plain
Content-Length: 4

🫖
```

> [!NOTE]
> When the `payload` is a string, the response is sent with `Content-Type: text/plain`. Any other payload is JSON-stringified and sent with `Content-Type: application/json`. You can override this by passing `headers` to the `RequestError`.