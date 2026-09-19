import type { MiddlewareDef, PreParseContext } from '../types'
import type { STOptional, STString } from '../schema'
import type { AuthErrorHandler, CredentialIn, MaybePromise } from './_auth'

import { $T } from '../index'
import { AuthError, authHook, readRequired, secretMatcher, securityMetadata } from './_auth'

export { AuthError } from './_auth'

export type ApiKeyConfig<N extends string = 'x-api-key', I extends CredentialIn = 'header'> = {
  /**
   * Accepted key(s), compared in constant time. Either this or `verify` is
   * required; when both are given, `verify` decides.
   */
  key?: string | string[]
  /**
   * Looks the key up instead of comparing it to a constant. Return the
   * identity to put on `ctx.state`, or `false`/`null`/`undefined` to reject.
   * Returning `true` accepts the request with no identity to carry: the state
   * key is then set to `true`, never to the key itself.
   */
  verify?: (key: string, ctx: PreParseContext) => MaybePromise<boolean | object | null | undefined>
  /**
   * Where the key travels. Default `header`. A `query` key is accepted because
   * OpenAPI describes it, but it lands in access logs, proxy traces and
   * `Referer` headers — prefer a header wherever you control the caller.
   */
  in?: I
  /** Name of the header, query parameter or cookie carrying the key. Default `x-api-key`. */
  name?: N
  /** `ctx.state` key the identity is stored under. Default `apiKey`. */
  stateHolder?: string
  /**
   * Lets a request carrying **no** key through unauthenticated instead of
   * answering 401. A key that is present and refused is still rejected.
   */
  optional?: boolean
  /**
   * Replaces the default rejection. Return a `Response` to answer the request,
   * or nothing to fall back to the default `401`; throwing takes the usual
   * error handler path. Optional authentication is {@link ApiKeyConfig.optional},
   * not something an error handler expresses.
   */
  errorHandler?: AuthErrorHandler
  /**
   * Name of the OpenAPI security scheme contributed. Default `apiKeyAuth` —
   * rename it when two instances coexist in one app; `false` emits no security
   * metadata at all.
   */
  securityScheme?: string | false
}

/**
 * The contract an `apiKey` instance imposes on every route it matches — the
 * declared parameter, in the part of the request it travels in. A cookie key
 * contributes none: a middleware fragment covers headers, query and params.
 */
export type ApiKeyFragment<N extends string, I extends CredentialIn> = I extends 'header'
  ? { headers: Record<N, STOptional<STString>> }
  : I extends 'query'
    ? { query: Record<N, STOptional<STString>> }
    : {}

/**
 * #### apiKey
 * Checks a named API key — a header by default, optionally a query parameter
 * or a cookie — against a constant or against whatever `verify` looks it up in.
 *
 * It runs in the [`beforeParse`](https://galbe.dev/documentation/middleware#before-parsing)
 * slot, so an unauthenticated request is answered **401 before its body is
 * read**. Configured keys are compared in constant time, and the reason for a
 * rejection stays server-side, in the {@link AuthError} handed to `errorHandler`.
 *
 * The def declares the parameter it reads and the `apiKey` security scheme that
 * owns it, so the key documents as auth instead of as a plain header.
 *
 * ---
 * @example
 * ```typescript
 * import { apiKey } from 'galbe/middlewares'
 *
 * // the default: an x-api-key header, checked against a constant
 * galbe.middleware('/api/*', apiKey({ key: Bun.env.API_KEY! }))
 *
 * // a named header, looked up, with the tenant carried to the handlers
 * galbe.middleware('/v1/*', apiKey({
 *   name: 'x-tenant-key',
 *   verify: async key => (await db.tenantByKey(key)) ?? false
 * }))
 *
 * // public traffic carries no key at all: let it through unauthenticated
 * galbe.middleware('/v1/public/*', apiKey({
 *   verify: async key => await db.tenantByKey(key),
 *   optional: true
 * }))
 *
 * galbe.get('/v1/usage', ctx => ctx.state.apiKey.tenantId)
 * ```
 * @param config - see {@link ApiKeyConfig}
 */
export const apiKey = <N extends string = 'x-api-key', I extends CredentialIn = 'header'>(
  config: ApiKeyConfig<N, I>
): MiddlewareDef<ApiKeyFragment<N, I>> => {
  if (!config.verify && config.key === undefined) throw new SyntaxError("apiKey: either 'key' or 'verify' is required")
  const where: CredentialIn = config.in ?? 'header'
  const name: string = config.name ?? 'x-api-key'
  const stateHolder = config.stateHolder ?? 'apiKey'
  const matches = config.key === undefined ? undefined : secretMatcher([config.key].flat())

  const beforeParse = authHook(
    async ctx => {
      const key = readRequired(ctx, where, name, undefined, config.optional)
      if (!key) return
      const identity = config.verify ? await config.verify(key, ctx) : await matches!(key)
      if (!identity) throw new AuthError('invalid', 'api key rejected')
      // the key is set whenever the request authenticated — `true` for a
      // configured constant, so the key itself never lands on `ctx.state`,
      // where every log line and error report would find it
      ctx.state[stateHolder] = identity
    },
    // no challenge: an api key scheme has no registered WWW-Authenticate form
    { errorHandler: config.errorHandler }
  )

  const { security, securitySchemes } = securityMetadata(
    [{ name: 'apiKeyAuth', scheme: { type: 'apiKey', in: where, name } }],
    config.securityScheme
  )
  const parameter = { [name]: $T.optional($T.string()) }
  return {
    beforeParse,
    ...(where === 'header'
      ? { schema: { headers: parameter } }
      : where === 'query'
        ? { schema: { query: parameter } }
        : {}),
    ...(security.length ? { security, securitySchemes } : {}),
  } as MiddlewareDef<ApiKeyFragment<N, I>>
}
