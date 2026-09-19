import type { MiddlewareDef, PreParseContext } from '../types'
import type { STOptional, STString } from '../schema'
import type { AuthErrorHandler, MaybePromise } from './_auth'

import { $T } from '../index'
import { AuthError, authHook, checkRealm, readRequired, secretMatcher, securityMetadata } from './_auth'

export { AuthError } from './_auth'

export type BasicAuthConfig = {
  /**
   * Accepted credentials, as `{ user: password }`, compared in constant time.
   * Either this or `verify` is required; when both are given, `verify` decides.
   *
   * > Passwords sit in memory in clear: this is the right shape for a handful
   * > of machine accounts from the environment, not for real user accounts.
   */
  users?: Record<string, string>
  /**
   * Checks the credentials itself — against a database and a password hash,
   * typically. Return the identity to put on `ctx.state`, or
   * `false`/`null`/`undefined` to reject. Returning `true` accepts the request
   * with no identity to carry: the state key is then set to `true`.
   */
  verify?: (user: string, password: string, ctx: PreParseContext) => MaybePromise<boolean | object | null | undefined>
  /** Protection space named in the `WWW-Authenticate` challenge — what browsers show when prompting. Default `Restricted`. */
  realm?: string
  /** `ctx.state` key the identity is stored under — the username, unless `verify` returned one. Default `basicAuth`. */
  stateHolder?: string
  /**
   * Lets a request carrying **no** credentials through unauthenticated instead
   * of answering 401. Credentials that are present and refused are still
   * rejected, as are ones that cannot be decoded.
   */
  optional?: boolean
  /**
   * Replaces the default rejection. Return a `Response` to answer the request,
   * or nothing to fall back to the default `401`; throwing takes the usual
   * error handler path. Optional authentication is {@link BasicAuthConfig.optional},
   * not something an error handler expresses.
   */
  errorHandler?: AuthErrorHandler
  /**
   * Name of the OpenAPI security scheme contributed. Default `basicAuth` —
   * rename it when two instances coexist in one app; `false` emits no security
   * metadata at all.
   */
  securityScheme?: string | false
}

/** The header contract a `basicAuth` instance imposes on every route it matches. */
export type BasicAuthFragment = { headers: { authorization: STOptional<STString> } }

const decoder = new TextDecoder()

/**
 * #### basicAuth
 * HTTP Basic authentication (RFC 7617): decodes `Authorization: Basic` and
 * checks the credentials against a `{ user: password }` map or `verify`.
 *
 * It runs in the [`beforeParse`](https://galbe.dev/documentation/middleware#before-parsing)
 * slot, so an unauthenticated request is answered **401 before its body is
 * read**, with the `WWW-Authenticate: Basic` challenge browsers prompt on.
 * Configured credentials are matched in constant time over the whole
 * `user:password` pair, so an unknown username is indistinguishable from a
 * wrong password — no user enumeration through timing.
 *
 * > Basic sends the password on every request, protected by nothing but TLS.
 * > Fine for internal tooling and machine accounts; reach for `jwt` or `bearer`
 * > for anything user-facing.
 *
 * ---
 * @example
 * ```typescript
 * import { basicAuth } from 'galbe/middlewares'
 *
 * // a machine account from the environment
 * galbe.middleware('/metrics/*', basicAuth({
 *   users: { prometheus: Bun.env.METRICS_PASSWORD! },
 *   realm: 'metrics'
 * }))
 *
 * // checked against stored hashes, with the account carried to the handlers
 * galbe.middleware('/admin/*', basicAuth({
 *   verify: async (user, password) => {
 *     const account = await db.user(user)
 *     return account && (await Bun.password.verify(password, account.hash)) ? account : false
 *   }
 * }))
 *
 * // credentials are welcome but not required
 * galbe.middleware('/status/*', basicAuth({
 *   users: { prometheus: Bun.env.METRICS_PASSWORD! },
 *   optional: true
 * }))
 *
 * galbe.get('/admin/me', ctx => ctx.state.basicAuth.email)
 * ```
 * @param config - see {@link BasicAuthConfig}
 */
export const basicAuth = (config: BasicAuthConfig): MiddlewareDef<BasicAuthFragment> => {
  if (!config.verify && config.users === undefined)
    throw new SyntaxError("basicAuth: either 'users' or 'verify' is required")
  // an empty map is almost always an environment variable that did not arrive:
  // fail at registration rather than reject every caller as a wrong password
  if (config.users !== undefined && !Object.keys(config.users).length)
    throw new SyntaxError('basicAuth: `users` is empty, no credential would ever be accepted')
  const stateHolder = config.stateHolder ?? 'basicAuth'
  const realm = checkRealm('basicAuth', config.realm) ?? 'Restricted'
  // one matcher over the whole `user:password` pair: checking the username
  // first would answer faster for an unknown user than for a wrong password
  const matches =
    config.users === undefined ? undefined : secretMatcher(Object.entries(config.users).map(p => p.join(':')))

  const beforeParse = authHook(
    async ctx => {
      const credentials = readRequired(ctx, 'header', 'authorization', 'Basic ', config.optional)
      if (!credentials) return
      let decoded: string
      try {
        // RFC 7617 allows UTF-8 credentials, so decode the bytes rather than
        // reading atob's binary string as latin-1
        decoded = decoder.decode(Uint8Array.from(atob(credentials), c => c.charCodeAt(0)))
      } catch {
        throw new AuthError('malformed', 'credentials are not valid base64')
      }
      const separator = decoded.indexOf(':')
      if (separator < 0) throw new AuthError('malformed', "credentials are not 'user:password'")
      const user = decoded.slice(0, separator)
      const identity = config.verify
        ? await config.verify(user, decoded.slice(separator + 1), ctx)
        : (await matches!(decoded)) && user
      if (!identity) throw new AuthError('invalid', 'credentials rejected')
      // a `users` map authenticates a username, so that name is the identity;
      // `true` from `verify` sets the key without carrying anything more
      ctx.state[stateHolder] = identity
    },
    { errorHandler: config.errorHandler, challenge: () => `Basic realm="${realm}", charset="UTF-8"` }
  )

  const { security, securitySchemes } = securityMetadata(
    [{ name: 'basicAuth', scheme: { type: 'http', scheme: 'basic' } }],
    config.securityScheme
  )
  return {
    beforeParse,
    // case-insensitive: the scheme name is (RFC 9110 §11.1), and so is the hook
    schema: { headers: { authorization: $T.optional($T.string({ pattern: /^Basic /i })) } },
    ...(security.length ? { security, securitySchemes } : {}),
  }
}
