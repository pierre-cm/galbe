# Getting Started

Galbe is a JavaScript web framework for building fast and versatile backend servers with [Bun](https://bun.sh).

Designed for simplicity, Galbe lets you create and configure a project quickly. Beyond ease of use, it ships with the features you need to focus on your application's core logic.

## Requirements

To start developing with Galbe, you first need to install [Bun](https://bun.sh).

## Automatic Installation (Recommended)

This is the recommended way to set up a Galbe project.

```bash
$ bun create galbe app
```

The Galbe starter CLI will prompt you to choose a template and a target language. Select `hello` as the template and `typescript` as the language. This will create a new project in the `app` directory.

Now, navigate to your newly created project and install dependencies:

```bash
$ cd app
$ bun i
```

Start the development server by running:

```bash
$ bun dev
🏗️  Constructing routes

    hello.route.ts
    [GET]     /hello/:name  Greeting endpoint

done

🚀 Server running at http://localhost:3000
```

Try accessing the hello endpoint:

```bash
$ curl localhost:3000/hello/John?age=32
Hello John! You're 32 y.o.
```

> [!TIP]
> To explore more of Galbe's capabilities, check out the `demo` template in the Galbe starter CLI.

## Manual Installation

Initialize a new Bun project and add Galbe as a dependency:

```bash
$ bun init
$ bun add galbe
```

Open `package.json` and add the following scripts:

```json
{
  "scripts": {
    "dev": "galbe dev index.ts -w .",
    "build": "galbe build index.ts",
    "test": "bun test"
  }
}
```

These scripts use the Galbe CLI to run and build the application. More details are available in the [CLI](../reference/cli.md) section.

Your `index.ts` file must export a default Galbe instance:

```ts
import { Galbe } from "galbe"

const galbe = new Galbe({ port: 3000 })
galbe.get("/hello", () => "Hello Mom!")

export default galbe
```

Exporting the Galbe instance as the default export is the recommended approach but not mandatory. A Galbe instance also exposes a `listen(port?, hostname?)` method that lets you start the server manually from your own code.

> [!WARNING]
> If you choose not to use the Galbe CLI for running or building your app, you will not have access to features such as the [Automatic Route Analyzer](../concepts/routes.md#automatic-route-analyzer).

## Project Structure

Galbe is highly flexible in terms of project structure. The [Automatic Route Analyzer](../concepts/routes.md#automatic-route-analyzer), triggered by the `routes` configuration option (default: `src/**/*.route.{js,ts}`), enables versatile project organization.

Here are two examples of valid project structures:

**Example 1**

```txt
┌── src
│   ├── hooks
│   │   └── log.hook.ts
│   ├── routes
│   │   ├── foo.route.ts
│   │   └── bar.route.ts
│   └── schemas
│       ├── foo.schema.ts
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
│   │   └── log.hook.ts
│   ├── foo
│   │   ├── foo.route.ts
│   │   └── foo.schema.ts
│   └── bar
│       ├── bar.route.ts
│       └── bar.schema.ts
├── galbe.config.ts
├── index.ts
├── package.json
├── README.md
└── tsconfig.json
```

In both cases, the [Automatic Route Analyzer](../concepts/routes.md#automatic-route-analyzer) will detect `foo.route.ts` and `bar.route.ts` to set up route definitions.

For more details, see the [Route Files](../concepts/routes.md#route-files) section.

> [!NOTE]
> These examples work with the default configuration, but you can customize the `routes` property to fit your project structure. Define `routes` with your preferred pattern(s) to match your file organization.

## Debugging

The easiest way to debug your application is by using the [VSCode Bun extension](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode).

Create a `.vscode/launch.json` configuration file in your project root with the following content:

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
      "runtimeArgs": ["dev", "index.ts", "-w", "."]
    }
  ]
}
```
