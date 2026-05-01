# Plugins

Galbe provides a plugin system that lets you extend and customize the framework's behavior. Plugin hooks integrate directly with the [Request Lifecycle](https://galbe.dev/documentation/lifecycle).

## Definition

### Plugin Signature

```ts
type GalbePlugin = {
  name: string
  init?: (config: any, galbe: Galbe) => MaybePromise<void>
  onFetch?: (context: Pick<Context, 'request' | 'set' | 'state'>) => MaybePromise<Response | void>
  onRoute?: (context: Pick<Context, 'request' | 'set' | 'state' | 'route'>) => MaybePromise<Response | void>
  beforeHandle?: (context: Context) => MaybePromise<Response | void>
  afterHandle?: (response: Response, context: Context) => MaybePromise<Response | void>
  cli?: (commands: GalbeCLICommand[]) => MaybePromise<GalbeCLICommand[] | void>
}
```

### name
The plugin name should be a Unique Plugin Identifier to prevent conflicts with other plugins. Ideally, it follows the format `com.example.myplugin`.

### init
This method is called once when the server starts (after route discovery and before the first request is served). It receives two arguments:
- `config`: The plugin-specific configuration (see the [`plugin`](../reference/configuration.md#plugin) configuration property).
- `galbe`: The Galbe server instance. From it you can read registered routes (`galbe.router.routes`) and route metadata (`galbe.meta`).

### onFetch
This method is executed at the beginning of an incoming request. It receives a restricted `context` object containing `request`, `set`, and `state`.

It is **preemptable**, meaning that if a response is returned, it will be sent to the client immediately, bypassing further processing.

### onRoute
Executed after the router identifies a matching route for the request. It takes a restricted `context` argument (same as `onFetch` plus `route`) and is **preemptable**, meaning it can return an early response.

### beforeHandle
Runs after request validation but before route hooks and the handler are called. Like the previous lifecycle methods, it is **preemptable**.

### afterHandle
Called after the route handler runs but before the response is sent. It receives two arguments:
- `response`: The [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) object built from the handler's return value.
- `context`: The request [Context](context.md).

It is also **preemptable**: any returned response overrides the original one.

### cli
Lets a plugin register custom commands on the [Galbe CLI](../reference/cli.md). It receives the current list of `GalbeCLICommand` entries (one per registered route) and may return a modified list or `void` to keep the input as-is. Each `GalbeCLICommand` describes a command name, a list of tags, the route it targets, optional `arguments` / `options`, and an optional `action` callback that overrides the default behavior.

## Plugin Registration

To register a plugin, use the `use` method on your Galbe instance.

```js
const galbe = new Galbe()
galbe.use(plugin)
```

> [!NOTE]
> `use` only stores the plugin. Each plugin's `init` runs when the server starts (e.g. when `galbe.listen()` is called).

## How to Create a Plugin

This section will walk you through the process of creating a plugin.
Before creating a plugin, don't forget to check if there's an existing plugin that can be used. You can take a look at the official [Plugin List](https://galbe.dev/plugins).

### 1. Scaffolding

The Galbe starter CLI provides a template for setting up a plugin project:

```bash
$ bun create galbe my-plugin --template plugin
$ cd my-plugin
$ bun install
```

### 2. Implementation

Below is an example of a plugin that handles routes tagged with `@deprecated` metadata (See [Route Files](routes.md#route-files) for metadata usage).

deprecated.plugin.ts
```ts
import type { GalbePlugin, Route } from 'galbe'
import { walkMetaRoutes } from 'galbe/utils'

const PLUGIN_ID = 'dev.galbe.deprecated'

export default (): GalbePlugin => {
  let deprecateds = new Set<string>()
  const isRouteDeprecated = (route?: Route) => 
    deprecateds.has(JSON.stringify({ method: route?.method, path: route?.path }))
  
  return {
    name: PLUGIN_ID,
    // Init the plugin, check for deprecated metadata tags
    init(_config, galbe) {
      walkMetaRoutes(galbe.meta || [], (method, path, meta) => {
        if (meta.deprecated) deprecateds.add(JSON.stringify({ method, path }))
      })
    },
    // Check if the current route is deprecated; if so, flag it as such and log it
    onRoute(context) {
      let r = context.route
      if (isRouteDeprecated(r)) {
        console.warn(`Call to deprecated route "${r?.method} ${r?.path}"`)
      }
    },
    // Add a header to the response if the route has been flagged as deprecated
    afterHandle(response, context) {
      if (isRouteDeprecated(context.route)) {
        response.headers.set('x-deprecated', 'true')
      }
    }
  } as GalbePlugin
}
```

Register the plugin with your Galbe server:

```ts
import { Galbe } from 'galbe'
import deprecatedPlugin from './deprecated.plugin'

const galbe = new Galbe()
galbe.use(deprecatedPlugin())

export default galbe
```

### 3. Publishing

To submit your plugin to the [official plugin list](https://galbe.dev/plugins), follow these steps:

1. **Create a public GitHub repository** for your plugin, ensuring that the `README.md` includes:
   - A clear description of your plugin.
   - Installation and configuration instructions.
   - Usage examples.

2. _(Optional)_ Publish your plugin to [NPM](https://npmjs.com).

3. **Submit a Pull Request** to add your plugin configuration to [plugins.json](https://github.com/pierre-cm/galbe-website/blob/main/plugins.json) in the following format:

```json
"plugin-id": {
  "name": "Plugin Name",
  "description": "Plugin description",
  "repo": "https://github.com/<username>/<repo-name>",
  "npm": "https://www.npmjs.com/package/<package-name>"
}
```

> [!IMPORTANT]
> Provide all relevant details in the Pull Request description. It will be reviewed by project maintainers as soon as possible. Check the [Galbe Contributing Guide](../community/CONTRIBUTING.md) before submitting.
