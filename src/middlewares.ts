/**
 * #### galbe/middlewares
 * Built-in middlewares: request contracts, security metadata and hooks, ready
 * to register. Each one is a plain {@link MiddlewareDef}, so it is accepted
 * everywhere a hook is — `galbe.middleware`, `galbe.group`, or the default
 * export of a `*.middleware.ts` file.
 *
 * Every middleware is also importable on its own path (`galbe/middlewares/jwt`)
 * for apps that would rather not load the whole set.
 *
 * ---
 * @example
 * ```typescript
 * import { jwt } from 'galbe/middlewares'
 *
 * galbe.middleware('/api/*', jwt({ publicKey: Bun.env.JWT_SECRET! }))
 * ```
 */
export { jwt, JwtError, signJwt } from './middlewares/jwt'
export type {
  JwtAlgorithm,
  JwtConfig,
  JwtErrorCode,
  JwtFragment,
  JwtKey,
  JwtPayload,
  JwtSignOptions,
  JwtSource,
} from './middlewares/jwt'
