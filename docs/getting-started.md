# Getting started

Galbe is a Javascript web framework to build fast and versatile backend servers with Bun.

It was designed with simplicity in mind, allowing you to quickly create and setup a project. In addition, Galbe also offers usefull features, allowing you to focus on your application logic rather than the rest.

## Requirements

To start developing your Galbe project, you first need to install [Bun](https://bun.sh).

## Automatic Installation

This is the recommended way of setting up a Galbe project.

```bash
bun create galbe app
cd app
bun install
```

This will create a new project under `app` directory and install it.

Now you can start the dev server by running:

```bash
bun dev
```

This will start a web server on `loclahost:3000`.

To verify that the project was setup correctly and is running, try to reach `loclahost:3000/hello` endpoint, this should return following greeting message:

```bash
$ curl localhost:3000/hello
Hello from Galbe!
```

> [!TIP]  
> By default, the dev server automatically reloads on every file change.

## Manual Installation

Init a new Bun project and add Galbe as dependency:

```bash
bun init
bun add galbe
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

As you can see, those scripts rely on Galbe CLI to run and build the application. You will find more info about Galbe CLI available options in the next section [Galbe CLI]("#galbe-cli").

This require your `index.ts` to export a default Galbe instance in order to work. As in the following example:

```ts
import { Galbe } from 'galbe'

const g = new Galbe({ port: 3000 })
g.get('/hello', () => 'Hello Mom!')

export default galbe
```

This is the recommended way to proceed but it is not mandatory. Galbe instances also provide a `listen` method that will allow you to manually start your server instance from the code.

> [!WARNING]  
> In the case you decide to not rely on Galbe CLI to run/build your app, you will not have access to [Automatic Route Analyzer](routes#automatic-route-analyzer) feature.

### Galbe CLI

```bash
galbe <command> <argument> [options]
```

Here are the available commands:

#### dev

Start a dev server running your Galbe application.

_argument_

The path of the file exporting your Galbe instance

_options_

- `--port` or `-p`: port number (default: 3000)
- `--watch` or `-w`: watch file changes (default: true)

#### build

Bundle your Galbe application.

_argument_

The path of the file exporting your Galbe instance

_options_

- `--out` or `-o`: output file | directory (default: app | dist )
- `--compile` or `-c`: create a standalone executable (default: false)

## Configuration

To configure your Galbe server, you should pass your configuration to the Galbe constructor when you instanciate it.

```ts
const galbe = new Galbe(configuration)
```

### Properties

#### port

The port number that the server will be listening on. Default is `3000`.

#### basePath

The base path is added as a prefix to all the routes created.

#### routes

A Glob Pattern or a list of Glob patterns defining the route files to be analyzed by the [Automatic Route Analyzer](routes#automatic-route-analyzer). Default is `src/**/*.route.{js,ts}`.

#### plugin

A property that can be used by plugins to add plugin's specific configuration. Every key should correspond to a [Unique Plugin Identifier](plugins).

### Examples

An common way to handle server configuration is to create new file a `galbe.config.(js|ts|json)` at the root of your project directory and import it in your code. Here is an example:

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

## Project Structure

One key aspect of Galbe, is its versatility in terms of project structure. This is partly allowed by the [Automatic Route Analyzer](routes#automatic-route-analyzer) and the `routes` config property which defaults to `src/**/*.route.{js,ts}`.

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

In both cases, the [Automatic Route Analyzer](routes#automatic-route-analyzer) will analyze `foo.route.ts` and `bar.route.ts` Route Files to find route definitions.

You can find more info about Route Files definition under the [Routes](routes) section.

> [!NOTE]  
> Those are just examples that will work with the default configuration. You can of course redefine `routes` property with your own pattern(s) to fit your own project structure.
