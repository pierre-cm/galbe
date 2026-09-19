import type { MiddlewareDef, PreParseContext } from '../types'
import type { STOptional, STString } from '../schema'
import type { AuthErrorHandler, MaybePromise } from './_auth'

import { $T } from '../index'
import {
  AuthError,
  authHook,
  bearerChallenge,
  checkRealm,
  readRequired,
  secretMatcher,
  securityMetadata,
} from './_auth'

export { AuthError } from './_auth'

export type BearerConfig = {
  /**
   * Accepted token(s), compared in constant time. Either this or `verify` is
   * required; when both are given, `verify` decides.
   */
  token?: string | string[]
  /**
   * Looks the token up instead of comparing it to a constant — a database, a
   * cache, an introspection endpoint. Return the identity to put on
   * `ctx.state`, or `false`/`null`/`undefined` to reject. Returning `true`
   * accepts the request with no identity to carry: the state key is then set to
   * `true`, never to the credential itself.
   */
  verify?: (token: string, ctx: PreParseContext) => MaybePromise<boolean | object | null | undefined>
  /** `ctx.state` key the identity is stored under. Default `bearer`. */
  stateHolder?: string
  /**
   * Lets a request carrying **no** token through unauthenticated instead of
   * answering 401 — the public half of a route that personalizes a signed-in
   * caller. A token that is present and refused is still rejected.
   */
  optional?: boolean
  /** Protection space named in the `WWW-Authenticate` challenge. Omitted by default. */
  realm?: string
  /** Documentation only: the `bearerFormat` of the emitted scheme. */
  format?: string
  /**
   * Replaces the default rejection. Return a `Response` to answer the request,
   * or nothing to fall back to the default `401`; throwing takes the usual
   * error handler path. Optional authentication is {@link BearerConfig.optional},
   * not something an error handler expresses.
   */
  errorHandler?: AuthErrorHandler
  /**
   * Name of the OpenAPI security scheme contributed. Default `bearerAuth` —
   * rename it when two instances coexist in one app; `false` emits no security
   * metadata at all.
   */
  securityScheme?: string | false
}

/** The header contract a `bearer` instance imposes on every route it matches. */
export type BearerFragment = { headers: { authorization: STOptional<STString> } }

/**
 * #### bearer
 * Checks the `Authorization: Bearer` token against a constant, or against
 * whatever `verify` looks it up in. This is the **opaque token** middleware —
 * for tokens that carry their own signature, use `jwt`, which verifies rather
 * than looks up.
 *
 * It runs in the [`beforeParse`](https://galbe.dev/documentation/middleware#before-parsing)
 * slot, so an unauthenticated request is answered **401 before its body is
 * read**. Configured tokens are compared in constant time, and the reason for a
 * rejection stays server-side, in the {@link AuthError} handed to `errorHandler`.
 *
 * ---
 * @example
 * ```typescript
 * import { bearer } from 'galbe/middlewares'
 *
 * // a shared secret, straight from the environment
 * galbe.middleware('/hooks/*', bearer({ token: Bun.env.WEBHOOK_TOKEN! }))
 *
 * // looked up, with the identity carried to the handlers
 * galbe.middleware('/api/*', bearer({
 *   verify: async token => (await db.session(token)) ?? false
 * }))
 *
 * // signed in or not: a missing token is not a rejection here
 * galbe.middleware('/feed/*', bearer({
 *   verify: async token => await db.session(token),
 *   optional: true
 * }))
 *
 * galbe.get('/api/me', ctx => ctx.state.bearer.userId)
 * ```
 * @param config - see {@link BearerConfig}
 */
export const bearer = (config: BearerConfig): MiddlewareDef<BearerFragment> => {
  if (!config.verify && config.token === undefined)
    throw new SyntaxError("bearer: either 'token' or 'verify' is required")
  const stateHolder = config.stateHolder ?? 'bearer'
  const realm = checkRealm('bearer', config.realm)
  const matches = config.token === undefined ? undefined : secretMatcher([config.token].flat())

  const beforeParse = authHook(
    async ctx => {
      const token = readRequired(ctx, 'header', 'authorization', 'Bearer ', config.optional)
      if (!token) return
      const identity = config.verify ? await config.verify(token, ctx) : await matches!(token)
      if (!identity) throw new AuthError('invalid', 'bearer token rejected')
      // the key is set whenever the request authenticated — `true` for a
      // configured constant, so the token itself never lands on `ctx.state`,
      // where every log line and error report would find it
      ctx.state[stateHolder] = identity
    },
    { errorHandler: config.errorHandler, challenge: error => bearerChallenge(realm, error.code) }
  )

  const { security, securitySchemes } = securityMetadata(
    [
      {
        name: 'bearerAuth',
        scheme: { type: 'http', scheme: 'bearer', ...(config.format ? { bearerFormat: config.format } : {}) },
      },
    ],
    config.securityScheme
  )
  // case-insensitive because the scheme name is (RFC 9110 §11.1) and the hook
  // reads it that way: a fragment that rejected `bearer <token>` would 400 a
  // request its own middleware just authenticated
  const authorization = $T.optional($T.string({ pattern: /^Bearer /i }))
  return {
    beforeParse,
    schema: { headers: { authorization } },
    ...(security.length ? { security, securitySchemes } : {}),
  }
}
