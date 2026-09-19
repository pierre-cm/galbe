import type { Context, Hook, MiddlewareDef } from '../types'

import { RequestError } from '../types'
import { METHOD_COLOR } from '../util'

/** One finished request, as the logger saw it. */
export type LogEntry = {
  method: string
  /** Request path, **without** the query string — see {@link LoggerConfig.log}. */
  path: string
  status: number
  /** Milliseconds the hook chain took, handler included. */
  duration: number
  /** Whatever `requestId` left on the state, when it is registered ahead of this. */
  requestId?: string
  /** The error the request ended on, when it ended on one. */
  error?: unknown
}

export type LoggerConfig = {
  /**
   * Receives every finished request instead of the default console line — the
   * hook into your own logger, structured or not.
   *
   * The entry's `path` carries no query string, as a query can hold an API key
   * or a token; `ctx.request.url` has the whole thing when you want it.
   */
  log?: (entry: LogEntry, ctx: Context) => void
  /**
   * Leaves a request unlogged — health checks, asset routes. It runs once the
   * request is done, so `ctx.set.status` is readable and a filter can keep only
   * the failures.
   */
  skip?: (ctx: Context) => boolean
}

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const statusColor = (status: number) =>
  status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : status >= 300 ? '\x1b[36m' : '\x1b[32m'
const paint = (color: string, text: string) => (Bun.enableANSIColors ? `${color}${text}${RESET}` : text)

const consoleLog = ({ method, path, status, duration, requestId }: LogEntry) =>
  console.log(
    `${paint(METHOD_COLOR[method.toLowerCase()] ?? '', method)} ${path} ` +
      `${paint(statusColor(status), String(status))} ${paint(DIM, `${duration.toFixed(1)}ms`)}` +
      (requestId ? ` ${paint(DIM, requestId)}` : '')
  )

/** The path alone: no origin, no query string, and never a `URL` allocation on the request path. */
const pathOf = (url: string) => {
  const start = url.indexOf('/', url.indexOf('://') + 3)
  if (start < 0) return '/'
  const query = url.indexOf('?', start)
  return query < 0 ? url.slice(start) : url.slice(start, query)
}

/**
 * #### logger
 * Logs one line per request — method, path, status and how long it took — or
 * hands the same fields to your own logger through `log`.
 *
 * It wraps the hook chain, so it reports the status the request actually ended
 * on, an error included. What it cannot see is a request that never reached the
 * chain: a `400` from validation, or a rejection from a
 * [`beforeParse`](https://galbe.dev/documentation/middleware#before-parsing)
 * middleware such as `jwt` or `rateLimit`, is answered earlier. A log of
 * *every* request, routed or not, belongs in a plugin's `onFetch`.
 *
 * ---
 * @example
 * ```typescript
 * import { logger } from 'galbe/middlewares'
 *
 * // a line per request, on the console
 * galbe.middleware(logger())
 *
 * // structured, and quiet about the health check
 * galbe.middleware(logger({
 *   log: entry => log.info(entry),
 *   skip: ctx => ctx.route?.path === '/health'
 * }))
 * ```
 * @param config - see {@link LoggerConfig}
 */
export const logger = (config: LoggerConfig = {}): MiddlewareDef<{}> => {
  const write = config.log ?? consoleLog

  const hooks: Hook = async (ctx, next) => {
    const start = performance.now()
    let status = 0
    let error: unknown = undefined
    try {
      const response = await next()
      // the same rule the chain settles the status by: a returned Response
      // carries its own, anything else answers with ctx.set.status
      status = response instanceof Response ? response.status : ctx.set.status || 200
      return response
    } catch (thrown) {
      error = thrown
      status = thrown instanceof RequestError ? thrown.status : 500
      throw thrown
    } finally {
      const duration = performance.now() - start
      if (!config.skip?.(ctx)) {
        const id = ctx.state.requestId
        write(
          {
            method: ctx.request.method,
            path: pathOf(ctx.request.url),
            status,
            duration,
            ...(typeof id === 'string' ? { requestId: id } : {}),
            ...(error !== undefined ? { error } : {}),
          },
          ctx
        )
      }
    }
  }

  return { hooks }
}
