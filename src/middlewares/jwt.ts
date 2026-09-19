import type { MiddlewareDef, PreParseContext } from '../types'
import type { STOptional, STString } from '../schema'
import type { AuthErrorHandler } from './_auth'

import { $T } from '../index'
import { AuthError, authHook, bearerChallenge, checkRealm, readCredential, securityMetadata } from './_auth'

export { AuthError } from './_auth'

// `none` is deliberately absent, and nothing outside this list is ever accepted.
const ALGORITHMS = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'] as const
/** JWS algorithms verifiable on `crypto.subtle`. */
export type JwtAlgorithm = (typeof ALGORITHMS)[number]
/** A JSON Web Key, structurally — `lib.dom` is not loaded and its `JsonWebKey` with it. */
export type JwtJsonWebKey = { kty?: string; alg?: string; crv?: string } & Record<string, any>
/**
 * Verification key: an HMAC secret (string or bytes), a PEM-encoded SPKI public
 * key, a JWK, or an already imported {@link CryptoKey}.
 */
export type JwtKey = string | Uint8Array | ArrayBuffer | JwtJsonWebKey | CryptoKey
/** Where a token is read from: the `Authorization: Bearer` header, or a named cookie. */
export type JwtSource = 'bearer' | `cookie:${string}`
/** Decoded token payload — registered claims typed, everything else passed through. */
export type JwtPayload = {
  iss?: string
  sub?: string
  aud?: string | string[]
  exp?: number
  nbf?: number
  iat?: number
  jti?: string
} & Record<string, any>
/**
 * Why verification failed — the three {@link AuthError} codes plus everything
 * specific to a signed token. Available to {@link JwtConfig.errorHandler};
 * never sent to the client.
 */
export type JwtErrorCode =
  | 'missing'
  | 'malformed'
  | 'algorithm'
  | 'signature'
  | 'expired'
  | 'immature'
  | 'issuer'
  | 'audience'
  | 'subject'
  | 'invalid'

/** Thrown internally on every rejection, and handed to {@link JwtConfig.errorHandler}. */
export class JwtError extends AuthError<JwtErrorCode> {
  constructor(code: JwtErrorCode, message: string) {
    super(code, message)
    this.name = 'JwtError'
  }
}

export type JwtConfig = {
  /**
   * Key the signature is verified against: the HMAC secret for `HS*`, the
   * public key for `RS*`/`ES*`. Accepts a PEM SPKI string, a JWK, raw bytes or
   * a {@link CryptoKey}. Imported once, on the first request.
   */
  key: JwtKey
  /**
   * Algorithms accepted, narrowing what the key already allows. Defaults to
   * every algorithm of the key's family (`HS256`/`384`/`512` for a secret,
   * `RS*` for an RSA key, the curve's `ES*` for an EC key). A token's own `alg`
   * header never widens this set.
   */
  algorithms?: JwtAlgorithm[]
  /** Where to look for the token, in order. Default `['bearer']`. */
  sources?: JwtSource[]
  /** `ctx.state` key the verified payload is stored under. Default `jwtPayload`. */
  stateHolder?: string
  /**
   * Lets a request carrying **no** token through unauthenticated instead of
   * answering 401 — the public half of a route that personalizes a signed-in
   * caller. A token that is present but fails any check is still rejected.
   */
  optional?: boolean
  /** Required `iss` claim — one value or a list of accepted ones. */
  issuer?: string | string[]
  /** Required `aud` claim: at least one of these must match the token's audience. */
  audience?: string | string[]
  /** Required `sub` claim. */
  subject?: string
  /** Seconds of clock skew tolerated on `exp` and `nbf`. Default `0`. */
  clockTolerance?: number
  /** Extra payload check run after the standard claims. Returning `false` rejects the request. */
  validate?: (payload: JwtPayload, ctx: PreParseContext) => boolean | Promise<boolean>
  /** Protection space named in the `WWW-Authenticate` challenge. Omitted by default. */
  realm?: string
  /**
   * Replaces the default rejection. Return a `Response` to answer the request,
   * or nothing to fall back to the default `401`; throwing takes the usual
   * error handler path. Optional authentication is {@link JwtConfig.optional},
   * not something an error handler expresses.
   */
  errorHandler?: AuthErrorHandler<JwtError>
  /**
   * Name of the OpenAPI security scheme contributed — `bearerAuth` for the
   * bearer source, `cookieAuth` for a cookie one. Rename it when two instances
   * coexist in one app; `false` emits no security metadata at all.
   */
  securityScheme?: string | false
}

