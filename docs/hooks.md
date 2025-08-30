# Hooks

Hooks provide a simple way to execute specific actions before and/or after reaching a route endpoint in Galbe.

## Defining Hooks

```ts
const hook = async (context, next) => {
  context.state['foo'] = 'bar'
  await next()
  console.log('Hook end')
}
```

A hook takes two arguments: `context` and `next`.

### context

The `context` object contains request information and a modifiable `state` property that persists across all hooks and the handler. This is useful for sharing data across hooks and handlers. More details are available in the [Context](context.md) section.

### next

The `next` function calls the next hook in the list, or the handler if the current hook is the last one. The `next` function should be called at most once. If omitted, Galbe will automatically call it at the end of the current hook’s execution.

> [!TIP]
> Hooks are interruptible, meaning they can return a response at any time. This is useful for implementing custom logic such as authentication, authorization, and caching.
>
> For more details on response handling, see [Response Types](handler.md#response-types).

## Declaring Hooks

Hooks should be declared before the handler method in the [Route Definition](routes.md#route-definition) as a list of hook functions.

```ts
galbe.get('/foo', [hook1, hook2, ...], ctx => {})
```

Hooks execute in the order they are declared, just before the [Handler](handler.md). For a deeper understanding of their execution in the request lifecycle, see the [Lifecycle](https://galbe.dev/documentation/lifecycle) section.

### Examples

#### Linear Hook Execution

```ts
const hook1 = context => {
  console.log('hook1 called')
}
const hook2 = context => {
  console.log('hook2 called')
}

galbe.get('/example', [hook1, hook2], ctx => {
  console.log('handler')
})
```

```bash
$ curl http://localhost:3000/example
hook1
hook2
handler
```

#### Nested Hook Execution

```ts
const hook1 = async (context, next) => {
  console.log('hook1 start')
  await next()
  console.log('hook1 end')
}
const hook2 = async (context, next) => {
  console.log('hook2 start')
  await next()
  console.log('hook2 end')
}

galbe.get('/example', [hook1, hook2], ctx => {
  console.log('handler')
})
```

```bash
$ curl http://localhost:3000/example
hook1 start
hook2 start
handler
hook2 end
hook1 end
```
