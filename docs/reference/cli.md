# CLI

A Command Line Interface is shipped with the Galbe package. You can use it to perform useful tasks around your application.

After [installing Galbe](../introduction/getting-started.md#automatic-installation-recommended), the CLI is available locally to your project.

To use it directly from your terminal, either install it globally:

```bash
$ bun i -g galbe
```

Or run it through `bunx`:

```bash
$ bunx galbe
```

## dev

Start a dev server running your Galbe application.

#### Arguments

| Name  | Description                                               |
| ----- | --------------------------------------------------------- |
| index | The js or ts file that exports your Galbe server instance. |

#### Options

| Short | Long          | Description                                | Default |
| ----- | ------------- | ------------------------------------------ | ------- |
| -p    | --port        | port number [1-65535]                      | 3000    |
| -w    | --watch [dir] | watch file changes (defaults to index dir) | false   |
| -wi   | --watchignore | ignored watch files regex                  |         |
| -nc   | --noclear     | don't clear on file changes                | false   |

#### Example

index.js

```js
import { Galbe } from 'galbe'

const g = new Galbe()
g.get('example', () => '')

export default g
```

```bash
$ galbe dev index.js -p 7357 -w
🏗️  Constructing routes

    [GET]     /example

done

🚀 Server running at http://localhost:7357
```

## build

Bundle your Galbe application.

#### Arguments

| Name  | Description                                               |
| ----- | --------------------------------------------------------- |
| index | The js or ts file that exports your Galbe server instance. |

#### Options

| Short | Long      | Description                       | Default  |
| ----- | --------- | --------------------------------- | -------- |
| -o    | --out     | output directory                  | dist/app |
| -C    | --compile | create a standalone executable    | false    |
| -c    | --config  | extra Bun build config (js or ts) |          |

#### Example

index.js
```js
import { Galbe } from 'galbe'

export default new Galbe()
```

```bash
$ galbe build index.js
```

## generate

Generate resources around your Galbe application.

### client

Generate a type-aware HTTP client for your Galbe application.

#### Arguments

| Name  | Description                                                |
| ----- | ---------------------------------------------------------- |
| index | The js or ts file that exports your Galbe server instance. |

#### Options

| Short | Long     | Description              | Default                       |
| ----- | -------- | ------------------------ | ----------------------------- |
| -o    | --out    | output file              | dist/(client.ts \| client.js) |
| -t    | --target | build target [ts, js]    | ts                            |
| -c    | --config | config file (.ts or .js) |                               |

#### Example

Let's first setup a new Galbe project:

```bash
$ bun create galbe galbe-example --template hello --lang ts
$ cd galbe-example
$ bun install
```

To generate a JS or TS client of that application, you can run:

```bash
$ galbe generate client index.ts
```

This generates `dist/client.ts` by default. The generator prints every method it creates and flags auto-derived names (routes without an explicit `operationId`):

```
💻 Building Galbe client

    + hello        (explicit operationId)
    ~ get-ping     (auto-derived)

  ! 1 auto-derived operationId(s) — add explicit operationIds to stabilise names
```

#### API

The generated client exposes three layers:

**Primary (simple, throws on error)**

```ts
import { Client } from './dist/client'

const client = new Client({ server: { url: 'http://localhost:3000' } })

// Awaiting resolves to the typed body directly.
// Throws GalbeClientError on non-2xx.
const users = await client.listUsers({ query: { page: 1 } })
```

**`.safe()` (typed errors, no try/catch)**

```ts
const result = await client.createUser({ name: 'Alice' }).safe()

if (result.ok) {
  console.log(result.data)         // typed as the 200 schema
} else if (result.error.status === 400) {
  console.log(result.error.body)   // typed from the 400 schema
}
```

**`$raw` (full response, streaming, headers)**

```ts
const resp = await client.$raw.getUser('abc')

if (resp.status === 200) {
  const user = await resp.body.json()   // typed from 200 schema
  const reqId = resp.headers.get('x-request-id')
} else {
  const err = await resp.body.json()    // typed from error schema
}
```

**`GalbeClientError`** (thrown by the primary API) carries `.status`, `.headers`, and `.body` (pre-consumed as text).

#### Multiple body content-types

When a route accepts more than one content-type, the generator creates a separate method per content-type:

```ts
// POST /users accepts both application/json and application/x-www-form-urlencoded
client.createUserJson({ name: 'Alice' })
client.createUserUrlForm({ name: 'Alice' })
```

#### Runtime config

```ts
new Client({
  server:  { url: 'http://localhost:3000' },
  headers: { 'x-api-key': 'secret' },        // default headers on every request
  fetch:   myCustomFetch,                     // override fetch (interceptors, mocking, retry)
})
```

#### Config file

Pass `--config <file>` to customise what is generated. The file can export two named values:

- **`transform`** — receives `GalbeClientRoute[]` (all routes, pre-split by content-type) and returns the modified array. Runs after plugin hooks.
- **`options`** — generation-time options baked into the generated output.

```ts
// client.config.ts
import type { GalbeClientRoute, GalbeClientOptions } from 'galbe/extras'

export const transform = (routes: GalbeClientRoute[]): GalbeClientRoute[] =>
  routes
    .filter(r => !r.tags.includes('internal'))
    .map(r => ({ ...r, operationId: r.operationId.replace(/^get-/, '') }))

export const options: GalbeClientOptions = {
  className: 'MyAppClient',
}
```

```bash
$ galbe generate client index.ts --config client.config.ts
```

### cli

Generate a CLI for your Galbe application. Commands are derived from your routes and grouped by their tags.

#### Arguments

| Name  | Description                                               |
| ----- | --------------------------------------------------------- |
| index | The js or ts file that exports your Galbe server instance. |

#### Options

| Short | Long     | Description                           | Default                              |
| ----- | -------- | ------------------------------------- | ------------------------------------ |
| -o    | --out    | output file                           | dist/cli (standalone) \| dist/cli.ts (module) |
| -t    | --target | CLI target [cac]                      | cac                                  |
| -m    | --mode   | output mode [standalone, module]      | standalone                           |
| -c    | --config | config file (.ts or .js)              |                                      |

#### Standalone mode

Compiles a self-contained binary. Routes with the same tag are grouped under a sub-command; untagged routes appear at the root level.

```bash
$ galbe generate cli index.ts
```

This generates a `dist/cli` binary. Given a route tagged `users`:

```bash
$ ./dist/cli --help
galbe-example/0.1.0

Usage:
  $ galbe-example <command> [options]

Commands:
  users   users commands

Options:
  -h, --help     Display this message
  -v, --version  Display version number
```

```bash
$ ./dist/cli users --help
galbe-example/0.1.0

Usage:
  $ galbe-example users <command> [options]

Commands:
  list          List all users
  get <id>      Get user by ID

Options:
  -h, --help    Display this message
```

```bash
$ ./dist/cli users get abc123
200
{"id":"abc123","name":"Alice"}
```

> [!IMPORTANT]
> A `GCLI_SERVER_URL` environment variable must be defined. It should point to the URL of the Galbe server you want to target.

Each command exposes the following built-in options for controlling the request and response:

| Short | Long        | Description                                       | Default |
| ----- | ----------- | ------------------------------------------------- | ------- |
| -H    | --header    | extra request header as `name=value` (repeatable) | []      |
| -Q    | --query     | extra query param as `name=value` (repeatable)    | []      |
| -b    | --body      | request body string                               |         |
| -B    | --body-file | path to a file used as request body               |         |

The default response output shows status, body, and pretty-prints JSON. To customise this behaviour, use `responseFormatter` in your [config file](#config-file).

#### Module mode

Generates a `.ts` (or `.js`) module that exports a `register` function. The caller owns the `cac` instance and calls `.parse()` themselves.

```bash
$ galbe generate cli index.ts --mode module --out src/api-cli.ts
```

src/api-cli.ts is generated. You use it like this:

```ts
import cac from 'cac'
import { register } from './src/api-cli'

const cli = cac('myapp')
register(cli)
cli.help()
cli.parse()
```

You can also override runtime options:

```ts
register(cli, {
  baseUrl: () => process.env.API_URL ?? 'http://localhost:3000',
  headers: { 'x-api-key': 'secret' },
  responseFormatter: async res => `[${res.status}] ${await res.text()}\n`,
})
```

#### Config file

Pass `--config <file>` to customise commands and set baked-in defaults. The file can export two named values:

- **`transform`** — a function that receives the generated `GalbeCLICommand[]` and returns the modified array. Runs after plugin hooks.
- **`options`** — an object with request/response defaults baked into the generated output.

```ts
// cli.config.ts
import type { GalbeCLICommand, GalbeCLIOptions } from 'galbe/extras'

export const transform = (commands: GalbeCLICommand[]): GalbeCLICommand[] =>
  commands
    .filter(c => !c.tags.includes('internal'))
    .map(c => ({ ...c, name: c.name.replace(/^get-/, '') }))

export const options: GalbeCLIOptions = {
  baseUrl: () => process.env.API_URL ?? 'http://localhost:3000',
  headers: { 'x-api-key': process.env.API_KEY ?? '' },
  requestInterceptor: async req => {
    req.headers.set('x-request-id', crypto.randomUUID())
    return req
  },
  responseFormatter: async res => {
    const body = res.headers.get('content-type')?.includes('application/json')
      ? JSON.stringify(await res.json(), null, 2)
      : await res.text()
    return `${res.status}\n${body}\n`
  },
}
```

```bash
$ galbe generate cli index.ts --config cli.config.ts
```

### spec

Generate the spec of your Galbe application.

#### Arguments

| Name  | Description                                               |
| ----- | --------------------------------------------------------- |
| index | The js or ts file that exports your Galbe server instance. |

#### Options

| Short | Long     | Description                                      | Default                 |
| ----- | -------- | ------------------------------------------------ | ----------------------- |
| -t    | --target | spec target [openapi:3.0:json, openapi:3.0:yaml] | openapi:3.0:yaml        |
| -b    | --base   | base spec file                                   |                         |
| -o    | --out    | output file                                      | spec/api.(yaml \| json) |

#### Example

Let's try to generate the spec of the project defined in the previous client section. You can then run:

```bash
$ galbe generate spec index.ts
```

This should generate the following `spec/api.yaml` file:

```yaml
openapi: 3.0.3
info:
  title: galbe-app
  version: 0.1.0
paths:
  /hello/{name}:
    get:
      summary: Greeting endpoint
      operationId: hello
      parameters:
        - name: age
          in: query
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: OK
          content:
            text/plain:
              schema:
                type: string
```

### code

Generate the code and project structure from a spec.

The command is **non-destructive**: re-running it on an existing project diffs the spec against the routes already in `src/routes/**` and surgically updates them. Schema definitions and route metadata (JSDoc, schema arg) are refreshed, but your handler bodies and hooks are preserved verbatim. Routes that exist in code but are absent from the new spec are reported as **stale** and require an explicit decision before the command will write anything.

#### Arguments

| Name  | Description                                                |
| ----- | ---------------------------------------------------------- |
| input | The input spec file from which the code will be generated. |

#### Options

| Short | Long             | Description                                                                     | Default                    |
| ----- | ---------------- | ------------------------------------------------------------------------------- | -------------------------- |
| -f    | --format         | input format [openapi:3.0:yaml, openapi:3.0:json]                               | openapi:3.0:(yaml \| json) |
| -t    | --target         | source target [ts, js]                                                          | ts                         |
| -o    | --out            | output dir                                                                      | src                        |
| -n    | --dry-run        | show planned changes without writing                                            | false                      |
|       | --remove-stale   | delete routes present in code but absent from the spec                          | false                      |
|       | --rename         | `"OLD=NEW"` — preserve handler when a route id changes (repeatable)             |                            |
|       | --ignore-route   | `"METHOD /path"` — leave a stale route alone, treat as user-managed (repeatable) |                            |

#### How re-generation handles each route

| Situation                                            | Action                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| In spec, not in code                                 | Added — fresh stub appended to the route file.                                                  |
| In spec, in code (same `METHOD path`)                | Updated — JSDoc + schema argument refreshed; handler body and hook array left untouched.        |
| In code, not in spec                                 | Stale — command exits with the list and prompts for `--rename`, `--ignore-route`, or `--remove-stale`. |
| In code, with `--rename "OLD=NEW"`                   | Treated as an update of `NEW`. Handler preserved; path string and schema arg rewired.           |
| In code, with `--ignore-route "METHOD /path"`        | Left alone, including its schema import.                                                        |
| In code, with `--remove-stale`                       | Deleted; unused schema imports pruned.                                                          |

User-added imports, helpers, and other top-level statements in route files are preserved.

#### Stale-route prompt

If you change the spec to drop a route, the next run will refuse to write and print:

```bash
$ galbe generate code petstore.spec.json
The following routes exist in code but are not in the spec:
  - DELETE /pet/:petId  (scope: /pet)

Re-run with one of:
  --rename "OLD=NEW"          treat as a rename, preserve handler
  --ignore-route "ROUTE"      leave alone, keep as user-managed
  --remove-stale              confirm deletion of stale routes
```

Use `--dry-run` at any point to preview the diff without touching the filesystem.

#### Example

For that example, we will generate the Galbe source code from the [Swagger Petstore Openapi spec](https://petstore3.swagger.io/).

First, initiate a new bun project and install the galbe dependency.

```bash
$ mkdir petstore && cd petstore
$ bun init && bun add galbe
```

Now modify the `index.ts` file with the following content:

```ts
import { Galbe } from 'galbe'

export default new Galbe()
```

Then download the petstore json spec from Swagger website into `petstore.spec.json`:

```bash
$ curl -o petstore.spec.json https://petstore3.swagger.io/api/v3/openapi.json
```

You can now generate the sources from the petstore spec:

```bash
$ galbe generate code petstore.spec.json
```

This should generate the code of our application in the `src` directory by default.

To test that the code was successfully generated, you can run:

```bash
$ galbe dev index.ts
🏗️  Constructing routes

    src/routes/pet.route.ts
    [PUT]     /pet                     Update an existing pet
    [POST]    /pet                     Add a new pet to the store
    [GET]     /pet/findByStatus        Finds Pets by status
    [GET]     /pet/findByTags          Finds Pets by tags
    [GET]     /pet/:petId              Find pet by ID
    [POST]    /pet/:petId              Updates a pet in the store with form data
    [DELETE]  /pet/:petId              Deletes a pet
    [POST]    /pet/:petId/uploadImage  uploads an image

    src/routes/store.route.ts
    [GET]     /store/inventory       Returns pet inventories by status
    [POST]    /store/order           Place an order for a pet
    [GET]     /store/order/:orderId  Find purchase order by ID
    [DELETE]  /store/order/:orderId  Delete purchase order by ID

    src/routes/user.route.ts
    [POST]    /user                 Create user
    [POST]    /user/createWithList  Creates list of users with given input array
    [GET]     /user/login           Logs user into the system
    [GET]     /user/logout          Logs out current logged in user session
    [GET]     /user/:username       Get user by user name
    [PUT]     /user/:username       Update user
    [DELETE]  /user/:username       Delete user

done

🚀 Server running at http://localhost:3000
```

### model

Generate TypeScript types from a database schema.

#### Options

| Short | Long     | Description                                                    | Default     |
| ----- | -------- | -------------------------------------------------------------- | ----------- |
| -u    | --url    | database connection url (e.g. `postgres://user:pwd@host:port`) | _required_  |
| -t    | --table  | table name (e.g. `users` or `public.users`)                    | _all tables_|
| -s    | --schema | schema name                                                    | `public`    |
| -o    | --out    | output file (`.ts`) or directory                               | `.`         |
| -F    | --force  | force overriding output                                        | false       |

#### Example

```bash
$ galbe generate model -u postgres://postgres:secret@localhost:5432/app -o src/models.ts
```

If `--out` is a directory, one file per table is created (`<tableName>.ts`). If it ends in `.ts`, all generated types are written to a single file.

## info

Print information about the current OS, Bun, and Galbe versions.

#### Example

```bash
$ galbe info
OS
  name: Linux
  arch: x64
  version: 6.8.0-110-generic
Bun
  version: 1.1.34
  revision: ...
Galbe
  version: 0.x.y
```
