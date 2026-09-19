# Middlewares

`galbe/middlewares` ships the cross-cutting hooks most applications end up rewriting. Each one is a plain [Middleware Definition](../concepts/middleware.md#declaring-middleware): it carries its hooks, the [request contract](../concepts/middleware.md#request-contract) they impose and the [security metadata](../concepts/middleware.md#security) they enforce, so registering one is a single line and the generated spec, client and CLI see the auth it adds.

```ts
import { jwt } from 'galbe/middlewares'

galbe.middleware('/api/*', jwt({ publicKey: Bun.env.JWT_SECRET! }))
```

Being definitions, they are accepted everywhere a hook is:

```ts
galbe.middleware(def)                    // every route
galbe.middleware('/api/*', def)          // a subtree
galbe.group('/v1', def, g => { ... })    // a group — and the fragment types its routes
export default def                       // src/api/auth.middleware.ts — the directory is the scope
```

Every middleware is also importable on its own path, for apps that would rather not load the whole set:

```ts
import { jwt } from 'galbe/middlewares/jwt'
```

## Authentication

Four middlewares check a credential: [`jwt`](#jwt) for signed tokens, [`bearer`](#bearer) for opaque ones, [`apiKey`](#apikey) for a named key, [`basicAuth`](#basicauth) for HTTP Basic. They differ only in what they read and how they check it — everything below holds for all four.

**They reject before the request is read.** Each runs in the [`beforeParse`](../concepts/middleware.md#before-parsing) slot, so an unauthenticated request is answered **401 before its body is parsed or validated** — never a 400 that would first leak the shape of your schema.

**The reason never reaches the client.** A rejection is a bare `401` with the scheme's `WWW-Authenticate` challenge, if it has one. Why it failed stays server-side, in an `AuthError` carrying a `code`:

| Code        | Meaning                                 |
| ----------- | --------------------------------------- |
| `missing`   | No credential in the request.           |
| `malformed` | A credential that could not be read.    |
| `invalid`   | A credential that was read and refused. |

`jwt` throws the `JwtError` subclass, whose code is finer-grained — see [its rejections](#rejections).

**`errorHandler` takes it from there**, with the pre-parse context:

```ts
bearer({
  token: Bun.env.API_TOKEN!,
  errorHandler: (error, ctx) => {
    log.warn({ code: error.code, path: ctx.route?.path })
    return new Response('Nope', { status: 401 })
  },
})
```

- Returning a `Response` answers the request.
- Returning **nothing** lets the request through **unauthenticated** — this is how optional authentication is expressed. Handlers must then treat the state key as possibly undefined.
- Throwing takes the usual [Error Handler](../concepts/error-handler.md) path.

Errors that are not rejections — an unusable key, a `verify` that throws — are never flattened into a `401`: they surface as `500`s, as any other server-side fault.

**Configured secrets are compared in constant time.** Both sides are reduced to a SHA-256 digest first, so the comparison runs over a fixed 32 bytes and every candidate is checked: neither the length of the secret nor the position of the first differing byte is observable through timing. `basicAuth` matches the whole `user:password` pair at once, so an unknown username is indistinguishable from a wrong password.

**Each declares what it reads and the scheme that owns it.** The credential becomes an optional parameter in the schema of every matched route — validated at runtime, visible to `generate client` and `generate cli` — and the security scheme that owns it documents it as auth rather than as a plain parameter. Every middleware takes a `securityScheme` option: a name (two instances in one app must not share one) or `false` to emit no security metadata at all.

**Identity lands on `ctx.state`**, under a key named after the middleware (`jwtPayload`, `bearer`, `apiKey`, `basicAuth`), or under whatever `stateHolder` names.

## jwt

Verifies a JSON Web Token and puts its payload on `ctx.state`. Verification runs on `crypto.subtle` — no dependency is added to your app — and covers the `HS`, `RS` and `ES` algorithm families.

```ts
import { jwt } from 'galbe/middlewares'

galbe.middleware(
  '/api/*',
  jwt({
    publicKey: await Bun.file('public.pem').text(),
    issuer: 'https://auth.example.com',
    audience: 'my-api',
  })
)

galbe.get('/api/me', ctx => ctx.state.jwtPayload.sub)
```

The hook runs in the [`beforeParse`](../concepts/middleware.md#before-parsing) slot, so an unauthenticated request is answered **401 before its body is read** — never a 400 that would first leak the shape of your schema.

> [!NOTE]
> The middleware verifies, it never issues. Tokens are signed with [`signJwt`](#signing), which is a separate export precisely so a private key never sits on the verification path.

### Configuration

| Name             | Type                                                             | Default           | Description                                                                                                         |
| ---------------- | ---------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `publicKey`      | `string \| Uint8Array \| ArrayBuffer \| JsonWebKey \| CryptoKey` | _required_        | The verification key. See [Keys and algorithms](#keys-and-algorithms).                                              |
| `algorithms`     | `JwtAlgorithm[]`                                                 | key's family      | Narrows the algorithms accepted. `HS256`/`384`/`512`, `RS256`/`384`/`512`, `ES256`/`384`/`512`.                     |
| `sources`        | `('bearer' \| 'cookie:<name>')[]`                                | `['bearer']`      | Where the token is read from, in order. See [Sources](#sources).                                                    |
| `stateHolder`    | `string`                                                         | `'jwtPayload'`    | `ctx.state` key the verified payload is stored under.                                                               |
| `issuer`         | `string \| string[]`                                             |                   | Required `iss` claim — one value, or a list of accepted ones.                                                       |
| `audience`       | `string \| string[]`                                             |                   | Required `aud` claim: at least one of these must match the token's audience.                                        |
| `subject`        | `string`                                                         |                   | Required `sub` claim.                                                                                               |
| `clockTolerance` | `number`                                                         | `0`               | Seconds of clock skew tolerated on `exp` and `nbf`.                                                                 |
| `validate`       | `(payload, ctx) => boolean \| Promise<boolean>`                  |                   | Extra check run after the standard claims. Returning `false` rejects the request.                                   |
| `errorHandler`   | `(error, ctx) => Response \| void \| Promise<Response \| void>`  |                   | Replaces the default rejection. See [Rejections](#rejections).                                                      |
| `securityScheme` | `string \| false`                                                | scheme per source | Renames the OpenAPI security scheme contributed, or opts out of security metadata. See [Spec output](#spec-output). |

`exp` and `nbf` are always checked when present; `iss`, `aud` and `sub` only when the matching option is set.

### Keys and algorithms

`publicKey` accepts every form a key comes in, and is imported once, lazily, on the first request:

| Form                                                 | Algorithms                  |
| ---------------------------------------------------- | --------------------------- |
| A secret `string` or raw bytes                       | `HS256/384/512`             |
| A PEM-encoded `SPKI` public key (`BEGIN PUBLIC KEY`) | `RS*` or `ES*`, per the key |
| A JWK (`JsonWebKey`)                                 | from `alg`, or `kty`/`crv`  |
| An imported `CryptoKey`                              | the key's own algorithm     |

**The key decides which algorithms are acceptable, never the token.** A token's `alg` header is attacker-controlled: the classic attack re-signs a token with `HS256` using your RSA _public_ key as the HMAC secret, and passes on any verifier that trusts that header. Here the key's family is resolved first, and a token whose `alg` falls outside it is rejected — `alg: none` included, which is never accepted. `algorithms` narrows the set further, when only one algorithm should ever be seen:

```ts
jwt({ publicKey: pem, algorithms: ['ES256'] })
```

### Sources

```ts
jwt({ publicKey, sources: ['bearer', 'cookie:session'] })
```

- `'bearer'` reads `Authorization: Bearer <token>`.
- `'cookie:<name>'` reads the named cookie.

Sources are tried in order and the first one that carries a token wins — a request that fails to verify is not retried against the next source. Any other value is a `SyntaxError` at registration.

### Rejections

Every failure answers `401` with a `WWW-Authenticate: Bearer` challenge when the bearer source is enabled, on the [shared contract](#authentication). `JwtError` refines the three common codes with everything specific to a signed token:

`missing`, `malformed`, `algorithm`, `signature`, `expired`, `immature`, `issuer`, `audience`, `subject`, `invalid` (the code `validate` returning `false` produces).

### Spec output

A bearer-sourced instance merges an optional `authorization` header (`format: JWT`) into the schema of every route it matches, and declares the scheme that enforces it:

```yaml
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
paths:
  /api/me:
    get:
      security: [{ bearerAuth: [] }]
```

The scheme owns the credential, so the header is documented as auth and not as a plain parameter. A cookie source contributes `{ type: apiKey, in: cookie, name: <cookie> }` instead, and with several sources each scheme becomes an alternative (`security: [{ bearerAuth: [] }, { cookieAuth: [] }]`).

Schemes are named `bearerAuth` and `cookieAuth` by default. Two instances in one app must not share a name — rename with `securityScheme`:

```ts
galbe.middleware('/users/*', jwt({ publicKey: userKey, securityScheme: 'userAuth' }))
galbe.middleware('/admin/*', jwt({ publicKey: adminKey, securityScheme: 'adminAuth' }))
```

`securityScheme: false` emits no security metadata at all, for apps that declare their schemes in [`config.openapi`](configuration.md#openapi).

### Signing

`signJwt` issues the tokens `jwt` verifies, on `crypto.subtle` and with the same key forms:

```ts
import { signJwt } from 'galbe/middlewares'

galbe.post('/login', async ctx => {
  const user = await authenticate(ctx.body)
  return {
    token: await signJwt({ sub: user.id, role: user.role }, Bun.env.JWT_SECRET!, {
      expiresIn: 3600,
      issuer: 'https://auth.example.com',
    }),
  }
})
```

```ts
signJwt(payload: JwtPayload, privateKey: JwtKey, options?: JwtSignOptions): Promise<string>
```

| Option      | Type                  | Description                                                                                |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `algorithm` | `JwtAlgorithm`        | Algorithm to sign with. Defaults to the key's own: `HS256`, `RS256`, or the curve's `ES*`. |
| `expiresIn` | `number`              | Lifetime in seconds, from now: sets `exp`.                                                 |
| `notBefore` | `number`              | Delay in seconds, from now, before the token is valid: sets `nbf`.                         |
| `issuer`    | `string`              | Sets `iss`.                                                                                |
| `audience`  | `string \| string[]`  | Sets `aud`.                                                                                |
| `subject`   | `string`              | Sets `sub`.                                                                                |
| `header`    | `Record<string, any>` | Extra JOSE header fields — `kid`, typically. `alg` is always the one actually signed with. |

- `iat` is set automatically, and a claim written in `payload` always wins over the option that would have set it.
- The private key is a PKCS#8 PEM (`BEGIN PRIVATE KEY`), a JWK, an HMAC secret or a `CryptoKey`. PKCS#1 and SEC1 PEMs (`BEGIN RSA PRIVATE KEY`, `BEGIN EC PRIVATE KEY`) are not importable by WebCrypto — convert them with `openssl pkcs8 -topk8`.
- Every key form other than a `CryptoKey` is imported on each call. On a hot path, import once with `crypto.subtle.importKey(...)` and pass the result.

### Out of scope

Anything JWKS-related (remote key sets, rotation, `kid` selection), encrypted tokens (JWE) and exotic algorithms are deliberately absent: they need a dependency, and a dependency belongs in a [Plugin](../concepts/plugins.md), not in the framework.

## bearer

Checks the `Authorization: Bearer` token against a constant, or against whatever `verify` looks it up in. This is the **opaque token** middleware — for tokens carrying their own signature, use [`jwt`](#jwt), which verifies rather than looks up.

```ts
import { bearer } from 'galbe/middlewares'

// a shared secret, straight from the environment
galbe.middleware('/hooks/*', bearer({ token: Bun.env.WEBHOOK_TOKEN! }))

// looked up, with the identity carried to the handlers
galbe.middleware('/api/*', bearer({ verify: async token => (await db.session(token)) ?? false }))

galbe.get('/api/me', ctx => ctx.state.bearer.userId)
```

| Name             | Type                                | Default        | Description                                                                                  |
| ---------------- | ----------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `token`          | `string \| string[]`                |                | Accepted token(s), compared in constant time. Either this or `verify` is required.           |
| `verify`         | `(token, ctx) => boolean \| object` |                | Looks the token up instead. `false` rejects, `true` accepts, an object becomes the identity. |
| `stateHolder`    | `string`                            | `'bearer'`     | `ctx.state` key the identity is stored under.                                                |
| `realm`          | `string`                            |                | Protection space named in the challenge.                                                     |
| `format`         | `string`                            |                | Documentation only: the `bearerFormat` of the emitted scheme.                                |
| `errorHandler`   | `(error, ctx) => Response \| void`  |                | See [Authentication](#authentication).                                                       |
| `securityScheme` | `string \| false`                   | `'bearerAuth'` | Renames the contributed scheme, or opts out.                                                 |

When both are given, `verify` decides. The scheme name is matched case-insensitively, as HTTP requires, and the emitted scheme is `{ type: http, scheme: bearer }`.

## apiKey

Checks a named API key — a header by default, optionally a query parameter or a cookie.

```ts
import { apiKey } from 'galbe/middlewares'

// the default: an x-api-key header, checked against a constant
galbe.middleware('/api/*', apiKey({ key: Bun.env.API_KEY! }))

// a named header, looked up, with the tenant carried to the handlers
galbe.middleware('/v1/*', apiKey({ name: 'x-tenant-key', verify: async key => (await db.tenantByKey(key)) ?? false }))

galbe.get('/v1/usage', ctx => ctx.state.apiKey.tenantId)
```

| Name             | Type                               | Default        | Description                                                                                |
| ---------------- | ---------------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `key`            | `string \| string[]`               |                | Accepted key(s), compared in constant time. Either this or `verify` is required.           |
| `verify`         | `(key, ctx) => boolean \| object`  |                | Looks the key up instead. `false` rejects, `true` accepts, an object becomes the identity. |
| `in`             | `'header' \| 'query' \| 'cookie'`  | `'header'`     | Where the key travels.                                                                     |
| `name`           | `string`                           | `'x-api-key'`  | Name of the header, query parameter or cookie carrying it.                                 |
| `stateHolder`    | `string`                           | `'apiKey'`     | `ctx.state` key the identity is stored under.                                              |
| `errorHandler`   | `(error, ctx) => Response \| void` |                | See [Authentication](#authentication).                                                     |
| `securityScheme` | `string \| false`                  | `'apiKeyAuth'` | Renames the contributed scheme, or opts out.                                               |

- A rejection carries **no `WWW-Authenticate` challenge**: the `apiKey` scheme has no registered one.
- A **query** key is supported because OpenAPI describes it, but it lands in access logs, proxy traces and `Referer` headers — prefer a header wherever you control the caller. It is read from the raw URL, since the parsed query does not exist yet at `beforeParse`.
- A **cookie** key contributes no schema fragment — a middleware fragment covers headers, query and params — so only the security scheme documents it.

## basicAuth

HTTP Basic authentication ([RFC 7617](https://www.rfc-editor.org/rfc/rfc7617)): decodes `Authorization: Basic` and checks the credentials against a `{ user: password }` map or `verify`.

```ts
import { basicAuth } from 'galbe/middlewares'

// a machine account from the environment
galbe.middleware('/metrics/*', basicAuth({ users: { prometheus: Bun.env.METRICS_PASSWORD! }, realm: 'metrics' }))

// checked against stored hashes, with the account carried to the handlers
galbe.middleware(
  '/admin/*',
  basicAuth({
    verify: async (user, password) => {
      const account = await db.user(user)
      return account && (await Bun.password.verify(password, account.hash)) ? account : false
    },
  })
)

galbe.get('/admin/me', ctx => ctx.state.basicAuth.email)
```

| Name             | Type                                         | Default        | Description                                                                                |
| ---------------- | -------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `users`          | `Record<string, string>`                     |                | Accepted `{ user: password }` pairs, matched in constant time. Either this or `verify`.    |
| `verify`         | `(user, password, ctx) => boolean \| object` |                | Checks the credentials itself. `false` rejects, `true` accepts, an object is the identity. |
| `realm`          | `string`                                     | `'Restricted'` | Protection space named in the challenge — what browsers show when prompting.               |
| `stateHolder`    | `string`                                     | `'basicAuth'`  | `ctx.state` key the identity is stored under. Defaults to the username.                    |
| `errorHandler`   | `(error, ctx) => Response \| void`           |                | See [Authentication](#authentication).                                                     |
| `securityScheme` | `string \| false`                            | `'basicAuth'`  | Renames the contributed scheme, or opts out.                                               |

- The challenge is `Basic realm="<realm>", charset="UTF-8"`, and credentials are decoded as UTF-8 accordingly.
- The password is everything after the **first** colon, so passwords may contain colons; usernames may not.
- `users` keeps passwords in memory in clear — the right shape for a handful of machine accounts from the environment, not for real user accounts. Basic also sends the password on every request, protected by nothing but TLS: fine for internal tooling, but reach for `jwt` or `bearer` for anything user-facing.

## rateLimit

Caps how often one client may call the routes it covers. Every key gets `limit` tokens, refilled smoothly over `window` seconds; a request spends one, and a request that finds none is answered `429` with a `Retry-After`. Spending them all at once is allowed — the burst a client may take is the limit itself.

```ts
import { rateLimit } from 'galbe/middlewares'

// 100 requests per minute per client, everywhere
galbe.middleware(rateLimit({ limit: 100, window: 60 }))

// a tighter bucket on top, for one subtree
galbe.middleware('/auth/*', rateLimit({ limit: 5, window: 60 }))

// per account rather than per address, with signed-in users exempt from it
galbe.middleware('/api/*', rateLimit({ limit: 1000, window: 3600, key: ctx => ctx.state.apiKey?.accountId }))
```

| Name           | Type                              | Default             | Description                                                            |
| -------------- | --------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| `limit`        | `number`                          |                     | Requests allowed per window, and the burst a client may spend at once. |
| `window`       | `number`                          |                     | Seconds the bucket takes to refill completely. Fractions allowed.      |
| `key`          | `ctx => string \| undefined`      | `ctx.clientAddress` | Bucket a request is accounted to. Returning nothing exempts it.        |
| `maxKeys`      | `number`                          | `10000`             | Maximum number of buckets held in memory.                              |
| `headers`      | `boolean`                         | `true`              | Emit the `RateLimit-*` response headers.                               |
| `errorHandler` | `(info, ctx) => Response \| void` |                     | Replaces the `429`. Returning nothing lets the request through.        |

It runs in the [`beforeParse`](../concepts/middleware.md#before-parsing) slot, so a throttled request is refused before its body is read. Each call to `rateLimit()` is its own limiter with its own counters, so the two registrations above compose: a request to `/auth/login` spends a token from both.

Every response carries the state of the bucket, and a refused one also says how long to wait:

```http
RateLimit-Limit: 100
RateLimit-Remaining: 87
RateLimit-Reset: 8
Retry-After: 12
```

`RateLimit-Reset` counts the seconds until the bucket is full again, `Retry-After` the seconds until one token is back — at least `1`, since HTTP counts in whole seconds. Both are absent when `headers` is `false`, except `Retry-After`, which a `429` always carries.

### Keys

The default key is [`ctx.clientAddress`](../concepts/context.md#clientaddress), so **behind a proxy you must set [`trustProxy`](configuration.md#trustproxy)** — otherwise every client shares the proxy's address, and one caller's flood throttles everyone. A key function returning `undefined` exempts the request, which is how an allow-list or an authenticated tier opts out:

```ts
rateLimit({
  limit: 60,
  window: 60,
  key: ctx => (ctx.state.jwtPayload ? undefined : ctx.clientAddress),
})
```

### What it does not do

- **Counters live in this process's memory.** Each replica of your app enforces the limit on its own, so `n` replicas mean `n` × `limit`. A limit shared across replicas needs a store they all see — a plugin, not a middleware.
- **It only covers routed paths.** A flood against URLs matching no route is answered `404` without ever reaching a middleware. So is a preflight `OPTIONS`.
- **The store is bounded**, at `maxKeys` buckets. Past that, refilled buckets are dropped first and then the oldest one — so a flood of distinct keys costs memory it cannot exceed, but can also push out a bucket that was still being enforced. Raise `maxKeys` if you legitimately serve more concurrent clients than the default.

None of these is a reason to skip it — a limiter in the app is the one that knows about accounts and routes — but a public-facing service wants one at the edge as well.

## Observability

Three middlewares carry no policy of their own: [`requestId`](#requestid) names a request, [`logger`](#logger) reports it, [`timing`](#timing) says how long it took.

Two of them wrap the hook chain, which is what lets them report the status a request ended on — and also bounds what they see. A request rejected **before** the chain — a `400` from [validation](../concepts/schemas.md), or a rejection from a [`beforeParse`](../concepts/middleware.md#before-parsing) middleware like [`jwt`](#jwt) or [`rateLimit`](#ratelimit) — is answered earlier, and a request matching no route never reaches a middleware at all. An access log covering _every_ request belongs in a [Plugin](../concepts/plugins.md)'s `onFetch`. `requestId` is the exception: it runs in the `beforeParse` slot precisely so that rejected requests are named too.

## requestId

Gives every request an id — the caller's when it sent a usable one, a fresh UUID otherwise — puts it on `ctx.state.requestId` and echoes it in the response header.

```ts
import { requestId } from 'galbe/middlewares'

galbe.middleware(requestId())

galbe.get('/orders', ctx => {
  log.info({ id: ctx.state.requestId }, 'listing orders')
  return orders()
})
```

| Name          | Type           | Default             | Description                                     |
| ------------- | -------------- | ------------------- | ----------------------------------------------- |
| `header`      | `string`       | `'x-request-id'`    | Header the id travels in, inbound and outbound. |
| `trustHeader` | `boolean`      | `true`              | Reuse a well-formed id sent by the caller.      |
| `generate`    | `() => string` | `crypto.randomUUID` | Makes an id when there is none to reuse.        |
| `stateHolder` | `string`       | `'requestId'`       | `ctx.state` key the id is stored under.         |

- **Register it first.** It runs in the [`beforeParse`](../concepts/middleware.md#before-parsing) slot so the id exists before anything can reject the request: a `400` from validation, or a `401` from an auth middleware registered after it, carries the header too.
- An **inbound id is reused only if it is one**: at most 128 characters of `[A-Za-z0-9_.:-]`, which covers UUIDs, ULIDs, nanoids and W3C trace ids. Anything else is replaced rather than rejected — a malformed trace header is not the caller's request failing, and nothing that could break a header or a log line is ever echoed back.
- On a public API the id is the caller's to choose and yours to distrust: `trustHeader: false` ignores it and always generates.

## logger

Logs one line per request — method, path, status and duration — or hands the same fields to your own logger.

```ts
import { logger } from 'galbe/middlewares'

// a line per request, on the console
galbe.middleware(logger())

// structured, and quiet about the health check
galbe.middleware(logger({ log: entry => log.info(entry), skip: ctx => ctx.route?.path === '/health' }))
```

```
GET /orders/42 200 1.4ms 8f14e45f-ceea-467a-9f1e-2b0a9c1d3e77
```

| Name   | Type                   | Default      | Description                                                  |
| ------ | ---------------------- | ------------ | ------------------------------------------------------------ |
| `log`  | `(entry, ctx) => void` | console line | Receives every finished request instead of the default line. |
| `skip` | `ctx => boolean`       |              | Leaves a request unlogged. Runs once the request is done.    |

The entry holds `method`, `path`, `status`, `duration` in milliseconds, the `requestId` when [`requestId`](#requestid) runs ahead of it, and `error` when the request ended on one.

- **The status is the one the request ended on**, whether it came from the handler, from a hook returning a `Response`, or from a thrown error — a `RequestError` logs its own status, anything else logs `500`. The error still propagates to the [Error Handler](../concepts/error-handler.md); logging it changes nothing.
- **`path` carries no query string**, since a query can hold an API key or a token. `ctx.request.url` has the whole thing when you want it.
- `skip` runs after the request, so it can filter on `ctx.set.status` and keep only the failures.
- The default line is colored only when the output is a terminal, so piped logs stay clean.

## timing

Reports how long the server spent on a request, in the [`Server-Timing`](https://developer.mozilla.org/docs/Web/HTTP/Headers/Server-Timing) header — the number a browser shows in its network panel, and the one a caller cannot measure itself, since its own clock also counts the network.

```ts
import { timing } from 'galbe/middlewares'

galbe.middleware(timing())
// → Server-Timing: total;dur=12.4

galbe.middleware('/api/*', timing({ name: 'api', description: 'handler', precision: 2 }))
// → Server-Timing: api;dur=12.41;desc="handler"
```

| Name          | Type             | Default           | Description                                                 |
| ------------- | ---------------- | ----------------- | ----------------------------------------------------------- |
| `name`        | `string`         | `'total'`         | Name of the measurement. Non-token characters become `-`.   |
| `description` | `string`         |                   | Label shown next to it in a browser's network panel.        |
| `precision`   | `number`         | `1`               | Decimal places kept in the duration. `0` to `6`.            |
| `header`      | `string`         | `'server-timing'` | Response header the measurement is appended to.             |
| `skip`        | `ctx => boolean` |                   | Leaves a request unmeasured. Runs once the request is done. |

- The entry is **appended**, so measurements a route added to the same header survive alongside it:

  ```ts
  galbe.get('/orders', async ctx => {
    const started = performance.now()
    const orders = await db.orders()
    ctx.set.headers['server-timing'] = `db;dur=${(performance.now() - started).toFixed(1)}`
    return orders
  })
  // → Server-Timing: db;dur=8.2, total;dur=9.1
  ```

- The header is public, and so is what it says about your internals. Keep the names generic on a public API, or restrict it to development with `skip`.

## Not included

Session management, CSRF and anything needing persistent storage are out of scope, as is [CORS](../concepts/plugins.md) — preflight requests never reach a middleware, since they match no route. Those belong in a plugin.
