# Shemas

Galbe provides a custom Schema Type processor that offers type safety, data parsing, and validation. The primary purpose of this feature is to simplify request input validation and error handling automatically. Additionally, it enhances the developer's experience by inferring static TypeScript types from schema definitions.

## Schema Types

To start using Schema definitions, import `$T` from the `galbe` library:

```js
import { $T } from 'galbe'
```

Here the list of available Schema types in Galbe:

#### Boolean

Schema Type matching `boolean` values.

```ts
const boolSchema = $T.boolean()
```

#### String

Schema Type matching `string` vlues.

```ts
const strSchema = $T.string(options)
```

#### Number

Schema Type matching `number` values.

```ts
const numSchema = $T.number(options)
```

#### Integer

Schema Type matching integer `number` values.

```ts
const intSchema = $T.integer(options)
```

#### Any

Schema Type matching `any` of the previous Schema Types.

```ts
const anySchema = $T.any()
```

#### Array

Schema Type matching `array` values.

```ts
const arraySchema = $T.array($T.any(), options)
```

#### Optional

Makes any type optional. This allows for `undefined` values.

```ts
const optionalSchema = $T.optional($T.string())
```

#### Union

Creates an union of Schema Types.

```ts
const unionSchema = $T.union([$T.string(), $T.number()])
```

## Request Schema definition

The Request Schema definition allows you to define a schema for your request on your [Route Definition](routes.md#route-defintion). It must be defined right after the path of your route.

```js
const schema = {}
galbe.get('/foo/:bar', schema, ctx => {})
```

The Request Schema has four optional properties:

### headers

```ts
headers: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral }
```

This is a key-value object where each key represents a request header name, and the value is the associated Schema.

**Example**:

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

This is a key-value object where each key represents a request path parameter name, and the value is the associated Schema.

**Example**:

```ts
const schema = {
  params: {
    name: $T.string(),
    age: $T.integer({ min: 0 })
  }
}
```

> [!WARNING]
> Every key should match an existing [route path](routes.md#route-defintion) parameter. Otherwise Typescript will show an error.
>
> By default, if no schema is defined for a given parameter. Galbe will assume it is of type `string`.

### query

```ts
query: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral }
```

This is a key-value object where each key represents a request query parameter name, and the value is the associated Schema.

**Example**:

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
body: STByteArray | STString | STBoolean | STNumber | STInteger | STLiteral | STObject | STArray | STMulripartForm | STUrlForm | STStream
```

#### Json

To define an `application/json` request body, use `STObject` Schema Type. Example:

```ts
const jsonBody = $T.object({
  name: $T.string(),
  age: $T.integer({ min: 0 })
})
```

#### Multipart

To define a `multipart/form-data` request body, use `TMultipartForm` Schema Type. Example:

```ts
const multipartBody = $T.multipartForm({
  name: $T.string(),
  age: $T.integer({ minimum: 0 })
})
```

#### Url Form

To define an `application/x-www-form-urlencoded` request body, use `TUrlForm` Schema Type. Example:

```ts
const urlBody = $T.urlForm({
  name: $T.string(),
  age: $T.integer({ minimum: 0 })
})
```

#### Stream

Some body request types can be streamed by using `STStream` Schema Type wrapper. The streamable Schema Types are `STByteArray`, `STString`, `STUrlForm` and `STMultipartForm`. This can be usefull to imporve performances in case you have heavy body payloads and you want to perform early validations on the body.

Let's look at a concrete example where this could be useful. Imagine you want a `multipart/form-data` body request that has two properties: `username` and `heavyImageFile`. In a normal case, you would define something like this:

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

This means that in the case where the username wouldn't pass the validation, the full request body, including the `heavyImageFile`, would have been processed for nothing, as it is not used. This would induce unnecessary time and resource consumption.

The `STStream` Schema Type wrapper was created to remediate to remediate this issue. In practice it allows you to perform validations on the fly. Now in your handler, instead of receiving an object as `ctx.body`, you will receive an [AsyncGenerator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator).

```ts
galbe.post(
  'user/create',
  {
    body: $T.stream($T.multipartForm({
      username: $T.string(),
      heavyImageFile: $T.byteArray()
    }))
  },
  ctx => {
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
response: Record<number, STByteArray | STString | STBoolean | STNumber | STInteger | STLiteral | STObject | STArray | STStream>
```

Same as for request body validation but to validate handler responses. Every schema type must be associated to a specific response status.

#### Example

```ts
const response = {
  200: $T.object({ data: $T.array($T.number()) })
  404: $T.literal("Not found")
}
```
