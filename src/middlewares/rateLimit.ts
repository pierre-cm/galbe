import type { MiddlewareDef, PreParseContext, PreParseHook } from '../types'
import type { MaybePromise } from './_auth'

import { TooManyRequestsError } from '../types'

/** All a rejection knows about itself, and all an `errorHandler` is given. */
export type RateLimitInfo = {
  /** Bucket the request was accounted to — whatever `key` returned. */
  key: string
  /** Requests allowed per window, as configured. */
  limit: number
  /** Whole seconds until the request would be allowed through, at least `1`. */
  retryAfter: number
}

export type RateLimitConfig = {
  /** Requests allowed per `window`, and the burst a client may spend at once. */
  limit: number
  /** Seconds the bucket takes to refill completely. Fractional values are allowed. */
  window: number
  /**
   * Bucket a request is accounted to. Defaults to `ctx.clientAddress`, which is
   * the socket peer unless [`trustProxy`](https://galbe.dev/documentation/configuration#trustproxy)
   * is configured — set it, or every client behind your proxy shares one bucket.
   *
   * Returning nothing exempts the request: that is how an allow-list, an
   * internal caller or an authenticated tier opts out.
   */
  key?: (ctx: PreParseContext) => string | undefined | null
  /**
   * Maximum number of buckets held in memory. Default `10000`. Reaching it
   * evicts refilled buckets first, then the least recently created one.
   */
  maxKeys?: number
  /** Emit the `RateLimit-*` response headers. Default `true`. */
  headers?: boolean
  /**
   * Replaces the default `429`. Return a `Response` to answer the request, or
   * nothing to let it through anyway; throwing takes the usual error handler
   * path. A `Response` of your own carries no `Retry-After` unless you set one.
   */
  errorHandler?: (info: RateLimitInfo, ctx: PreParseContext) => MaybePromise<Response | void>
}

type Bucket = { tokens: number; updated: number }

const DEFAULT_MAX_KEYS = 10_000
/** Buckets examined per eviction: bounded work, so one request cannot pay for a full scan. */
const SWEEP = 16

/**
 * #### rateLimit
 * Caps how often one client may call the routes it covers, as a token bucket:
 * every key gets `limit` tokens refilled smoothly over `window` seconds, a
 * request spends one, and a request that finds none is answered **429** with a
 * `Retry-After`. Spending them all at once is allowed — the burst a client may
 * take is the limit itself.
 *
 * It runs in the [`beforeParse`](https://galbe.dev/documentation/middleware#before-parsing)
 * slot, so a throttled request is rejected **before its body is read**.
 *
 * Counters live in this process's memory, so each instance is its own limiter
 * and each replica of your app enforces the limit on its own — `n` replicas
 * mean `n` × `limit`. It also only covers **routed** paths: a flood against URLs
 * that match no route never reaches a middleware. Neither is a reason to skip
 * it, but a public-facing service wants a limiter at the edge as well.
 *
 * ---
 * @example
 * ```typescript
 * import { rateLimit } from 'galbe/middlewares'
 *
 * // 100 requests per minute per client, everywhere
 * galbe.middleware(rateLimit({ limit: 100, window: 60 }))
 *
 * // a tighter bucket on top, for one subtree — each instance counts on its own
 * galbe.middleware('/auth/*', rateLimit({ limit: 5, window: 60 }))
 *
 * // per account rather than per address, with signed-in users exempt from it
 * galbe.middleware('/api/*', rateLimit({
 *   limit: 1000,
 *   window: 3600,
 *   key: ctx => ctx.state.apiKey?.accountId
 * }))
 * ```
 * @param config - see {@link RateLimitConfig}
 */
export const rateLimit = (config: RateLimitConfig): MiddlewareDef<{}> => {
  const { limit, window } = config
  if (!Number.isFinite(limit) || limit < 1) throw new SyntaxError('rateLimit: limit must be at least 1')
  if (!Number.isFinite(window) || window <= 0) throw new SyntaxError('rateLimit: window must be a positive number')
  const maxKeys = config.maxKeys ?? DEFAULT_MAX_KEYS
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new SyntaxError('rateLimit: maxKeys must be a positive integer')
  const keyOf = config.key ?? ((ctx: PreParseContext) => ctx.clientAddress)
  const rate = limit / window // tokens per second
  const buckets = new Map<string, Bucket>()
  // monotonic: a clock adjustment must not hand out tokens or freeze a bucket
  const seconds = () => performance.now() / 1000

  /**
   * Keeps the store bounded, the same discipline as the router cache — a flood
   * of distinct keys must never grow it without limit. Refilled buckets go
   * first, as they say nothing a fresh one would not; only when the sweep frees
   * none does the oldest bucket go.
   */
  const evict = (now: number) => {
    let swept = 0
    let freed = false
    for (const [key, bucket] of buckets) {
      if (swept++ >= SWEEP) break
      if (bucket.tokens + (now - bucket.updated) * rate >= limit) {
        buckets.delete(key)
        freed = true
      }
    }
    if (!freed) buckets.delete(buckets.keys().next().value as string)
  }

  /** Refills the key's bucket up to `now`, then spends a token if there is one. */
  const consume = (key: string, now: number) => {
    let bucket = buckets.get(key)
    if (bucket) bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.updated) * rate)
    else {
      if (buckets.size >= maxKeys) evict(now)
      buckets.set(key, (bucket = { tokens: limit, updated: now }))
    }
    bucket.updated = now
    const allowed = bucket.tokens >= 1
    if (allowed) bucket.tokens -= 1
    return { allowed, tokens: bucket.tokens }
  }

  const beforeParse: PreParseHook = ctx => {
    const key = keyOf(ctx)
    if (!key) return
    const { allowed, tokens } = consume(key, seconds())
    if (config.headers !== false) {
      ctx.set.headers['ratelimit-limit'] = String(limit)
      ctx.set.headers['ratelimit-remaining'] = String(Math.floor(tokens))
      ctx.set.headers['ratelimit-reset'] = String(Math.ceil((limit - tokens) / rate))
    }
    if (allowed) return
    // a bucket below one token needs that fraction of a second back; HTTP
    // counts Retry-After in whole seconds, so it always asks for at least one
    const retryAfter = Math.ceil((1 - tokens) / rate)
    if (config.errorHandler) return config.errorHandler({ key, limit, retryAfter }, ctx)
    throw new TooManyRequestsError(undefined, { 'retry-after': String(retryAfter) })
  }

  return { beforeParse }
}
