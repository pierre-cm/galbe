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

### requestValidator.enabled

Enables _request_ schema validation (see [Request Schema Definition](../concepts/schemas.md#request-schema-definition)). Default: `true`.

### responseValidator.enabled

Enables _response_ schema validation (see [response](../concepts/schemas.md#response)). Default: `true`.

### router.cacheEnabled

Enables route caching for dynamic routes (see [Router Caching](../concepts/router.md#caching)). Default: `false`.

### router.cacheLimit

Maximum number of entries kept in the route cache. The cache is a bounded LRU: once the limit is reached, the least recently used entries are evicted. Default: `1024`.

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