/** The header contract a bearer-sourced instance imposes on every route it matches. */
export type JwtFragment = { headers: { authorization: STOptional<STString> } }

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const HASHES = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' } as const
const CURVES = { '256': 'P-256', '384': 'P-384', '512': 'P-521' } as const
const PEM = /-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END/
const family = (alg: JwtAlgorithm) => alg.slice(0, 2) as 'HS' | 'RS' | 'ES'
const bits = (alg: JwtAlgorithm) => alg.slice(2) as keyof typeof HASHES

const b64ToBytes = (b64: string) => {
  const bin = atob(b64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
const b64uToBytes = (b64u: string) => b64ToBytes(b64u.replace(/-/g, '+').replace(/_/g, '/'))
const bytesToB64u = (bytes: Uint8Array) => {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const strToB64u = (str: string) => bytesToB64u(encoder.encode(str))

// The curve is a property of an EC key, the hash a property of the operation;
// for HMAC and RSA both are fixed at import time.
const importParams = (alg: JwtAlgorithm) =>
  family(alg) === 'HS'
    ? { name: 'HMAC', hash: HASHES[bits(alg)] }
    : family(alg) === 'RS'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: HASHES[bits(alg)] }
      : { name: 'ECDSA', namedCurve: CURVES[bits(alg)] }
// what `crypto.subtle.sign`/`verify` take, as opposed to what the import takes
const operationParams = (alg: JwtAlgorithm) =>
  family(alg) === 'ES' ? { name: 'ECDSA', hash: HASHES[bits(alg)] } : importParams(alg)

const isJwk = (key: JwtKey): key is JwtJsonWebKey =>
  typeof key === 'object' && !(key instanceof CryptoKey) && !ArrayBuffer.isView(key) && !(key instanceof ArrayBuffer)

type KeyUsage = 'verify' | 'sign'
const importKey = (key: Exclude<JwtKey, CryptoKey>, alg: JwtAlgorithm, usage: KeyUsage): Promise<CryptoKey> => {
  const params = importParams(alg)
  if (isJwk(key)) return crypto.subtle.importKey('jwk', key, params, false, [usage])
  // an HMAC secret is the raw bytes; an asymmetric key is a DER structure —
  // SPKI for the public half, PKCS#8 for the private one, which is what a PEM
  // label says outright and what the usage implies for bare bytes
  const [, label, body] = typeof key === 'string' ? (key.match(PEM) ?? []) : []
  if (label !== undefined) {
    if (!/^(PUBLIC|PRIVATE) KEY$/.test(label))
      throw new Error(`jwt: unsupported PEM '${label}', expected 'PUBLIC KEY' or 'PRIVATE KEY' (PKCS#8)`)
    return crypto.subtle.importKey(label === 'PRIVATE KEY' ? 'pkcs8' : 'spki', b64ToBytes(body ?? ''), params, false, [
      usage,
    ])
  }
  const der = usage === 'sign' ? 'pkcs8' : 'spki'
  const bytes = typeof key === 'string' ? encoder.encode(key) : key
  return crypto.subtle.importKey(family(alg) === 'HS' ? 'raw' : der, bytes, params, false, [usage])
}

/**
 * Which algorithms the key itself can serve. The `alg` header of an incoming
 * token is attacker-controlled — the key decides what is acceptable, never the
 * token, which is what closes the classic RS256→HS256 confusion.
 */
const keyAlgorithms = async (key: JwtKey, usage: KeyUsage): Promise<JwtAlgorithm[]> => {
  const of = (fam: 'HS' | 'RS', hash?: string) =>
    hash
      ? ([`${fam}${hash.slice(4)}`] as JwtAlgorithm[])
      : (['256', '384', '512'].map(b => `${fam}${b}`) as JwtAlgorithm[])
  const ec = (crv?: string) => [`ES${crv === 'P-384' ? '384' : crv === 'P-521' ? '512' : '256'}`] as JwtAlgorithm[]
  if (key instanceof CryptoKey) {
    const { name } = key.algorithm
    const { hash, namedCurve } = key.algorithm as { hash?: { name?: string }; namedCurve?: string }
    if (name === 'HMAC') return of('HS', hash?.name)
    if (name === 'RSASSA-PKCS1-v1_5') return of('RS', hash?.name)
    if (name === 'ECDSA') return ec(namedCurve)
    throw new Error(`jwt: unsupported key algorithm '${name}'`)
  }
  if (isJwk(key)) {
    if (key.alg) return [key.alg as JwtAlgorithm]
    if (key.kty === 'RSA') return of('RS')
    if (key.kty === 'EC') return ec(key.crv)
    return of('HS')
  }
  // A PEM says nothing about the algorithm, so the platform's key parser
  // answers instead: whichever import succeeds identifies the key's family.
  if (typeof key === 'string' && PEM.test(key)) {
    for (const alg of ['RS256', 'ES256', 'ES384', 'ES512'] as JwtAlgorithm[]) {
      try {
        await importKey(key, alg, usage)
        return family(alg) === 'RS' ? of('RS') : [alg]
      } catch {}
    }
    throw new Error('jwt: the PEM key is not a supported RSA or EC key')
  }
  return of('HS')
}

// Keys and their algorithm set are resolved lazily, then cached per algorithm:
// the middleware factory is synchronous and importing is not.
const keyStore = (key: JwtKey, restrict: JwtAlgorithm[] | undefined, usage: KeyUsage) => {
  const keys = new Map<JwtAlgorithm, Promise<CryptoKey>>()
  let algorithms: Promise<JwtAlgorithm[]> | undefined
  return {
    algorithms: () =>
      (algorithms ??= keyAlgorithms(key, usage).then(detected => {
        // a key can carry an algorithm this middleware does not verify (an
        // HMAC-SHA1 CryptoKey, a JWK with an exotic `alg`): drop those here
        const supported = detected.filter(a => ALGORITHMS.includes(a))
        const algs = restrict ? restrict.filter(a => supported.includes(a)) : supported
        if (!algs.length)
          throw new Error(`jwt: no supported algorithm for the configured key${restrict ? ` among [${restrict}]` : ''}`)
        return algs
      })),
    key: (alg: JwtAlgorithm) => {
      let imported = keys.get(alg)
      if (!imported)
        keys.set(alg, (imported = key instanceof CryptoKey ? Promise.resolve(key) : importKey(key, alg, usage)))
      return imported
    },
  }
}

/**
 * #### jwt
 * Verify-only JWT middleware. Reads a token from the `Authorization: Bearer`
 * header (or a cookie), verifies its signature on `crypto.subtle`, checks the
 * standard claims and puts the payload on `ctx.state.jwtPayload`.
 *
 * It runs in the [`beforeParse`](https://galbe.dev/documentation/middleware#before-parsing)
 * slot, so an unauthenticated request is answered **401 before its body is
 * read** — never a 400 that would leak the route's schema. Rejections are plain
 * `401`s with a `WWW-Authenticate` challenge; the reason stays server-side, in
 * the {@link JwtError} handed to `errorHandler`.
 *
 * The def also carries what the request contract and the spec need: matched
 * routes gain an optional `authorization` header (`format: JWT`) and a
 * `bearerAuth` security requirement.
 *
 * > Verification only — issuing tokens is not a request-time concern. Use
 * > {@link signJwt} on the endpoint that hands them out.
 *
 * ---
 * @example
 * ```typescript
 * import { jwt } from 'galbe/middlewares'
 *
 * // every /api route, verified with an HMAC secret
 * galbe.middleware('/api/*', jwt({ key: Bun.env.JWT_SECRET! }))
 *
 * // the public key of an RS256 signer, issuer pinned, admin role required
 * galbe.middleware('/admin/*', jwt({
 *   key: await Bun.file('public.pem').text(),
 *   issuer: 'https://auth.example.com',
 *   audience: 'my-api',
 *   validate: payload => payload.role === 'admin'
 * }))
 *
 * // a token is welcome but not required
 * galbe.middleware('/feed/*', jwt({ key: Bun.env.JWT_SECRET!, optional: true }))
 *
 * galbe.get('/api/me', ctx => ctx.state.jwtPayload.sub)
 * ```
 * @param config - see {@link JwtConfig}
 */
export const jwt = (config: JwtConfig): MiddlewareDef<JwtFragment> => {
  const sources = config.sources ?? ['bearer']
  const stateHolder = config.stateHolder ?? 'jwtPayload'
  const issuers = config.issuer === undefined ? undefined : [config.issuer].flat()
  const audiences = config.audience === undefined ? undefined : [config.audience].flat()
  const tolerance = config.clockTolerance ?? 0
  const store = keyStore(config.key, config.algorithms, 'verify')
  for (const source of sources)
    if (source !== 'bearer' && !source.startsWith('cookie:'))
      throw new SyntaxError(`jwt: invalid source '${source}', expected 'bearer' or 'cookie:<name>'`)
  const realm = checkRealm('jwt', config.realm)
  const bearer = sources.includes('bearer')

  const read = (ctx: PreParseContext) => {
    for (const source of sources) {
      const token =
        source === 'bearer'
          ? readCredential(ctx, 'header', 'authorization', 'Bearer ')
          : readCredential(ctx, 'cookie', source.slice(7))
      if (token) return token
    }
  }

  const verify = async (token: string): Promise<JwtPayload> => {
    const [head, body, sig, ...rest] = token.split('.')
    if (sig === undefined || rest.length) throw new JwtError('malformed', 'token is not a JWS compact serialization')
    let header: any, payload: any, signature: Uint8Array
    try {
      header = JSON.parse(decoder.decode(b64uToBytes(head!)))
      payload = JSON.parse(decoder.decode(b64uToBytes(body!)))
      signature = b64uToBytes(sig)
    } catch {
      throw new JwtError('malformed', 'token header, payload or signature is not decodable')
    }
    const alg = header?.alg
    const algorithms = await store.algorithms()
    if (!algorithms.includes(alg)) throw new JwtError('algorithm', `algorithm '${alg}' is not accepted`)
    const verified = await crypto.subtle.verify(
      operationParams(alg),
      await store.key(alg),
      signature,
      encoder.encode(`${head}.${body}`)
    )
    if (!verified) throw new JwtError('signature', 'signature does not match')
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
      throw new JwtError('malformed', 'payload is not a JSON object')
    return payload
  }

  const checkClaims = (payload: JwtPayload) => {
    const now = Date.now() / 1000
    if (payload.exp !== undefined && !(now - tolerance < payload.exp))
      throw new JwtError('expired', 'token has expired')
    if (payload.nbf !== undefined && !(now + tolerance >= payload.nbf))
      throw new JwtError('immature', 'token is not valid yet')
    if (issuers && !issuers.includes(payload.iss!)) throw new JwtError('issuer', `unexpected issuer '${payload.iss}'`)
    if (audiences && ![payload.aud ?? []].flat().some(a => audiences.includes(a)))
      throw new JwtError('audience', `unexpected audience '${payload.aud}'`)
    if (config.subject !== undefined && payload.sub !== config.subject)
      throw new JwtError('subject', `unexpected subject '${payload.sub}'`)
  }

  const beforeParse = authHook(
    async ctx => {
      const token = read(ctx)
      if (!token) {
        // optional authentication: nothing to verify is not a rejection
        if (config.optional) return
        throw new JwtError('missing', 'no token found in the request')
      }
      const payload = await verify(token)
      checkClaims(payload)
      if (config.validate && !(await config.validate(payload, ctx)))
        throw new JwtError('invalid', 'payload rejected by validate()')
      ctx.state[stateHolder] = payload
    },
    {
      errorHandler: config.errorHandler,
      // a cookie-sourced token has no challenge to answer with
      challenge: bearer ? error => bearerChallenge(realm, error.code) : undefined,
    }
  )

  // One scheme per source, so a cookie-sourced token documents as the cookie it is
  const { security, securitySchemes } = securityMetadata(
    sources.map(source =>
      source === 'bearer'
        ? { name: 'bearerAuth', scheme: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } as const }
        : { name: 'cookieAuth', scheme: { type: 'apiKey', in: 'cookie', name: source.slice(7) } as const }
    ),
    config.securityScheme
  )

  // the pattern is case-insensitive because the scheme name is (RFC 9110 §11.1)
  // and the hook reads it that way: a fragment that rejected `bearer <token>`
  // would 400 a request its own middleware just authenticated
  const authorization = $T.optional($T.string({ pattern: /^Bearer /i, format: 'JWT' }))
  return {
    beforeParse,
    ...(bearer ? { schema: { headers: { authorization } } } : {}),
    ...(security.length ? { security, securitySchemes } : {}),
  }
}

export type JwtSignOptions = {
  /**
   * Algorithm to sign with. Defaults to the key's own — `HS256` for a secret,
   * `RS256` for an RSA key, the curve's `ES*` for an EC one.
   */
  algorithm?: JwtAlgorithm
  /** Lifetime in seconds, from now: sets `exp`. */
  expiresIn?: number
  /** Delay in seconds, from now, before the token becomes valid: sets `nbf`. */
  notBefore?: number
  /** Sets the `iss` claim. */
  issuer?: string
  /** Sets the `aud` claim. */
  audience?: string | string[]
  /** Sets the `sub` claim. */
  subject?: string
  /** Extra JOSE header fields, `kid` typically. `alg` is always the one signed with. */
  header?: Record<string, any>
}

/**
 * #### signJwt
 * Sign a payload into a compact JWS token — the counterpart of {@link jwt},
 * kept out of the middleware so a request path never holds a signing key.
 * Signs on `crypto.subtle`, with the same key forms and algorithms `jwt`
 * verifies.
 *
 * `iat` is set automatically, and the option shorthands (`expiresIn`,
 * `issuer`, ...) fill their claims; a claim written in `payload` always wins
 * over the option that would have set it.
 *
 * > Import the key once — `crypto.subtle.importKey(...)` — and pass the
 * > `CryptoKey` when signing on a hot path: every other key form is imported
 * > per call.
 *
 * ---
 * @example
 * ```typescript
 * import { signJwt } from 'galbe/middlewares'
 *
 * galbe.post('/login', async ctx => {
 *   const user = await authenticate(ctx.body)
 *   return { token: await signJwt({ sub: user.id, role: user.role }, Bun.env.JWT_SECRET!, {
 *     expiresIn: 3600,
 *     issuer: 'https://auth.example.com'
 *   }) }
 * })
 * ```
 * @param payload - claims to sign
 * @param privateKey - HMAC secret, PKCS#8 PEM private key, JWK or `CryptoKey`
 * @param options - see {@link JwtSignOptions}
 */
export const signJwt = async (
  payload: JwtPayload,
  privateKey: JwtKey,
  options: JwtSignOptions = {}
): Promise<string> => {
  if (privateKey instanceof CryptoKey && !privateKey.usages.includes('sign'))
    throw new Error("jwt: the CryptoKey given to signJwt() was not imported with the 'sign' usage")
  const store = keyStore(privateKey, options.algorithm && [options.algorithm], 'sign')
  const [alg] = await store.algorithms()
  const now = Math.floor(Date.now() / 1000)
  const claims: JwtPayload = { iat: now }
  if (options.expiresIn !== undefined) claims.exp = now + options.expiresIn
  if (options.notBefore !== undefined) claims.nbf = now + options.notBefore
  if (options.issuer !== undefined) claims.iss = options.issuer
  if (options.audience !== undefined) claims.aud = options.audience
  if (options.subject !== undefined) claims.sub = options.subject
  const head = strToB64u(JSON.stringify({ typ: 'JWT', ...options.header, alg: alg! }))
  const body = strToB64u(JSON.stringify({ ...claims, ...payload }))
  const signature = await crypto.subtle.sign(
    operationParams(alg!),
    await store.key(alg!),
    encoder.encode(`${head}.${body}`)
  )
  return `${head}.${body}.${bytesToB64u(new Uint8Array(signature))}`
}
