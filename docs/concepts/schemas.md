# Schemas

Galbe provides a custom Schema Type processor that offers type safety, data parsing, and validation. Using Schemas greatly simplifies request input validation and automatic error handling. It also enhances the developer experience by inferring static TypeScript types from schema definitions.

## Schema Types

To use Schema definitions, import `$T` from the `galbe` library:

```js
import { $T } from 'galbe'
```

Every schema type accepts an optional `options` object as its last argument. The following keys are common to all types:

- **id** (`string`) — A unique identifier for the schema.
- **title** (`string`) — A human-readable title.
- **description** (`string`) — A description of the schema.
- **default** (`any`) — A default value used when the input is omitted.
- **example** / **examples** (`any`) — Example value(s), surfaced by spec generators (e.g. OpenAPI).
- **deprecated** (`boolean`) — Marks the value as deprecated.
- **readOnly** / **writeOnly** (`boolean`) — Documentation only: the value is only ever sent by the server, or only ever by the client. Surfaced by spec generators; **not enforced at runtime**.

Type-specific options are listed alongside each type below.

Here is the list of available Schema types in Galbe:

#### boolean

Schema Type matching `boolean` values.

```ts
const boolSchema = $T.boolean()
```

#### string

Schema Type matching `string` values.

```ts
const strSchema = $T.string({ minLength: 1, maxLength: 64, pattern: /^[a-z]+$/, format: 'email' })
```

Options:

- **minLength** (`number`) — Minimum string length.
- **maxLength** (`number`) — Maximum string length.
- **pattern** (`RegExp`) — A regular expression the value must match.
- **format** (`string`) — A semantic format hint (e.g. `email`, `uuid`), surfaced by spec generators.

#### number

Schema Type matching `number` values.

```ts
const numSchema = $T.number({ min: 0, max: 10, exclusiveMin: 0, exclusiveMax: 10 })
const priceSchema = $T.number({ format: 'double', multipleOf: 0.25 })
```

Options:

- **min** / **max** (`number`) — Inclusive bounds.
- **exclusiveMin** / **exclusiveMax** (`number`) — Exclusive bounds.
- **multipleOf** (`number`) — The value must be an exact multiple of this number. Compared with a small relative tolerance, so `0.3` passes `multipleOf: 0.1` despite binary floating point.
- **format** (`string`) — The numeric format, surfaced as OpenAPI's `format`. The four machine-integer formats — `int32`, `uint32`, `int64`, `uint64` — also **constrain the range at runtime**; every other format, `float` and `double` included, is documentation only, since any finite JSON number is a valid double.

```ts
$T.integer({ format: 'int32' }) // 2147483648 → "Is out of int32 range"
$T.number({ format: 'float' })  // 0.1 → accepted; the format only reaches the spec
```

#### integer

Schema Type matching integer `number` values.

```ts
const intSchema = $T.integer({ min: 0, max: 10, exclusiveMin: 0, exclusiveMax: 10 })
```

Options: same as `number`.

#### null

Schema Type matching `null` values.

```ts
const nullSchema = $T.null()
```

#### literal

Schema Type matching a single literal `string`, `number`, or `boolean` value.

```ts
const litSchema = $T.literal('admin')
```

#### byteArray

Schema Type matching binary content as a `Uint8Array`.

```ts
const baSchema = $T.byteArray({ minLength: 0, maxLength: 1024 })
```

Options: **minLength**, **maxLength** (in bytes).

#### any

Schema Type matching any value.

```ts
const anySchema = $T.any()
```

#### array

Schema Type matching `array` values.

```ts
const arraySchema = $T.array($T.any(), { minLength: 1, maxLength: 5, unique: true })
```

Options:

