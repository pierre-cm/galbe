# Context

A `context` object is created when a new request is initiated and is carried throughout the entire request lifecycle. See the [Lifecycle](https://galbe.dev/documentation/lifecycle) section for more details.

Its purpose is to carry all relevant information about the request and to facilitate data sharing across the request lifecycle.

## Definition

A context object has the following properties:

### request

An instance of the [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) object created by the server.

### headers

A JavaScript object representing the headers of the current request.

- **key** (string): Header name (lower-cased).
- **value** (string | [schema-defined](schemas.md#headers)): Header value.

### params

A JavaScript object representing the route parameters of the current request.

- **key** (string): Parameter name.
- **value** (string | [schema-defined](schemas.md#params)): Parameter value.

```js
galbe.get('/default/:p1/foo/:p2', ctx => console.log(ctx.params))
// GET /default/four/foo/2
{ p1: "four", p2: "2" }
```

### query

A JavaScript object representing the query parameters of the current request.

- **key** (string): Query parameter name.
- **value** (string | string[] | [schema-defined](schemas.md#query)): Query parameter value. Repeated keys are exposed as an array.

```js
galbe.get('/test', ctx => console.log(ctx.query))
// GET /test?one=1&two=2
{ one: "1", two: "2" }
```

### cookies

A JavaScript object representing the cookies of the current request.

- **key** (string): Cookie name.
- **value** (string): Cookie value.

> [!NOTE]
> Cookies are parsed from the `Cookie` header.

```js
galbe.get('/cookies', ctx => console.log(ctx.cookies))
// Cookie: foo=bar; baz=qux
{ foo: "bar", baz: "qux" }
```

### body

The body payload of the incoming request. The body type is determined by the following rules:

If no [Schema](schemas.md) is defined, Galbe parses the body based on the `Content-Type` header:

- `text/*`: `string`
- `application/json`: `object`
- `application/x-www-form-urlencoded`: `{ [key: string]: any }`
- `multipart/form-data`: `{ [key: string]: { headers: { name: string; type?: string; filename?: string }; content: any } }`
- `application/octet-stream`: `Uint8Array`
- _other / no Content-Type_: `AsyncGenerator<Uint8Array>`

For `GET`, `OPTIONS`, and `HEAD` requests, `body` is always `null`.

If a [Schema](schemas.md) is defined, Galbe parses the body according to the [Schema.body](schemas.md#body) definition for the current route.

### contentType

The body content-type group inferred from the `Content-Type` request header. One of `'json'`, `'text'`, `'urlForm'`, `'multipart'`, `'byteArray'`, or `'default'`. It is `undefined` for `GET`, `OPTIONS`, and `HEAD` requests.

### remoteAddress

A [SocketAddress](https://bun.com/docs/api/http#bun-serve) instance representing the remote address of the client (or `null` if unavailable).

### route

The matched [Route](routes.md) for the current request. Available from `onRoute` onwards in the request lifecycle.

### state

The `state` property allows storing custom user-defined values throughout the request lifecycle. It is commonly used to share data between [hooks](hooks.md) and the [handler](handler.md).

- **key** (string): User-defined key.
- **value** (any): User-defined value.

```js
galbe.get(
  '/example',
  [
    ctx => {
      ctx.state['foo'] = 'bar'
    }
  ],
  ctx => {
    return ctx.state.foo
  }
)
```

```bash
$ curl http://localhost:3000/example
bar
```

### set

The `set` property contains modifiable attributes that drive the response.

- **set.status** (`number`): The response status code.
- **set.headers** (`Record<string, string | string[]>`): The response headers.
- **set.cookie** (`(name: string, value: string, options?: CookieOptions) => void`): Append a cookie to the response.

`CookieOptions` accepts: `path` (default `'/'`), `domain`, `maxAge`, `expires`, `secure`, `httpOnly`, and `sameSite` (`true | false | 'lax' | 'strict' | 'none'`).

```js
galbe.get('/example', ctx => {
  ctx.set.status = 418
  ctx.set.cookie('foo', 'bar', { path: '/', httpOnly: true })
  return "I don't do coffee"
})
```
