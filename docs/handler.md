# Handler

A handler is a function that gets executed when a request matches the route definition. It is responsible for processing the request and sending a response.

## Handler declaration

The handler should be declared as last argument of the [Route Definition](routes.md#route-defintion) method.

```js
galbe.get('foo', schema, [hook1, hook2], ctx => {})
```

Handler are called after the last hook call, or right after the request parsing if no hook is declared. To get a better understanding of the request lifecycle, you can refer to the [Lifecycle](lifecycle.md) section.

## Handler definition

```js
const handler = ctx => {
  const { name } = ctx.query
  return `Hello ${name}!`
}
```

The handler function takes a `context` object as single argument and might return a `response`.

**context**

The `context` object contains the request information as well as a `set` object that serves as a response modifier. You can find more detailed informations about the `context` object in the [Context](context.md) section.

**response**

To send a response, your handler can return an object. The response sent will depend on the type of the object returned. There are four types of responses that can be returned by a handler method. More about that in the next section.

## Response types

> [!NOTE]
> This section only cover response body payloads, to return specific response headers and/or status, you should define them with the `context.set` object before the return statement. More about it in the [Context](context.md) section.

### String

Case where `string` is returned by the handler.

- status: 200
- content-type: `text-plain`

**Example**

```js
galbe.get('/example', ctx => {
  return 'Hello Mom!'
})
```

### Object

Case where an `object` is returned by the handler.

- status: 200
- content-type: `application/json`

**Example**

```js
galbe.get('/example', ctx => {
  return 'Hello Mom!'
})
```

### Response instance

Case where a [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) instance is returned by the handler.

In that case, `context.set` properties are not taken into account to contruct the response.

**Example**

<!-- prettier-ignore -->
```js
galbe.get('/example', ctx => {
  return new Response(
    'Hello Mom',
    { status: 200, headers: { 'content-type': 'text/plain' } 
  })
})
```

### Generator

Case where a [Generator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator) instance is returned by the handler.

- status: 200
- content-type: `text/event-stream`

**Example**

```js
async function* generator(array) {
  for (const item of array) {
    await Bun.sleep(500)
    yield item
  }
}

galbe.get('/example', ctx => generator(['one', 'two', 'three']))
```
