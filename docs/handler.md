# Handler

A handler is a function that gets executed when a request matches the route definition. It is responsible for processing the request and sending a response.

## Handler Declaration

The handler should be declared as the last argument of the [Route Definition](routes.md#route-definition) method.

```js
galbe.get('foo', schema, [hook1, hook2], ctx => {})
```

Handlers are called after the last hook call, or right after the request parsing if no hook is declared. To get a better understanding of the request lifecycle, you can refer to the [Lifecycle](https://galbe.dev/documentation/lifecycle) section.

## Handler Definition

```js
const handler = ctx => {
  const { name } = ctx.query
  return `Hello ${name}!`
}
```

The handler function takes a `context` object as its single argument and might return a `response`.

### Context

The `context` object contains the request information as well as a `set` object that serves as a response modifier. You can find more detailed information about the `context` object in the [Context](context.md) section.

### Response

To send a response, your handler can return an object. The response sent will depend on the type of the object returned. There are four types of responses that can be returned by a handler method. More about that in the next section.

## Response Types

> [!NOTE]
> This section only covers response body payloads. To return specific response headers and/or status, you should define them with the `context.set` object before the return statement. More about it in the [Context](context.md) section.

### String

Case where a `string` is returned by the handler.

- status: 200
- content-type: `text/plain`

#### Example

```js
galbe.get('/example', ctx => {
  return 'Hello Mom!'
})
```

### Object

Case where an `object` is returned by the handler.

- status: 200
- content-type: `application/json`

#### Example

```js
galbe.get('/example', ctx => {
  return { message: 'Hello Mom!' }
})
```

### Response Instance

Case where a [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) instance is returned by the handler.

In this case, `context.set` properties are not taken into account to construct the response.

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

### Generator

Case where a [Generator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator) instance is returned by the handler.

- status: 200
- content-type: `text/event-stream`

#### Example

```js
async function* generator(array) {
  for (const item of array) {
    await Bun.sleep(500)
    yield item
  }
}

galbe.get('/example', ctx => generator(['one', 'two', 'three']))
```

## Throwing Errors

Throwing a `RequestError` at any point in the handler execution will result in a response with the specified status and payload.

#### Example

```ts
g.get("/test", () => {
  throw new RequestError({ status: 418, payload: '🫖' })
})
```

Any other kind of error will result in a `500` response with the error message `"Internal Server Error"` by default. You can always customize it by defining a custom [Error Handler](error-handler.md).