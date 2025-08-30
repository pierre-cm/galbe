# Schemas

Galbe provides a custom Schema Type processor that offers type safety, data parsing, and validation. The use of Schemas highly simplifies request input validation and automatic error handling. Additionally, it enhances the developer experience by inferring static TypeScript types from schema definitions.

## Schema Types

To use Schema definitions, import `$T` from the `galbe` library:

```js
import { $T } from 'galbe'
```

Here is the list of available Schema types in Galbe:

#### boolean

Schema Type matching `boolean` values.

```ts
const boolSchema = $T.boolean()
```

#### string

Schema Type matching `string` values.

```ts
const strSchema = $T.string(options)
```

#### number

Schema Type matching `number` values.

```ts
const numSchema = $T.number(options)
```

#### integer

Schema Type matching integer `number` values.

```ts
const intSchema = $T.integer(options)
```

#### null

Schema Type matching `null` values.

```ts
const nullSchema = $T.null(options)
```

#### any

Schema Type matching `any` of the previous Schema Types.

```ts
const anySchema = $T.any()
```

#### array

Schema Type matching `array` values.

```ts
const arraySchema = $T.array($T.any(), options)
```

#### optional

Makes any type optional, allowing `undefined` values.

```ts
const optionalSchema = $T.optional($T.string())
```

#### nullable

Makes any type nullable, allowing `null` values.

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

## Request Schema Definition

The Request Schema definition allows you to define a schema for your request in your [Route Definition](routes.md#route-definition). It must be defined right after the route path.

```js
const schema = {}
galbe.get('/foo/:bar', schema, ctx => {})
```

The Request Schema has four optional properties:

### headers

```ts
headers: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral }
```

Defines request headers with their respective Schema types.

**Example:**

```ts
const schema = {
  headers: {
    'User-Agent': $T.optional($T.string({ pattern: '^Bun' }))
  }
}
```

### params

```ts
params: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral }
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
> Every key should match an existing [route path](routes.md#route-definition) parameter. Otherwise, TypeScript will show an error. If no schema is defined for a given parameter, Galbe assumes it is of type `string`.

### query

```ts
query: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral }
```

Defines query parameters with their respective Schema types.

**Example:**

```ts
const schema = {
  query: {
    name: $T.literal('Galbe'),
    list: $T.array($T.number())
  }
}
```

### body

<!-- prettier-ignore -->
```ts
body: STByteArray | STString | STBoolean | STNumber | STInteger | STLiteral | STObject | STArray | STMultipartForm | STUrlForm | STStream
```

Defines the request body Schema type based on content type.

#### object

Defines an `application/json` request body.

```ts
const jsonBody = $T.object({
  name: $T.string(),
  age: $T.integer({ min: 0 })
})
```

#### multipartForm

Defines a `multipart/form-data` request body.

```ts
const multipartBody = $T.multipartForm({
  name: $T.string(),
  age: $T.integer({ min: 0 })
})
```

#### urlForm

Defines an `application/x-www-form-urlencoded` request body.

```ts
const urlBody = $T.urlForm({
  name: $T.string(),
  age: $T.integer({ min: 0 })
})
```

#### stream

Certain request body types can be streamed using `STStream` wrapper, improving performance by validating data incrementally.
This can be usefull to imporve performances in case you have heavy body payloads by leveraging early validation and fail fast behaviors.

**Example**

Let's consider a `multipart/form-data` body request that has two properties: `username` and `heavyImageFile`:

```ts
galbe.post(
  'user/create',
  {
    body: $T.multipartForm({
      username: $T.string(),
      heavyImageFile: $T.byteArray()
    })
  },
  ctx => {
    // At that point, the full body request has been processed
    if(!isValid(ctx.body.username))
      throw new RequestError({ status: 400 })
    else ctx.set.status = 201
  }
})
```

In that case, even if the `username` doesn't pass the validation, the full request body, including the `heavyImageFile` is processed before sending the response. This induces unnecessary time and resource consumption because the `heavyImageFile` is processed despite never been used.

A better approach would consist in leveraging `STStream` wrapper to implement early validation and fail fast behavior. By defining the request body as a stream. Instead of receiving a plain js object as `ctx.body`, you will receive an [AsyncGenerator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator).

```ts
galbe.post(
  'user/create',
  {
    body: $T.stream($T.multipartForm({
      username: $T.string(),
      heavyImageFile: $T.byteArray()
    }))
  },
  async ctx => {
    // At that point, the body has not been processed yet.
    for await (const [key, value] of ctx.body) {
      if (key === "username" && !isValid(value)) {
        // Returns an early response before heavyImageFile is processed
        throw new RequestError({ status: 400 })
      }
    }
    ctx.set.status = 201
  }
})
```

### response

<!-- prettier-ignore -->
```ts
response: Record<number | 'default', STByteArray | STString | STBoolean | STNumber | STInteger | STLiteral | STObject | STArray | STStream>
```

Defines response validation by associating schema types with specific HTTP status codes. The special key `default` can also be used to define the Response Schema for the remaining status codes.

**Example:**

```ts
const response = {
  200: $T.object({ data: $T.array($T.number()) }),
  404: $T.literal("Not found"),
  default: $T.string(),
}
```

This ensures all responses adhere to the defined schema.

> [!NOTE]
> The response validation is enabled by default, meaning that every enpoint response that has a schema defined will be validated at runtime. To disable runtime validation, you can set the `responseValidator?.enabled` option to `false` in the [configuration](getting-started.md#configuration).
