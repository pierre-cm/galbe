# Plugins

Galbe provides a powerful plugin system that allows developers to extend and customize the behavior of the framework. The plugin capabilities are centered around the [Request Lifecycle](https://galbe.dev/documentation/lifecycle).

## Definition

### Signature

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

The name should be a Unique Plugin Identifier. It should be chosen to be unique to avoid conflicts with other potential plugins. Ideally, it will have the form of `com.example.myplugin`.

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

### Usage

To register a plugin with your Galbe server, you must use the `use` method from you galbe instance.

```js
const galbe = new Galbe()
galbe.use(plugin)
```

## Create a plugin

### 1. Scaffolding

The Galbe starter CLI provides a template that can be used to setup a Galbe plugin project.

```bash
$ bun create galbe my-plugin --template plugin
$ cd my-plugin
$ bun install
```

Now you should be ready to start developing your plugin. Following section will present an example of a plugin implementation.

### 2. Implementation

Here is an example of a plugin implementation that handles routes tagged with `@deprecated` metadata (See [Route files](routes.md#route-files) section about metadata).

deprecated.plugin.ts

```ts
import type { GalbePlugin } from 'galbe'
import { walkMetaRoutes } from 'galbe/utils'

const PLUGIN_ID = 'dev.galbe.deprecated'

export default () => {
  let deprecateds = new Set<string>()
  return {
    name: PLUGIN_ID,
    // Init the plugin, check for deprecated metadata tags
    init(_config, galbe) {
      if (galbe.meta) {
        walkMetaRoutes(galbe.meta, (method, path, meta) => {
          if (meta.deprecated) deprecateds.add(JSON.stringify({ method, path }))
        })
      }
    },
    // Check if the current route is deprecated; if so, flag it as such and log it
    onRoute(context) {
      let r = context.route
      if (!r) return
      if (deprecateds.has(JSON.stringify({ method: r.method, path: r.path }))) {
        console.warn(`Call to deprecated route "${r.method} ${r.path}"`)
      }
    },
    // Add a header to the response if the route has been flagged as deprecated
    afterHandle(response, context) {
      let r = context.route
      if (!r) return
      if (deprecateds.has(JSON.stringify({ method: r.method, path: r.path }))) {
        response.headers.set('x-deprecated', 'true')
      }
    }
  } as GalbePlugin
}
```

```ts
import { Galbe } from 'galbe'
import deprecatedPlugin from './deprecated.plugin'

const galbe = new Galbe()
galbe.use(deprecatedPlugin())

export default galbe
```

### 3. Publishing

If you want to submit your plugin to the [official plugin list](https://galbe.dev/plugins), you should follow these steps:

1. Create a **public** Github repository for your plugin. Make sure to include the following information in the README at the root of your repository:

   - A description of your plugin and what it does.
   - How to install and configure it.
   - How to use it.

2. (_Optional_) Publish your plugin to [NPM](https://npmjs.com).

3. Create a Pull Request adding your plugin config to [plugins.json](https://github.com/pierre-cm/galbe-website/blob/main/plugins.json) file. The config should be in the following format:

```json
"plugin-id": {
  "name": "Plugin Name",
  "description": "Plugin description",
  "repo": "https://github.com/<username>/<repo-name>",
  "npm": "https://www.npmjs.com/package/<package-name>",
}
```

> [!IMPORTANT]
> Please provide any relevent information about the plugin in the Pull Request description. It will be reviewed by the project maintainers as soon as possible. Be sure to check the [Glabe Contributing Guide](https://github.com/pierre-cm/galbe/blob/main/docs/CONTRIBUTING.md) before submitting any request. Same rules will apply here.
