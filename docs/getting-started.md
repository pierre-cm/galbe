# Getting started

Galbe is a Javascript web framework for building fast and versatile backend servers with Bun.

Designed with simplicity in mind, Galbe allows you to quickly create and set up a project. In addition to its ease of use, Galbe also offers a range of useful features that help you focus on the core logic of your application.

## Requirements

To start developing your Galbe project, you first need to install [Bun](https://bun.sh).

## Automatic installation

This is the recommended way of setting up a Galbe project.

```bash
$ bun create galbe app
```

The Galbe starter CLI will request you to chose a template and a target language for your project. Let's select `hello` as template and `ts` as language. This will create a new project under `app` directory.

Now you can navigate to your newly created project and install it:

```bash
$ cd app
$ bun install
```

And start the dev server by running:

```bash
$ bun dev
🏗️  Constructing routes

    hello.route.ts
    [GET]     /hello/:name  Greeting endpoint

done

🚀 Server running at http://localhost:3000
```

Let's try to reach the hello endpoint:

```bash
$ curl localhost:3000/hello/John?age=32
Hello John! You're 32 y.o.
```

> [!TIP]  
> If you want to have a more complete view of Galbe capabilities, feel free to take a look at the `demo` template from the Galbe starter CLI.

## Manual installation

Init a new Bun project and add Galbe as dependency:

```bash
$ bun init
$ bun add galbe
```

Open `package.json` file and add the following scripts:

```json
{
  "scripts": {
    "dev": "galbe dev index.ts",
    "build": "galbe build index.ts",
    "test": "bun test"
  }
}
```

As you can see, those scripts rely on Galbe CLI to run and build the application. You will find more info about it on the [CLI](cli.md) page.

This require your `index.ts` to export a default Galbe instance in order to work. As in the following example:

```ts
import { Galbe } from 'galbe'

const galbe = new Galbe({ port: 3000 })
galbe.get('/hello', () => 'Hello Mom!')

export default galbe
```

This is the recommended way to proceed but it is not mandatory. Galbe instances also provide a `listen` method that will allow you to manually start your server instance from the code.

> [!WARNING]
> In the case you decide to not rely on Galbe CLI to run/build your app, you will not have access to [Automatic Route Analyzer](routes.md#automatic-route-analyzer) feature.

## Configuration

To configure your Galbe server, you should pass your configuration to the Galbe constructor when you instanciate it.

```ts
const galbe = new Galbe(configuration)
```

### Properties

**hostname**

The hostname of the server. Default is `localhost`.

**port**

The port number that the server will be listening on. Default is `3000`.

**basePath**

The base path is added as a prefix to all the routes created.

**routes**

A Glob Pattern or a list of Glob patterns defining the route files to be analyzed by the [Automatic Route Analyzer](routes.md#automatic-route-analyzer). Default is `src/**/*.route.{js,ts}`.

**plugin**

A property that can be used by plugins to add plugin's specific configuration. Every key should correspond to a [Unique Plugin Identifier](plugins.md).

**tls**

Enable or disable TLS support. Default value is `false`.

- **tls.key**: The path to the private key file

- **tls.cert**: The path to the certificate file

- **tls.ca**: The path to the certificate authority file

**requestValidator.enabled**

Enable or disable the _request_ schema validation (See [Request Schema definition](schemas.md#request-schema-definition)). Default value is `true`.

**responseValidator.enabled**

Enable or disable the _response_ schema validation (See [Request Schema definition](schemas.md#request-schema-definition)). Default value is `true`.

### Examples

A common way to handle server configuration is to create new file `galbe.config.(js|ts|json)` at the root of your project directory and import it in your code. Here is an example:

galbe.config.js

```js
export default {
  port: Bun.env.GALBE_PORT
  routes: 'src/**/*.route.ts',
}
```

index.js

```js
import { Galbe } from 'galbe'
import config from './galbe.config'

export default new Galbe(config)
```

> [!TIP]  
> If you are using Typescript, you can import `GalbeConfig` type from galbe package to ensure type consistency for your configuration. Here is an example:
>
> ```ts
> import type { GalbeConfig } from 'galbe'
> const config: GalbeConfig = {
>   port: Number(Bun.env.GALBE_PORT),
>   routes: 'routes/*.route.ts'
> }
> export default config
> ```

## Project structure

One key aspect of Galbe, is its versatility in terms of project structure. This is partly allowed by the [Automatic Route Analyzer](routes.md#automatic-route-analyzer) and the `routes` config property which defaults to `src/**/*.route.{js,ts}`.

Here are two examples of valid project structures by default:

**Example 1**

```txt
┌── src
│   ├── hooks
│   │   └── log.hook.ts
│   ├── routes
│   │   ├── foo.route.ts
│   │   └── foo.route.ts
│   └── schemas
│       ├── bar.schema.ts
│       └── bar.schema.ts
├── galbe.config.ts
├── index.ts
├── package.json
├── README.md
└── tsconfig.json
```

**Example 2**

```txt
┌── src
│   ├── hooks
│   │   └── log.hook.ts
│   ├── foo
│   │   ├── foo.route.ts
│   │   └── foo.schema.ts
│   └── bar
│       ├── bar.route.ts
│       └── bar.schema.ts
├── galbe.config.ts
├── index.ts
├── package.json
├── README.md
└── tsconfig.json
```

In both cases, the [Automatic Route Analyzer](routes.md#automatic-route-analyzer) will analyze `foo.route.ts` and `bar.route.ts` Route Files to find route definitions.

You can find more info about Route Files definition in the [Routes Files](routes.md#route-files) section.

> [!NOTE]
> The examples provided above will work with the default configuration, but you can easily customize the routes property to fit your own project structure. Simply redefine the `routes` property with your own pattern(s) to to fit your own project structure.

## How to debug

The easiest way to debug your app is by installing the [VSCode Bun extension](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode).

You can then create a `.vscode/launch.json` config file in your project root directory. Here is an example of configuration:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "bun",
      "request": "launch",
      "name": "Debug Galbe",
      "program": "node_modules/galbe/bin/cli.ts",
      "env": { "TERM": "xterm" },
      "cwd": "${workspaceFolder}",
      "runtime": "bun",
      "runtimeArgs": ["dev", "index.ts", "--watch", "--force"]
    }
  ]
}
```