- **minLength** (`number`) — Minimum number of items.
- **maxLength** (`number`) — Maximum number of items.
- **unique** (`boolean`) — When `true`, all items must be unique.
- **split** (`string | false`) — Query parameters only: the delimiter that splits a single value into several items (`','` by default). `false` disables splitting, so a value containing the delimiter stays one item; repeated keys are accepted either way. See [query](#query).

#### object

Schema Type matching `object` values with typed properties.

```ts
const objSchema = $T.object({
  name: $T.string(),
  age: $T.optional($T.integer({ min: 0 }))
})
```

Options:

- **additionalProperties** (`Schema | false`) — Governs the properties the schema does not declare. A schema validates every undeclared property against it; `false` rejects them outright. Unset (the default) accepts and ignores them.

```ts
// declared props validate normally, everything else must be an integer
$T.object({ id: $T.string() }, { additionalProperties: $T.integer() })
// a strict object: an undeclared property is a 400
$T.object({ id: $T.string() }, { additionalProperties: false })
```

`Static<>` only ever surfaces the declared properties — an object mixing both would otherwise index every declared key through the value schema too.

#### record

Schema Type matching a free-form map: no declared properties, one schema for every value. Sugar for `$T.object(undefined, { additionalProperties: value })`, typed as `Record<string, Static<V>>`.

```ts
const headers = $T.record($T.string())
//    ^? Record<string, string>
```

#### multipartForm

Schema Type for `multipart/form-data` request bodies. Each property describes a form part.

```ts
const formSchema = $T.multipartForm({
  username: $T.string(),
  avatar: $T.byteArray()
})
```

Options:

- **encoding** (`Record<string, EncodingProperty>`) — Documentation only: how each part is serialized, keyed by property name. Emitted as the media type's OpenAPI `encoding` object. Parts are validated from the schema alone; this is never read at runtime.

```ts
$T.multipartForm(
  { avatar: $T.byteArray() },
  { encoding: { avatar: { contentType: 'image/png' } } }
)
```

#### json

Wraps a primitive or object schema and tags it as JSON content. Useful for typing nested JSON payloads inside other schemas (e.g. a JSON-typed `multipart/form-data` part).

```ts
const jsonSchema = $T.json($T.object({ id: $T.string() }))
```

#### optional

Makes any type optional, allowing `undefined` values.

```ts
const optionalSchema = $T.optional($T.string())
```

#### nullable

Makes any type nullable, allowing `null` values. Equivalent to a union with `null`.

```ts
const nullableSchema = $T.nullable($T.string())
```

#### nullish

Makes any type nullish, allowing both `undefined` and `null` values.

```ts
const nullishSchema = $T.nullish($T.string())
```

#### union

Creates a union of Schema Types.

```ts
const unionSchema = $T.union([$T.string(), $T.number()])
```

#### intersection

Creates an intersection of Schema Types. Members must be objects, unions, or other intersections.

```ts
const intersectionSchema = $T.intersection([
  $T.object({ a: $T.string() }),
  $T.object({ b: $T.number() })
])
```

#### stream

Wraps a streamable schema (`byteArray`, `string`, `multipartForm`, `object`, `union`, `intersection`) so that the request body is exposed as an [AsyncGenerator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator) instead of being fully buffered. See [stream](#stream-1) below for details and a request-body example.

```ts
const streamedBody = $T.stream($T.byteArray())
```

## Request Schema Definition

The Request Schema definition allows you to define a schema for your request in your [Route Definition](routes.md#defining-routes). It must be defined right after the route path.

```js
const schema = {}
galbe.get('/foo/:bar', schema, ctx => {})
```

The Request Schema has seven optional properties: `headers`, `params`, `query`, `cookies`, `body`, `response`, and `bodyLimit`.

### headers

```ts
headers: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral | STUnion }
```

Defines request headers with their respective Schema types.

**Example:**

```ts
const schema = {
  headers: {
    'user-agent': $T.optional($T.string({ pattern: /^Bun/ }))
  }
}
```

> [!NOTE]
> Header names are matched case-insensitively.

### params

```ts
params: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral | STUnion }
```

Defines route parameters with their respective Schema types.

**Example:**

```ts
const schema = {
  params: {
    name: $T.string(),
    age: $T.integer({ min: 0 })
  }
}
```

> [!WARNING]
> Every key must match an existing parameter declared in the [route path](routes.md#defining-routes). Otherwise, TypeScript will report an error. If no schema is defined for a given parameter, Galbe treats it as a `string`.

### query

```ts
query: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral | STUnion | STArray | STObject }
```

Defines query parameters with their respective Schema types.

**Example:**

```ts
const schema = {
  query: {
    name: $T.literal('Galbe'),
    list: $T.array($T.number()),
    filter: $T.object({ lat: $T.number(), lon: $T.number() })
  }
}
```

**Arrays.** An array parameter can be provided by repeating the key (`?list=1&list=2`) or as a single delimited value (`?list=1,2`). Both are always accepted. The delimiter is the array's [`split`](#array) option — `','` by default, `'|'` and `' '` for OpenAPI's `pipeDelimited` and `spaceDelimited`, and `false` to turn splitting off:

```ts
// without split: false, a single item containing a comma is unreachable
$T.array($T.string(), { split: false }) // ?tags=a,b → ['a,b']
$T.array($T.string(), { split: '|' })   // ?tags=a|b → ['a', 'b']
```

**Objects.** An object parameter is read from bracketed keys — OpenAPI's `deepObject`:

```ts
// ?filter[lat]=1.5&filter[lon]=-2  →  { lat: 1.5, lon: -2 }
```

Each property is parsed and validated against the schema that governs it, `additionalProperties` included, so `$T.record()` works as a query parameter too. A JSON-encoded value (`?filter={"lat":1.5}`) is accepted for the same parameter. Only one level of nesting is read — OpenAPI leaves nested `deepObject` undefined.

> [!NOTE]
> Spec generation emits `style` only where Galbe departs from the OpenAPI defaults: `deepObject` for an object parameter, `pipeDelimited` / `spaceDelimited` for a custom `split`. An array parameter accepts both the repeated and the delimited form, which is what the default `form` pair already describes.

### cookies

```ts
cookies: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral | STUnion }
```

Defines request cookies with their respective Schema types. Each one is parsed out of the `Cookie` header and validated like a query parameter, so `ctx.cookies` comes back typed and coerced.

**Example:**

```ts
const schema = {
  cookies: {
    session: $T.string({ minLength: 16 }),
    visits: $T.optional($T.integer({ min: 0 }))
  }
}
```

```ts
galbe.get('/me', schema, ctx => {
  ctx.cookies.session // string
  ctx.cookies.visits // number | undefined
})
```

A declared cookie that is missing or invalid is a `400`, reported under a `cookies` key. Cookies the schema does not declare are still on `ctx.cookies`, as the raw strings they arrived as.

> [!NOTE]
> Cookie names are matched case-sensitively, unlike headers.

### body

<!-- prettier-ignore -->
```ts
body: {
  byteArray?: STByteArray | STStream
  text?: STString | STLiteral | STBoolean | STNumber | STInteger | STUnion | STStream
  json?: STJson | STObject | STBoolean | STInteger | STNumber | STString | STArray | STUnion | STIntersection
  urlForm?: STObject | STStream | STUnion
  multipart?: STMultipartForm | STStream | STUnion
  default?: STString | STByteArray | STStream | STAny
}
```

Defines the request body schema based on content type. The matching schema is selected from the request's `Content-Type` header, then the body is parsed and validated. The `default` key is used when no other entry matches the content type.

#### Byte Array

Matches an `application/octet-stream` request body.

```ts
const body = {
  byteArray: $T.byteArray()
}
```

#### Text

Matches a `text/*` request body.

```ts
const body = {
  text: $T.string()
}
```

#### JSON

Matches an `application/json` request body.

```ts
const body = {
  json: $T.object({
    name: $T.string(),
    age: $T.integer({ min: 0 })
  })
}
```

#### URL Form

Matches an `application/x-www-form-urlencoded` request body.

```ts
const body = {
  urlForm: $T.object({
    name: $T.string(),
    age: $T.integer({ min: 0 })
  })
}
```

#### Multipart Form

Matches a `multipart/form-data` request body.

```ts
const body = {
  multipart: $T.multipartForm({
    name: $T.string(),
    age: $T.integer({ min: 0 })
  })
}
```

Inside a multipart handler, each part is exposed as `{ headers: { name, type?, filename? }, content }`.

#### stream

Certain request body types can be streamed using the `stream` wrapper, improving performance by validating data incrementally.
This is useful for heavy body payloads, since it enables early validation and fail-fast behavior.

**Example**

Consider a `multipart/form-data` body with two fields, `username` and `heavyImageFile`:

```ts
galbe.post(
  '/user/create',
  {
    body: {
      multipart: $T.multipartForm({
        username: $T.string(),
        heavyImageFile: $T.byteArray()
      })
    }
  },
  ctx => {
    // At this point, the full request body has already been processed.
    if (!isValid(ctx.body.username))
      throw new RequestError({ status: 400 })
    else ctx.set.status = 201
  }
)
```

Even if `username` fails validation, the entire body — including `heavyImageFile` — is processed before the response is sent. That's wasted time and memory because `heavyImageFile` is never used.

A better approach is to use the `stream` wrapper to enable early validation and fail-fast behavior. When the body schema is wrapped in `$T.stream(...)`, `ctx.body` becomes an [AsyncGenerator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator) instead of a fully-parsed object.

```ts
galbe.post(
  '/user/create',
  {
    body: {
      multipart: $T.stream($T.multipartForm({
        username: $T.string(),
        heavyImageFile: $T.byteArray()
      }))
    }
  },
  async ctx => {
    // At this point, the body has not been processed yet.
    for await (const { headers, content } of ctx.body) {
      if (headers.name === 'username' && !isValid(content)) {
        // Returns an early response before heavyImageFile is processed
        throw new RequestError({ status: 400 })
      }
    }
    ctx.set.status = 201
  }
)
```

### bodyLimit

```ts
bodyLimit: number
```

Maximum request body size in bytes for this route, overriding the global [`bodyLimit`](../reference/configuration.md#bodylimit) configuration. Larger bodies are rejected with a `413 Payload Too Large` error, and multipart parts are also capped individually.

**Example:**

```ts
galbe.post(
  '/upload',
  {
    bodyLimit: 10 * 1024 * 1024, // 10 MB
    body: {
      multipart: $T.multipartForm({
        heavyImageFile: $T.byteArray()
      })
    }
  },
  ctx => {}
)
```

### response

<!-- prettier-ignore -->
```ts
response: Record<number | '1XX' | '2XX' | '3XX' | '4XX' | '5XX' | 'default', STByteArray | STString | STBoolean | STNumber | STInteger | STLiteral | STObject | STArray | STUnion | STIntersection | STStream | STAny | STNull>
```

Defines response validation by associating schema types with specific HTTP status codes. A key may be an exact status, a wildcard range (`'4XX'` covers every 4xx status), or `default`.

**Example:**

```ts
const response = {
  200: $T.object({ data: $T.array($T.number()) }),
  404: $T.literal('Not found'),
  '5XX': $T.object({ code: $T.string() }),
  default: $T.string()
}
```

This ensures every response adheres to the defined schema.

**Precedence.** An exact status wins over the range containing it, which wins over `default` — for response validation, for the content type inferred on a string response, and for the generated OpenAPI document alike. With the schema above, a `404` validates against the literal, a `503` against the `5XX` object, and a `301` against `default`.

A response entry may also be written in its content-map form, which carries the response's own metadata beside its media types:

```ts
const response = {
  201: {
    'application/json': Widget,
    description: 'Created.',
    responseHeaders: { Location: $T.string({ format: 'uri' }) },
    responseLinks: { GetWidget: { operationId: 'getWidget', parameters: { id: '$response.body#/id' } } }
  }
}
```

`responseLinks` is the OpenAPI `links` object, carried verbatim into the spec — documentation only, nothing reads it at runtime. A bare `$T.null()` response means "no body", at every status.

> [!NOTE]
> Response validation is enabled by default: any endpoint response with a matching schema is validated at runtime. To disable runtime validation, set `responseValidator.enabled` to `false` in the [Configuration](../reference/configuration.md#responsevalidatorenabled).
