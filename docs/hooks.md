# Hooks

Hooks provide a simple way to perform specific actions before and/or after reaching a specific route endpoint.

## Hook definition

```ts
const hook = (context, next) => {
  context.state['foo'] = 'bar'
  await next()
  console.log('Hook end')
}
```

The hook takes only two arguments, a `context` object and a `next` function.

**context**

The `context` object contains the request information along with a state property that is modifiable and preserved across all hooks and the handler. It is useful for sharing information or objects across hooks and handler. You can find more information about it in the [Context](context.md) section.

**next**

The `next` function calls the next hook in the hook list or the handler if the current hook is the last one declared. The `next` function should be called at most once. If it is omitted, Galbe will call it automatically at the end of the execution of the current hook.

> [!TIP]
> Hooks are interruptible objects, meaning they can return a response at any moment. This provides a powerful mechanism for implementing custom logic, such as authentication, authorization, caching, and more.
>
> To learn more about response types, ou can take a look at the [Response types](handler.md#response-types) section.

## Hooks declaration

Hooks should be declared just before the handler method in the [Route Definition](routes.md#route-defintion) method as a list of Hooks.

```ts
galbe.get('foo', [ hook1, hook2, ... ], ctx => {})
```

Hooks are called just before the [Handler](handler.md) in the order that they have been declared in the hook list of the [Route Definition](routes.md#route-defintion). To get a better understanding of hooks execution during the request lifecycle, you can refer to the [Lifecycle](lifecycle.md) section.

### Examples

Linear hooks declaration:

```ts
const hook1 = context => {
  console.log('hook1 called')
}
const hook2 = context => {
  console.log('hook2 called')
}

galbe.get('example', [hook1, hook2], ctx => {
  console.log('handler')
})
```

```bash
$ curl http://localhost:3000/example
hook1
hook2
handler
```

Nested hooks declaration:

```ts
const hook1 = (context, next) => {
  console.log('hook1 start')
  await next()
  console.log('hook1 end')
}
const hook2 = context => {
  console.log('hook2 start')
  await next()
  console.log('hook2 end')
}

galbe.get('example', [hook1, hook2], ctx => {
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
