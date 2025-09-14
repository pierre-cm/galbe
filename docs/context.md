# Context

An instance of the context object is created when a new request is initiated and is carried throughout the entire request lifecycle. See the [Lifecycle](https://galbe.dev/documentation/lifecycle) section for more details.

Its purpose is to carry all relevant information about the request and facilitate data sharing between different stages of the request lifecycle.

## Definition

A context object has the following properties:

### request

An instance of the [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) object created by the server.

### headers

A JavaScript object representing the headers of the current request.

- **key** (string): Header name
- **value** (string | [schema defined](schemas.md#headers)): Header value

### params

A JavaScript object representing the route parameters of the current request.

- **key** (string): Parameter name
- **value** (string | [schema defined](schemas.md#params)): Parameter value

```js
galbe.get('/default/:p1/foo/:p2', ctx => console.log(ctx.params))
// GET /default/four/foo/2
{ p1: "four", p2: "2" }
```

### query

A JavaScript object representing the query parameters of the current request.

- **key** (string): Query parameter name
- **value** (string | [schema defined](schemas.md#query)): Query parameter value

```js
galbe.get('/test', ctx => console.log(ctx.query))
// GET /test?one=1&two=2
{ one: "1", two: "2" }
```

### body

The body payload of the incoming request. The body type is determined based on the following rules:

If no [Schema](schemas.md) is defined, Galbe will parse the body type according to the `content-type` header:

- `text/.*`: string
- `application/json`: object
- `application/x-www-form-urlencoded`: `{ [key: string]: any }`
- `multipart/form-data`: `{ [key: string]: { headers: { name: string; type?: string; filename?: string }; content: any } }`
- `other`: `AsyncGenerator<Uint8Array>`

If a [Schema](schemas.md) is defined, Galbe will parse the body according to the [Schema.body](schemas.md#body) definition for the current route.

### set

The `set` property contains modifiable attributes intended to provide information to the response parser.

- **status**: Sets the response status.
- **headers**: Sets the response headers.

```js
galbe.get('/example', ctx => {
  ctx.set.status = 418;
  return "I don't do coffee";
})
```

### state

The `state` property allows storing custom user-defined objects throughout the request lifecycle. It is commonly used to share data between [hooks](hooks.md) and the [handler](handler.md).

- **key** (string): User-defined key
- **value** (any): User-defined object

```js
galbe.get(
  '/example',
  [
    ctx => {
      ctx.state['foo'] = 'bar';
    }
  ],
  ctx => {
    return ctx.state.foo;
  }
)
```

```bash
$ curl http://localhost:3000/example
bar
```

### remoteAddress

An instance of [SocketAddress](https://github.com/oven-sh/bun/blob/fe62a614046948ebba260bed87db96287e67921f/packages/bun-types/bun.d.ts#L2600-L2613) representing the remote address of the client.
