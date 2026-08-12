# Configuration

## Configuring Galbe

By default, Galbe automatically resolves a configuration file named `galbe.config.{js,ts}` located in the same directory as your entry file.

The configuration file should export a default object containing your settings:

```js
export default {
  // config properties
}
```

Alternatively, you can pass your configuration directly to the Galbe constructor at instantiation:

```ts
import { Galbe } from 'galbe'

const galbe = new Galbe({
  // config properties
})

export default galbe
```

> [!NOTE]
> You can use both methods simultaneously. Galbe first applies the settings from `galbe.config.{js,ts}`, and any properties passed during instantiation override the corresponding ones from the configuration file.

## Configuration Properties

### hostname

The hostname of the server. Default: `localhost`.

### port

The port number the server will listen on. Default: `3000`.

### reusePort

Enables the `SO_REUSEPORT` socket option, allowing multiple processes to share the same port (Linux only). Default: `false`.

### basePath

A base path added as a prefix to all routes. A leading `/` is added automatically if missing.

### routes

A glob pattern (or array of glob patterns) defining the route files to be picked up by the [Automatic Route Analyzer](../concepts/routes.md#automatic-route-analyzer). Set to `false` to disable the analyzer entirely. Default: `src/**/*.route.{js,ts}`.

### plugin

A namespace used by plugins to read their configuration. Each key should match a [Unique Plugin Identifier](../concepts/plugins.md#name).

```ts
export default {
  plugin: {
    'com.example.myplugin': { /* plugin-specific config */ }
  }
}
```

### tls

Enables TLS support. Accepts a [Bun TLSOptions](https://bun.com/docs/api/http#tls) object. When omitted, the server runs over plain HTTP.

- **tls.key**: Path to the private key file (or its contents).
- **tls.cert**: Path to the certificate file (or its contents).
- **tls.ca**: Path to the certificate authority file (or its contents).

### server

Custom options passed through to the underlying [Bun.serve](https://bun.com/docs/api/http#bun-serve) call. Useful for fine-grained server tuning beyond what Galbe exposes directly.

### bodyLimit

Maximum request body size in bytes. When the declared `Content-Length` exceeds the limit, the request is rejected with a `413 Payload Too Large` error before a single byte is read; chunked bodies that outgrow the limit while being received are rejected as soon as they cross it. It can be overridden per route with the schema's [`bodyLimit`](../concepts/schemas.md#bodylimit) property.

```ts
export default {
  bodyLimit: 1024 * 1024 // 1 MB
}
```

Default: unset. Independently of this setting, Bun enforces its own `maxRequestBodySize` ceiling (128 MB by default) — raise it through the [`server`](#server) passthrough if you configure a larger `bodyLimit`.

### requestValidator.enabled

Enables _request_ schema validation (see [Request Schema Definition](../concepts/schemas.md#request-schema-definition)). Default: `true`.

### responseValidator.enabled

Enables _response_ schema validation (see [response](../concepts/schemas.md#response)). Default: `true`.

### router.cacheEnabled

Enables route caching for dynamic routes (see [Router Caching](../concepts/router.md#caching)). Default: `false`.

### router.cacheLimit

Maximum number of entries kept in the route cache. The cache is a bounded LRU: once the limit is reached, the least recently used entries are evicted. Default: `1024`.

### openapi

Customizes the top-level `info` and `servers` blocks of the OpenAPI specification produced by `OpenAPISerializer` (`galbe/extras`) and `galbe generate spec`.

```ts
export default {
  openapi: {
    info: {
      title: 'My API',
      version: '1.2.0',
      description: 'An API described explicitly',
      contact: { name: 'Jane Doe', email: 'jane@example.com' },
      license: { name: 'MIT' },
    },
    servers: [{ url: 'https://api.example.com/v1' }],
  },
}
```

- **openapi.info**: any subset of the OpenAPI [Info Object](https://spec.openapis.org/oas/v3.0.3#info-object) (`title`, `version`, `description`, `contact`, `license`, `termsOfService`). Unset fields fall back to `title: 'Galbe app'` and `version: '0.1.0'`.
- **openapi.servers**: an OpenAPI [Server Object](https://spec.openapis.org/oas/v3.0.3#server-object) list. Unset by default.

When generating a spec with `galbe generate spec`, values set here take precedence over the `package.json` inference (`name`, `description`, `author`, `license`, `version`), which itself takes precedence over the built-in defaults.

## Config Type Safety

To enforce type safety in your configuration file, use the `config` helper, which leverages your IDE's IntelliSense:

```ts
import { config } from 'galbe'

export default config({
  // ...
})
```

Alternatively, you can apply the `GalbeConfig` type with `satisfies`:

```ts
import type { GalbeConfig } from 'galbe'

export default {
  // ...
} satisfies GalbeConfig
```
