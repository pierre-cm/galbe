# Hooks

Hooks provide a simple way to execute logic before and/or after the handler runs for a route in Galbe.

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

The `context` object contains request information and a modifiable `state` property that persists across all hooks and the handler. This is useful for sharing data between hooks and the handler. See the [Context](context.md) section for full details.

### next

The `next` function calls the next hook in the chain, or the handler if the current hook is the last one. It should be called at most once. If a hook does not call `next` (and does not return a response), Galbe will call it automatically when the hook returns.

> [!TIP]
> Hooks are **preemptable**: they can return a response at any time to short-circuit the chain. This is useful for authentication, authorization, caching, and similar concerns.
>
> For more details on response handling, see [Response Types](handler.md#response-types).

## Declaring Hooks

Hooks are declared before the handler in the [Route Definition](routes.md#defining-routes), as an array of hook functions.

```ts
galbe.get('/foo', [hook1, hook2, ...], ctx => {})
```

Hooks execute in the order they are declared, just before the [Handler](handler.md). For more on where hooks fit in the request lifecycle, see the [Lifecycle](https://galbe.dev/documentation/lifecycle) section.

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
hook1 called
hook2 called
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
