import type { MiddlewareDef, PreParseHook } from '../types'
import type { STOptional, STString } from '../schema'

import { $T } from '../index'

/**
 * What an id may be made of: enough for UUIDs, ULIDs, nanoids and W3C trace
 * ids, and nothing that could break a header or a log line. An inbound id that
 * does not match is replaced rather than rejected — a malformed trace header is
 * not the caller's request failing.
 */
const ID = /^[\w.:-]{1,128}$/

export type RequestIdConfig<N extends string = 'x-request-id', T extends boolean = true> = {
  /** Header the id travels in, inbound and outbound. Default `x-request-id`. */
  header?: N
  /**
   * Reuse a well-formed id sent by the caller, so one trace spans the services
   * it passes through. Default `true`. Set it to `false` at the edge of a
   * public API, where the id is the caller's to choose and yours to distrust.
   */
  trustHeader?: T
  /** Makes an id when there is none to reuse. Default `crypto.randomUUID()`. */
  generate?: () => string
  /** `ctx.state` key the id is stored under. Default `requestId`. */
  stateHolder?: string
}

/** The header contract a trusting `requestId` instance imposes; a distrusting one reads nothing and declares nothing. */
export type RequestIdFragment<N extends string, T extends boolean> = T extends false
  ? {}
  : { headers: Record<N, STOptional<STString>> }

/**
 * #### requestId
 * Gives every request an id — the caller's, when it sent a usable one, and a
 * fresh UUID otherwise — puts it on `ctx.state.requestId` and echoes it in the
 * response header. That id is what ties a log line, a trace and a support
 * ticket to one another.
 *
 * It runs in the [`beforeParse`](https://galbe.dev/documentation/middleware#before-parsing)
 * slot so the id exists before anything can reject the request: a `400` from
 * validation or a `401` from an auth middleware registered after it carries the
 * header too. Register it first for that reason.
 *
 * ---
 * @example
 * ```typescript
 * import { requestId } from 'galbe/middlewares'
 *
 * galbe.middleware(requestId())
 *
 * galbe.get('/orders', ctx => {
 *   log.info({ id: ctx.state.requestId }, 'listing orders')
 *   return orders()
 * })
 * ```
 * @param config - see {@link RequestIdConfig}
 */
export const requestId = <N extends string = 'x-request-id', T extends boolean = true>(
  config: RequestIdConfig<N, T> = {}
): MiddlewareDef<RequestIdFragment<N, T>> => {
  const header: string = config.header ?? 'x-request-id'
  const stateHolder = config.stateHolder ?? 'requestId'
  const generate = config.generate ?? (() => crypto.randomUUID())
  const trusted = config.trustHeader !== false

  const beforeParse: PreParseHook = ctx => {
    const inbound = trusted ? ctx.request.headers.get(header) : null
    const id = inbound && ID.test(inbound) ? inbound : generate()
    ctx.state[stateHolder] = id
    ctx.set.headers[header] = id
  }

  return {
    beforeParse,
    ...(trusted ? { schema: { headers: { [header]: $T.optional($T.string()) } } } : {}),
  } as MiddlewareDef<RequestIdFragment<N, T>>
}
