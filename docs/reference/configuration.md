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

An object form gives access to the analyzer options:

```ts
export default {
  routes: {
    pattern: 'src/**/*.route.ts', // glob pattern or array of patterns
    dirPrefix: false, // disable directory groups (default: true)
  },
}
```

- **routes.pattern**: same as the plain form. Default: `src/**/*.route.{js,ts}`.
- **routes.dirPrefix**: when `true`, a route file's directory relative to its glob's static base becomes its path prefix (see [Directory Groups](../concepts/routes.md#directory-groups)). Default: `true`.

### middleware

A glob pattern (or array of glob patterns) defining the [middleware files](../concepts/middleware.md#middleware-files) discovered by the Automatic Route Analyzer. Each file default-exports a [middleware definition](../concepts/middleware.md#middleware-files) — or a registration function receiving a registrar — scoped to its directory subtree. Set to `false` to disable middleware discovery only; `routes: false` disables the whole analyzer, middleware files included. Default: `src/**/*.middleware.{js,ts}`.

### plugin

A namespace used by plugins to read their configuration. Each key should match a [Unique Plugin Identifier](../concepts/plugins.md#name).

<!-- prettier-ignore -->
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
  bodyLimit: 1024 * 1024, // 1 MB
}
```

Default: unset. Independently of this setting, Bun enforces its own `maxRequestBodySize` ceiling (128 MB by default) — raise it through the [`server`](#server) passthrough if you configure a larger `bodyLimit`.

### requestValidator.enabled

Enables _request_ schema validation (see [Request Schema Definition](../concepts/schemas.md#request-schema-definition)). Default: `true`.

### responseValidator.enabled

Enables _response_ schema validation (see [response](../concepts/schemas.md#response)). Default: `true`. Only routes declaring a `response` schema are affected, and handlers returning a raw `Response` are never validated.

Validation is not free: it costs roughly **10 % throughput**. What it buys is catching handler bugs — a response drifting from the shape the schema, the generated OpenAPI spec and the generated clients all promise. A common pattern is keeping it on in development and test, and disabling it in production once handlers are covered by tests:

```ts
export default {
  responseValidator: { enabled: Bun.env.BUN_ENV !== 'production' },
}
```

> [!NOTE]
> Measured over loopback with ±15–20 % cross-session variance — treat the figures as an order of magnitude, and benchmark your own handlers before trading the safety net away.

### router.cacheEnabled

Enables route caching for dynamic routes (see [Router Caching](../concepts/router.md#caching)). Default: `false`. It is opt-in for a reason: on shallow tries a cache hit can cost more than the trie walk it avoids — see the [tradeoff note](../concepts/router.md#caching) before enabling it.

### router.cacheLimit

Maximum number of entries kept in the route cache. The cache is a bounded LRU: once the limit is reached, the least recently used entries are evicted. Default: `1024`.

### router.warn

A callback receiving route [registration conflicts](../concepts/router.md#registration-conflicts) — a redefined route, or two parameter names sharing one trie node. Defaults to `console.warn` outside production (`BUN_ENV=production` silences it). Provide your own to log them elsewhere, or to throw:

```ts
export default {
  router: {
    warn: message => {
      throw new Error(`route conflict: ${message}`)
    },
  },
}
```

### openapi

Customizes the document-level blocks of the OpenAPI specification produced by `OpenAPISerializer` (`galbe/extras`) and `galbe generate spec`. These describe the document rather than any single route, so they have no route-level equivalent.

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
    tags: [{ name: 'widgets', description: 'Everything about widgets.' }],
    security: [{ bearerAuth: [] }],
    externalDocs: { url: 'https://example.com/docs', description: 'Full handbook' },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
}
```

- **openapi.info**: any subset of the OpenAPI [Info Object](https://spec.openapis.org/oas/v3.0.3#info-object) (`title`, `version`, `description`, `contact`, `license`, `termsOfService`). Unset fields fall back to `title: 'Galbe app'` and `version: '0.1.0'`.
- **openapi.servers**: an OpenAPI [Server Object](https://spec.openapis.org/oas/v3.0.3#server-object) list. When unset and a [`basePath`](#basepath) is configured, it defaults to `[{ url: basePath }]` — generated `paths` are relative to `basePath`, which is a deploy location rather than API structure.

- **openapi.tags**: the document's [Tag Object](https://spec.openapis.org/oas/v3.0.3#tag-object) list — the descriptions behind the names operations use. Operations _name_ their tags through the `@tags` annotation; this is where a tag is described.
- **openapi.security**: the document-level [Security Requirement](https://spec.openapis.org/oas/v3.0.3#security-requirement-object) list, applied to every operation that does not declare its own through `@security`.
- **openapi.externalDocs**: the document's [External Documentation Object](https://spec.openapis.org/oas/v3.0.3#external-documentation-object). Route-level docs come from the `@externalDocs` annotation instead.
- **openapi.securitySchemes**: the spec's [Security Schemes](https://spec.openapis.org/oas/v3.0.3#security-scheme-object), keyed by name. A route's `@security <name>` annotation _names_ a scheme; this is where the scheme itself is defined. A scheme declared here wins over one a [middleware def declares](../concepts/middleware.md#security) under the same name, and over the `bearerAuth` the serializer infers from an `Authorization: Bearer` header.

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
