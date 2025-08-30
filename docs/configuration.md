# Configuration

## Configuring Galbe

By default, Galbe automatically attempts to resolve a configuration file named `galbe.config.{js,ts}` located in the same directory as your entry file.

The configuration file should export a default object containing your settings:

```js
export default {
  // config properties
}
```

Alternatively, you can pass your configuration directly to your Galbe server during instantiation, as shown below:

```ts
import { Galbe } from "galbe"

const galbe = new Galbe({
  // config properties
})

export default galbe
```

> [!NOTE]
> You can use both configuration methods simultaneously. Galbe will first apply the settings from `galbe.config.{js,ts}`, and any properties passed during instantiation will override the corresponding ones from the configuration file.

## Configuration Properties

### hostname
The hostname of the server. Default: `localhost`.

### port
The port number the server will listen on. Default: `3000`.

### basePath
A base path added as a prefix to all routes.

### routes
A glob pattern or list of glob patterns defining the route files to be analyzed by the [Automatic Route Analyzer](routes.md#automatic-route-analyzer). Default: `src/**/*.route.{js,ts}`.

### plugin
A property used by plugins to add specific configurations. Each key should correspond to a [Unique Plugin Identifier](plugins.md).

### tls
Enables or disables TLS support. Default: `false`.
- **tls.key**: Path to the private key file.
- **tls.cert**: Path to the certificate file.
- **tls.ca**: Path to the certificate authority file.

### requestValidator.enabled
Enables or disables _request_ schema validation (see [Request Schema Definition](schemas.md#request-schema-definition)). Default: `true`.

### responseValidator.enabled
Enables or disables _response_ schema validation (see [Response Schema Definition](schemas.md#request-schema-definition#response)). Default: `true`.

## Config Type Safety

To ensure type safety for your configuration, use the `config` helper method, which leverages your IDE’s IntelliSense:

```ts
import { config } from "galbe"

export default config({
  // ...
})
```

Alternatively, if you are using TypeScript, you can apply the `GalbeConfig` type to enforce type consistency:

```ts
import type { GalbeConfig } from "galbe"

export default {
  // ...
} satisfies GalbeConfig
```

