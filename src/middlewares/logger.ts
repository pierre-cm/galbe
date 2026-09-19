import type { Context, MiddlewareDef, PreParseHook, ResponseHook } from '../types'

import { METHOD_COLOR } from '../util'

/** One finished request, as the logger saw it. */
export type LogEntry = {
  method: string
  /** Request path, **without** the query string — see {@link LoggerConfig.log}. */
  path: string
  status: number
  /** Milliseconds from the pre-parse slot to the parsed response — body parsing and validation included. */
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
   * request is done, so the response status is readable and a filter can keep
   * only the failures.
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
 * It fills two slots: the
 * [`beforeParse`](https://galbe.dev/documentation/middleware#before-parsing)
 * one starts the clock, and the `afterHandle` one reports the request once a
 * `Response` exists. That covers what a hook-chain log cannot see — a `400`
 * from validation, a `401` from an auth middleware, a `500` — with the status
 * the request actually ended on and the error it ended on.
 *
 * What no middleware can see is a request that matched **no route**: a `404`, a
 * CORS preflight, or a request a plugin answered in `onFetch`. An access log
 * covering those belongs in the plugin.
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
  // the clock lives beside the request rather than on `ctx.state`, which is a
  // public `Record<string, any>`: an internal marker has no business in a dump
  // of it, and two instances on one route keep their own
  const starts = new WeakMap<object, number>()

  const beforeParse: PreParseHook = ctx => {
    starts.set(ctx, performance.now())
  }

  const afterHandle: ResponseHook = (response, ctx, error) => {
    const start = starts.get(ctx)
    // the post slot also runs for a request answered before the pre slot did —
    // a plugin that threw while routing — where there is no clock to read
    if (typeof start !== 'number' || config.skip?.(ctx)) return
    const id = ctx.state.requestId
    write(
      {
        method: ctx.request.method,
        path: pathOf(ctx.request.url),
        status: response.status,
        duration: performance.now() - start,
        ...(typeof id === 'string' ? { requestId: id } : {}),
        ...(error !== undefined ? { error } : {}),
      },
      ctx
    )
  }

  return { beforeParse, afterHandle }
}
