import type { OpenAPIV3 } from 'openapi-types'
import type { PreParseContext, PreParseHook } from '../types'

import { UnauthorizedError } from '../types'

/**
 * Internals shared by the credential-checking middlewares — `jwt`, `bearer`,
 * `apiKey` and `basicAuth`. Only {@link AuthError} is public API; it is
 * re-exported from each of those modules and from `galbe/middlewares`.
 */

export type MaybePromise<T> = T | Promise<T>

/**
 * Why a request was rejected: no credential at all, one that could not be read,
 * or one that was read and refused. Available to an `errorHandler`, never sent
 * to the client.
 */
export type AuthErrorCode = 'missing' | 'malformed' | 'invalid'

/**
 * Thrown by every auth middleware on rejection, and handed to its
 * `errorHandler`. `jwt` throws the `JwtError` subclass, which carries a finer
 * {@link AuthError.code}.
 */
export class AuthError<C extends string = AuthErrorCode> extends Error {
  code: C
  constructor(code: C, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

/**
 * Replaces the default rejection. Returning a `Response` answers the request,
 * returning nothing falls back to the default `401` (or `429` for
 * `rateLimit`), and throwing takes the usual error handler path.
 *
 * Optional authentication is deliberately **not** expressible here: it is the
 * `optional` option of each middleware, so no error handler can turn a
 * rejection into an authenticated request by forgetting to return something.
 */
export type AuthErrorHandler<E extends AuthError<any> = AuthError> = (
  error: E,
  ctx: PreParseContext
) => MaybePromise<Response | void>

/** Where a credential travels. `cookie` has no schema fragment: a middleware fragment covers headers, query and params. */
export type CredentialIn = 'header' | 'query' | 'cookie'

/**
 * Reads a credential out of the pre-parse context, where the body, the params
 * and the parsed query do not exist yet — hence the raw `URL` for query keys.
 * An expected `prefix` (`'Bearer '`, `'Basic '`) is matched case-insensitively,
 * as HTTP auth scheme names are, and stripped.
 */
export const readCredential = (ctx: PreParseContext, where: CredentialIn, name: string, prefix?: string) => {
  if (where === 'query') return new URL(ctx.request.url).searchParams.get(name) || undefined
  // cookie names are request-controlled keys: never reach through the prototype
  if (where === 'cookie')
    return Object.hasOwn(ctx.cookies, name) && ctx.cookies[name] ? String(ctx.cookies[name]) : undefined
  const value = ctx.request.headers.get(name)
  if (!value) return undefined
  if (!prefix) return value
  if (value.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return undefined
  return value.slice(prefix.length).trim() || undefined
}

/**
 * Reads a credential the middleware requires, or reports it missing — unless
 * the instance is `optional`, in which case a request carrying no credential
 * simply carries on unauthenticated. Only *absence* is forgiven: a credential
 * that is present and unreadable is still a malformed one.
 */
export const readRequired = (
  ctx: PreParseContext,
  where: CredentialIn,
  name: string,
  prefix?: string,
  optional?: boolean
) => {
  const value = readCredential(ctx, where, name, prefix)
  if (value) return value
  if (optional) return undefined
  throw new AuthError('missing', `no ${name} ${where} in the request`)
}

const encoder = new TextEncoder()
const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
const equalBytes = (a: Uint8Array, b: Uint8Array) => {
  let diff = a.length ^ b.length
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ (b[i] ?? 0)
  return diff === 0
}

/**
 * Constant-time matcher against a fixed set of secrets. Both sides are reduced
 * to a SHA-256 digest first, so the comparison always runs over 32 bytes:
 * neither the length of the configured secret nor the position of the first
 * differing byte is observable through timing. Every candidate is compared —
 * the loop never short-circuits on a match.
 */
export const secretMatcher = (secrets: string[]) => {
  let expected: Promise<Uint8Array[]> | undefined
  return async (presented: string) => {
    const candidates = await (expected ??= Promise.all(secrets.map(digest)))
    const actual = await digest(presented)
    let matched = false
    for (const candidate of candidates) matched = equalBytes(actual, candidate) || matched
    return matched
  }
}

/** `WWW-Authenticate` value for the bearer scheme, per RFC 6750. */
export const bearerChallenge = (realm: string | undefined, code: string) => {
  const params = [realm && `realm="${realm}"`, code !== 'missing' && 'error="invalid_token"'].filter(Boolean)
  return params.length ? `Bearer ${params.join(', ')}` : 'Bearer'
}

/** A realm ends up verbatim in a response header: keep quotes and control characters out of it. */
export const checkRealm = (middleware: string, realm?: string) => {
  if (realm !== undefined && /["\\\x00-\x1f\x7f]/.test(realm))
    throw new SyntaxError(`${middleware}: realm must not contain quotes, backslashes or control characters`)
  return realm
}

/**
 * The rejection contract, in one place: an {@link AuthError} becomes the
 * `errorHandler`'s business, or a bare `401` carrying the scheme's challenge.
 * Anything else — a bad key, a throwing `verify` — is a real fault and is
 * rethrown rather than flattened into a `401`.
 */
export const authHook = (
  authenticate: (ctx: PreParseContext) => Promise<void>,
  options: {
    errorHandler?: AuthErrorHandler<any>
    challenge?: (error: AuthError<any>) => string | undefined
  }
): PreParseHook => {
  return async ctx => {
    try {
      await authenticate(ctx)
    } catch (error) {
      if (!(error instanceof AuthError)) throw error
      // an errorHandler answers, or says nothing and leaves the default 401 in
      // place: returning nothing is never a way to authenticate a request
      const handled = await options.errorHandler?.(error, ctx)
      if (handled) return handled
      const challenge = options.challenge?.(error)
      throw new UnauthorizedError(undefined, challenge ? { 'www-authenticate': challenge } : undefined)
    }
  }
}

/**
 * Builds the two halves of the OpenAPI security metadata from the schemes a
 * middleware enforces: the requirement (`security`) and the definitions
 * (`securitySchemes`). `rename` overrides the default names so two instances
 * can coexist in one app; `false` opts out of security metadata entirely.
 * Colliding names get a numeric suffix rather than silently overwriting.
 */
export const securityMetadata = (
  schemes: { name: string; scheme: OpenAPIV3.SecuritySchemeObject }[],
  rename?: string | false
) => {
  const securitySchemes: Record<string, OpenAPIV3.SecuritySchemeObject> = Object.create(null)
  const security: string[] = []
  if (rename !== false)
    for (const entry of schemes) {
      const wanted = rename ?? entry.name
      let name = wanted
      for (let i = 2; Object.hasOwn(securitySchemes, name); i++) name = `${wanted}${i}`
      securitySchemes[name] = entry.scheme
      security.push(name)
    }
  return { security, securitySchemes }
}
