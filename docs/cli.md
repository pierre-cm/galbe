# CLI

A Command Line Interface is shipped with Galbe package. You can use it to perform useful tasks around your application.

After [Installing Galbe](getting-started.md#automatic-installation), the CLI will be available locally to your project.

However, if you want to use it directly from your terminal, you must either:

Install it globally using the following command:

```bash
$ bun install -g galbe
```

Or run it with `bunx`:

```bash
$ bunx galbe
```

## dev

Start a dev server running your Galbe application.

#### Arguments

| Name  | Description                                              |
| ----- | -------------------------------------------------------- |
| index | The js or ts file that export your Galbe server instance. |

#### Options

| Short | Long      | Description                 | Default |
| ----- | --------- | --------------------------- | ------- |
| -p    | --port    | port number [1-65535]       | 3000    |
| -w    | --watch   | watch file changes          | false   |
| -nc   | --noclear | don't clear on file changes | false   |

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
```

## build

Bundle your Galbe application.

#### Arguments

| Name  | Description                                              |
| ----- | -------------------------------------------------------- |
| index | The js or ts file that export your Galbe server instance. |

#### Options

| Short | Long      | Description                    | Default  |
| ----- | --------- | ------------------------------ | -------- |
| -o    | --out     | output directory               | dist/app |
| -C    | --compile | create a standalone executable | false    |
| -c    | --config  | bun config (js or ts)          |          |

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

Generate a client for your Galbe application.

#### Arguments

| Name  | Description                                              |
| ----- | -------------------------------------------------------- |
| index | The js or ts file that export your Galbe server instance. |

#### Options

| Short | Long     | Description                | Default                              |
| ----- | -------- | -------------------------- | ------------------------------------ |
| -o    | --out    | output file                | dist/(client.ts \| client.js \| cli) |
| -t    | --target | build target [ts, js, cli] | ts                                   |

#### Examples

Let's first setup a new Galbe project:

```bash
$ bun create galbe galbe-example --template hello --lang ts
$ cd galbe-example
$ bun install
```

> [!NOTE]
> In order for the following examples to work, you must ensure that an instance of you galbe app is running on port 3000.
> You can do that by running `bun run dev`.

##### JS or TS client

To generate a JS or TS client of that application, you can run the following command:

```bash
$ galbe generate client index.ts
```

This will generate a `dist/client.ts` client lib by default.
You can import it and use it like in the following example:

client_example.ts

```ts
import HelloClient from './dist/client'

const client = new HelloClient({ server: { url: 'http://localhost:3000' } })

const response = await client.hello('Bob', { query: { age: 42 } })
// This is equivalent as calling
// const response = await client.get["/hello/:name"]("Bob", { query: { age: 42 } })

if (response.ok) console.log(await response.body())
// Hello Bob! You're 42 y.o.
```

##### CLI client

To generate a CLI of that application, you can run the following command:

```bash
$ galbe generate client index.ts -t cli
```

This will generate a `cli` binary file under `dist` directory by default.

```bash
$ ./dist/cli --help
Usage: galbe-example [options] [command]

Options:
  -V, --version    output the version number
  -h, --help       display help for command

Commands:
  hello [options]  Greeting endpoint
  help [command]   display help for command
```

```bash
$ ./dist/cli hello --help
Usage: galbe-example hello [options] <name>

Greeting endpoint

Arguments:
  name                        name argument

Options:
  -%f, --%format [string]     response format ['s','h','b','t','p'] (default: ["s","b","p"])
  -%h, --%header <string...>  request header formated as headerName=headerValue (default: [])
  -%q, --%query <string...>   query param formated as paramName=paramValue (default: [])
  -%b, --%body <string>       request body (default: "")
  -%bf, --%bodyFile <path>    request body file (default: "")
  -a, --age <number>
  -h, --help                  display help for command
```

```bash
$ ./dist/cli hello Pierre -a 29
200
Hello Pierre! You're 29 y.o.
```

> [!IMPORTANT]
> A `GCLI_SERVER_URL` environment variable must be defined. It should indicate the url of the Galbe server you want to target.
> In that specific case `http://localhost:3000`.

### spec

Generate the spec of your Galbe application.

#### Arguments

| Name  | Description                                              |
| ----- | -------------------------------------------------------- |
| index | The js or ts file that export your Galbe server instance. |

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

Generate the code and project structure from spec.

#### Arguments

| Name  | Description                                                |
| ----- | ---------------------------------------------------------- |
| input | The input spec file from which the code will be generated. |

#### Options

| Short | Long     | Description                                       | Default                    |
| ----- | -------- | ------------------------------------------------- | -------------------------- |
| -f    | --format | input format [openapi:3.0:yaml, openapi:3.0:json] | openapi:3.0:(yaml \| json) |
| -t    | --target | source target [ts, js]                            | ts                         |
| -o    | --out    | output dir                                        | src                        |
| -F    | --force  | force overriding output                           | false                      |

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
