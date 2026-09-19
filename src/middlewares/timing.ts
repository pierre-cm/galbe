import type { Context, Hook, MiddlewareDef } from '../types'

export type TimingConfig = {
  /** Name of the measurement, a `Server-Timing` token. Default `total`. */
  name?: string
  /** Label shown next to the measurement in a browser's network panel. */
  description?: string
  /** Decimal places kept in the reported duration. Default `1`. */
  precision?: number
  /** Response header the measurement is appended to. Default `server-timing`. */
  header?: string
  /**
   * Leaves a request unmeasured. It runs once the request is done, so
   * `ctx.set.status` is readable and a filter can keep only the slow or the
   * failing ones.
   */
  skip?: (ctx: Context) => boolean
}

/** `Server-Timing` names are tokens: anything else would end the entry early. */
const token = (name: string) => name.replace(/[^\w-]/g, '-')

/**
 * #### timing
 * Reports how long the server spent on a request, in the
 * [`Server-Timing`](https://developer.mozilla.org/docs/Web/HTTP/Headers/Server-Timing)
 * header — the number a browser shows in its network panel, and the one a
 * caller cannot measure itself, since its own clock also counts the network.
 *
 * The entry is **appended**, so measurements a route added to the same header
 * survive alongside it. It covers the hook chain and the handler: a request
 * rejected before the chain — by validation, or by a `beforeParse` middleware
 * such as `jwt` or `rateLimit` — is not measured.
 *
 * The header is public, and so is what it says about your internals. Keep the
 * names generic on a public API, or restrict it to development with `skip`.
 *
 * ---
 * @example
 * ```typescript
 * import { timing } from 'galbe/middlewares'
 *
 * galbe.middleware(timing())
 * // → Server-Timing: total;dur=12.4
 *
 * galbe.middleware('/api/*', timing({ name: 'api', description: 'handler', precision: 2 }))
 * // → Server-Timing: api;dur=12.41;desc="handler"
 * ```
 * @param config - see {@link TimingConfig}
 */
export const timing = (config: TimingConfig = {}): MiddlewareDef<{}> => {
  const precision = config.precision ?? 1
  if (!Number.isInteger(precision) || precision < 0 || precision > 6)
    throw new SyntaxError('timing: precision must be an integer between 0 and 6')
  const description = config.description
  if (description !== undefined && /["\\\x00-\x1f\x7f]/.test(description))
    throw new SyntaxError('timing: description must not contain quotes, backslashes or control characters')
  const header = token(config.header ?? 'server-timing').toLowerCase()
  const name = token(config.name ?? 'total')
  const suffix = description ? `;desc="${description}"` : ''

  const hooks: Hook = async (ctx, next) => {
    const start = performance.now()
    try {
      return await next()
    } finally {
      if (!config.skip?.(ctx)) {
        const entry = `${name};dur=${(performance.now() - start).toFixed(precision)}${suffix}`
        const measured = ctx.set.headers[header]
        if (Array.isArray(measured)) measured.push(entry)
        else ctx.set.headers[header] = measured ? `${measured}, ${entry}` : entry
      }
    }
  }

  return { hooks }
}
