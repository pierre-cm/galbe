# Plugins

Galbe provides a powerful plugin system that allows developers to extend and customize the behavior of the framework. The plugin capabilities are centered around the [Request Lifecycle](https://galbe.dev/documentation/lifecycle).

## Definition

```ts
type GalbePlugin = {
  name: string
  init?: (config: any, galbe: Galbe) => MaybePromise<void>
  onFetch?: (context: Context) => MaybePromise<Response | void>
  onRoute?: (context: Context) => MaybePromise<Response | void>
  beforeHandle?: (context: Context) => MaybePromise<Response | void>
  afterHandle?: (response: Response, context: Context) => MaybePromise<Response | void>
}
```

**name**

The name should be a Unique Plugin Identifier. It should be chosen to be unique to avoid conflicts with other potential plugins. For example, Galbe's official plugins names will always start with `dev.galbe.*`.

**init**

This method is called right after the server starts. It takes two arguments: a `config` and a `galbe` instance. The `config` holds the configuration for the specific scope of the current plugin (See [Configuration](getting-started.md#properties) `plugin` property for more details). The `galbe` argument is the instance of the current server; you can for instance retrieve the current routes definitions with `galbe.router.routes`.

**onFetch**

This method is called at the beginning of an incoming request. It takes a single `context` argument representing the current request [Context](context.md).

It is preemptable, meaning that any returned value will be interpreted as a response to send back to the client. Therefore, the method should only return [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) instances or nothing.

**onRoute**

This method is called after the router has found a matching route for the current request. Its takes a single `context` argument representing the current request [Context](context.md).

It is preemptable, meaning that any returned value will be interpreted as a response to send back to the client. Therefore, the method should only return [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) instances or nothing.

**beforeHandle**

This method is called after the request has been validated and before the route hooks and the handler are called. It takes a single `context` argument representing the current request [Context](context.md).

It is preemptable, meaning that any returned value will be interpreted as a response to send back to the client. Therefore, the method should only return [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) instances or nothing.

**afterHandle**

This method is called after the route handler has been called and before the response is sent. Its takes two arguments: a `response` object containing the [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) returned by the handler, and a `context` argument representing the current request [Context](context.md).

It is preemptable, meaning that any returned value will be interpreted as a response to send back to the client. Therefore, the method should only return [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) instances or nothing.

## Registration

To register a plugin with your Galbe server, you must use the `use` method from you galbe instance.

```js
const galbe = new Galbe()
galbe.use(plugin)
```

## Example

Here is an example of a plugin implementation that handles routes tagged with `@deprecated` metadata (See [Route files](routes.md#route-files) section about metadata).

```ts
// myPlugin.ts

import { Galbe, type Context, type Route } from 'galbe'

class MyPlugin {
  name = 'dev.galbe.example'
  deprecated: Record<string, string[]> = {}
  /**
   * Retrieve and store all route with a @deprecated flag metadata
   */
  init(config: any, galbe: Galbe) {
    if (config?.enabled && galbe.meta) {
      for (const f of galbe.meta) {
        for (const [path, methods] of Object.entries(f.routes)) {
          for (const [method, meta] of Object.entries(methods)) {
            if (meta.deprecated) {
              if (!this.deprecated?.[method]) this.deprecated[method] = []
              this.deprecated[method].push(path)
            }
          }
        }
      }
    }
  }
  /**
   * Check if the current route is deprecated, flags it as is and logs it
   */
  onRoute(context: Context) {
    let route = context.route
    if (this.deprecated?.[route.method]?.includes(route.path)) {
      context.state[this.name] = { deprecated: true }
      console.warn(`Call to deprecated route [${route.method}]${route.path}`)
    }
  }
  /**
   * Adds a header if the request has previously been flagged as deprecated
   */
  afterHandle(response: Response, context: Context) {
    if (context.state?.[this.name]?.deprecated) {
      response.headers.set('x-deprecated', 'true')
    }
  }
}

export default new MyPlugin()
```

```ts
// index.ts

import { Galbe } from 'galbe'
import config from './galbe.config'
import myPlugin from './myPlugin'

const galbe = new Galbe(config)
galbe.use(myPlugin)

export default galbe
```

As you can see in this example, the [Context](context.md#definition) `state` property is used to persist information between plugins interceptor methods. It is a good practice to scope any information stored in the state with the plugin name, as it can also be used by other plugins and hooks to store data in the context.
