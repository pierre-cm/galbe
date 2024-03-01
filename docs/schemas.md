# Shemas

Galbe offers a custom Schema Type processor that provides type safety along with data parsing and validation.

The prime intention of that features is to offer an easy way to manage automatically request inputs validation and error handling. Moreover, it also greatly improve developper's experience by infering static Typescript types from schema definitions.

## Schema Types

To get started with Schema defintion, just import `$T` from `galbe` library:

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

#### Union

Creates an union of Schema Types. .

```ts
const unionSchema = $T.union([$T.string(), $T.number()])
```

#### TOptional

Makes any type optional. In practice, this allows for `undefined` values.

```ts
const optionalSchema = $T.optional($T.string())
```

## Request Schema definition

The Request Schema definition allows you to define a schema for your request on your [Route Definition](). It must be defined right after the [path]() of your route.

```js
const schema = {}
galbe.get('/foo/:bar', schema, ctx => {})
```

The Request Schema has 4 optional properties

### headers

```ts
headers: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral }
```

This is a key-value object where each key represents a request `header` name and the value the Schema associated.

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

This is a key-value object where each key represents a request `path parameter` name and the value the Schema associated.

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
> Every key should match an existing [route path]() parameter. Otherwise Typescript will show you an error.
>
> By default, if no schema is defined for a given parameter. Galbe will assume it is of type `string`.

### query

```ts
query: { [key: string]: STString | STBoolean | STNumber | STInteger | STLiteral }
```

This is a key-value object where each key represents a request `query parameter` name and the value the Schema associated.

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

```ts
body: STByteArray | STString | STBoolean | STNumber | STInteger | STLiteral | STObject | STMulripartForm | STUrlForm
```

#### Json

To define an `application/json` request body. You must use `STObject` Schema Type. Example:

```ts
const jsonBody = $T.object({
  name: $T.string(),
  age: $T.integer({ min: 0 })
})
```

#### Multipart

To define a `multipart/form-data` request body. You must use `TMultipartForm` Schema Type. Example:

```ts
const multipartBody = $T.multipartForm({
  name: $T.string(),
  age: $T.integer({ minimum: 0 })
})
```

#### Url Form

To define an `application/x-www-form-urlencoded` request body. You must use `TUrlForm` Schema Type. Example:

```ts
const urlBody = $T.urlForm({
  name: $T.string(),
  age: $T.integer({ minimum: 0 })
})
```

#### Stream

Some body request types can be streamed by using `STStream` Schema Type wrapper. Streamable Schema Types are `STByteArray`, `STString`, `STUrlForm` and `STMultipartForm`.

This can be usefull to imporve performances in case you have heavy body payloads and you want to perform early validations on the body.

Let's see a concrete example where that could be usefull. Imagine you want a `multipart/form-data` body request that has two properties `username` and `heavyImageFile`. In the normal case you would define something like that:

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

This means that in the case where the username wouldn't pass the validation, the full request body including the `heavyImageFile` would have been processed for nothing as it is not used. Inducing unnecessary time and resource consumption.

The `STStream` Schema Type wrapper was created to remediate to that issue. In practice it allows you to perform validations on the fly.

Now in your handler, instead of receiving an object as ctx.body, you'll receive an [AsyncGenerator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator).

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
