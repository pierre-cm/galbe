# Context

An instance of the context object is created when a new request is initiated and carrieds out along durring all the request lifecycle.
See the [Lifecycle](https://galbe.dev/documentation/lifecycle) section to get more details.

Its purpose is to carrie all the relevent information about the request and to allow sharing informations between each step of the request lifecycle.

## Definition

A context has the following properties:

**request**

An instance of the [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) object created by th server.

**headers**

A javascript object representing the `headers` of the current request.

- key (string): header name
- value: (string | [schema defined](schemas.md#headers)): header value

```js
{
    "accept": "*/*",
    "accept-encoding": "gzip, deflate, br",
    "cookie": "Cookie_1=value; Cookie_2=value",
    "host": "localhost:3000",
    "user-agent": "galbe/1.0.0"
}
```

**params**

A javascript object representing the request `parameters` of the current request.

- key (string): parameter name
- value: (string | [schema defined](schemas.md#params)): parameter value

```js
galbe.get('/default/:p1/foo/:p2', ctx => console.log(ctx.params))
// GET /default/four/foo/2
{ p1: "four", p2: "2" }
```

**query**

A javascript object representing the request `query parameters` of the current request.

- key (string): query parameter name
- value: (string | [schema defined](schemas.md#query)): query parameter value

```js
galbe.get('/test', ctx => console.log(ctx.params))
// GET /test?one=1&two=2
{ one: "1", two: "2" }
```

**body**

The body payload of the incoming request. The body type is computed according to the following rules.

If no [Schema](schemas.md) is defined, Galbe will parse the body type according to `content-type` Header value:

- `text/.*`: string
- `application/json`: object
- `application/x-www-form-urlencoded`: { [key: string]: any }
- `multipart/form-data`: { [key: string]:
  { headers: { name: string; type?: string; filename?: string };
  content: any
  } }
- `other`: AsyncGenerator\<Uint8Array\>

If a [Schema](schemas.md) is defined, Galbe will parse the body type according to the [Schema.body](schemas.md#body) defined for the current route.

**set**

The set property contains modifiable properties which purpose are to give informations to the Response parser.

- `status`: Set the response status
- `headers`: Set the response headers

```js
galbe.get('/example', ctx => {
  ctx.set.status = 418
  return "I don't do coffee"
})
```

**state**

The state property purpose is to carry custom user object accross request lifecycle. In general it is used to share informations between the [hooks](hooks.md) and the [handler](handler.md).

- key (string): user defined key
- value (any): user defined object

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
