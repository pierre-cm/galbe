import type { GalbeMiddleware, Method, Route, RouteNode } from '.'
import type { RouteFileMeta, RouteMeta } from './routes'

export const METHOD_COLOR: Record<string, string> = {
  get: '\x1b[32m',
  post: '\x1b[34m',
  put: '\x1b[36m',
  patch: '\x1b[33m',
  delete: '\x1b[31m',
  options: '',
  head: '',
}
const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

/**
 * Deep-merges `override` into `base` **in place** — `base` is mutated and
 * returned, so treat config merging as destructive. Plain objects merge
 * recursively; arrays, `null` and primitives replace the base value wholesale.
 */
export const softMerge = <T>(base: T, override: T): T => {
  for (const key in override) {
    if (override[key] instanceof Object && !(override[key] instanceof Array)) {
      if (!base[key]) Object.assign(base as any, { [key]: {} })
      softMerge(base[key], override[key])
    } else Object.assign(base as any, { [key]: override[key] })
  }
  return base
}
/**
 * Split a route's JSDoc head into its `summary`/`description` pair: the first
 * paragraph is the summary, whatever follows the first blank line is the
 * description. A head with no blank line is a summary alone — the single
 * source of truth for every consumer (route log, OpenAPI spec).
 */
export const splitHead = (head?: string): { summary?: string; description?: string } => {
  if (!head) return {}
  const blank = head.indexOf('\n\n')
  if (blank === -1) {
    const nl = head.indexOf('\n')
    return { summary: (nl === -1 ? head : head.slice(0, nl)).trim() || undefined }
  }
  return {
    summary: head.slice(0, blank).trim() || undefined,
    description: head.slice(blank + 2).trim() || undefined,
  }
}
/**
 * An operation's `summary` / `description` pair. The JSDoc head is the default
 * — first paragraph is the summary, whatever follows the first blank line is
 * the description — and an explicit `@summary` / `@description` tag overrides
 * its half of it. A bare `@summary` with no text means "explicitly no summary",
 * which is the one way to write a description without one.
 *
 * Repeated `@description` lines join into a multi-line description; a repeated
 * `@summary` keeps the first.
 */
export const routeHead = (meta?: Record<string, any>): { summary?: string; description?: string } => {
  const split = splitHead(meta?.head)
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)
  const summaryTag = first(meta?.summary)
  const descriptionTag = meta?.description
  // a bare tag carries `true`: the author named the field and left it empty
  const summary = summaryTag === true ? '' : typeof summaryTag === 'string' ? summaryTag.trim() : split.summary
  const description =
    descriptionTag === true
      ? ''
      : Array.isArray(descriptionTag)
        ? descriptionTag.filter(d => typeof d === 'string').join('\n')
        : typeof descriptionTag === 'string'
          ? descriptionTag
          : split.description
  return { summary, description }
}

/** The wildcard status ranges a response map may be keyed by, as OpenAPI spells them. */
export const RESPONSE_RANGES = ['1XX', '2XX', '3XX', '4XX', '5XX'] as const
/** The range key covering `status` — `404` → `'4XX'`. */
export const responseRangeOf = (status: number) => `${Math.floor(status / 100)}XX`
/** Default descriptions for the range keys, used when a response declares none. */
export const RESPONSE_RANGE_DESCRIPTION: Record<string, string> = {
  '1XX': 'Informational',
  '2XX': 'Successful',
  '3XX': 'Redirection',
  '4XX': 'Client error',
  '5XX': 'Server error',
}
/**
 * The response-map entry that governs `status`. Precedence is OpenAPI's: an
 * exact status wins over the `NXX` range containing it, which wins over
 * `default`. Every consumer of a response map resolves through this, so
 * validation, content-type inference and the spec agree on one answer.
 */
export const responseEntryFor = <T>(
  response: Partial<Record<string | number, T>> | undefined,
  status: number
): T | undefined => response?.[status] ?? response?.[responseRangeOf(status)] ?? response?.['default']

export const logRoute = (
  r: { method: string; path: string; static?: { path: string; root: string } },
  meta?: RouteMeta,
  format?: { maxPathLength?: number }
) => {
  let path = r.path === '' ? '/' : r.path
  let method = r.method

  let routeLog = ''

  if (r?.static) {
    routeLog = `[\x1b[0;33m${`STATIC\x1b[0m]`.padEnd(12, ' ')} ${path.padEnd(
      format?.maxPathLength ?? path.length,
      ' '
    )} \x1b[0;33m⇒\x1b[0m  ${r.static.path}\x1b[0m`
    if (meta?.deprecated) routeLog = `\x1b[0;9m\x1b[38;5;244m${routeLog.replaceAll(ansiRegex, '')}\x1b[0m`
  } else {
    let color = METHOD_COLOR?.[method] || ''
    const { summary } = routeHead(meta)
    routeLog = `[${color}${`${method.toUpperCase()}\x1b[0m]`.padEnd(12, ' ')} ${path
      .padEnd(format?.maxPathLength ?? path.length, ' ')
      .replaceAll(/:([^\/]+)/g, '\x1b[0;33m:$1\x1b[0m')}${summary ? `  ${summary.replaceAll(/\s+/g, ' ')}` : ''}\x1b[0m`
    if (meta?.deprecated) routeLog = `\x1b[0;9m\x1b[38;5;244m${routeLog.replaceAll(ansiRegex, '')}\x1b[0m`
  }

  if (routeLog) console.log(`    ${routeLog}`)
}

/**
 * Walk over the routes tree. A callback is called for each route with Route infos.
 */
export const walkRoutes = (node: RouteNode, cb: (route: Route) => void) => {
  if (node?.routes) Object.values(node.routes).forEach(r => cb(r))
  for (let c of Object.values(node?.children || {})) walkRoutes(c, cb)
  if (node?.param) walkRoutes(node.param, cb)
}

/**
 * Walk over the routes metadata tree. A callback is called for each route metadata with RouteMeta infos.
 */
export const walkMetaRoutes = (
  meta: RouteFileMeta[],
  cb: (method: Method, path: string, routeMeta: RouteMeta) => void
) => {
  for (const f of meta) {
    for (const [path, methods] of Object.entries(f.routes)) {
      for (const [method, meta] of Object.entries(methods)) {
        cb(method as Method, path, meta)
      }
    }
  }
}

export const isIterator = (obj: any) => typeof obj?.next === 'function'

export const joinPath = (prefix: string, path: string) => {
  if (prefix && prefix[0] !== '/') prefix = `/${prefix}`
  prefix = prefix.replace(/\/+$/, '')
  return `${prefix}${path[0] === '/' ? path : `/${path}`}`
}

// middleware pattern segments are literals or '*'; ':params' are a routing
// concept and rejected here ('*' already matches any single segment)
export const parseMiddlewarePattern = (pattern: string): string[] => {
  const segments = pattern.split('/').filter(s => s !== '')
  const valid = pattern === '/' || (segments.length && segments.every(s => s === '*' || !/[:*\s]/.test(s)))
  if (!valid) throw new SyntaxError(`${pattern} is not a valid middleware pattern (segments are literals or '*')`)
  return segments
}

// literal segments match identical route segments, '*' matches any single
// segment (including ':params'), a trailing '*' matches the whole subtree and
// the prefix itself (like the router's terminal wildcard)
export const matchMiddleware = (pattern: string[], path: string[]): boolean => {
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!
    if (p === '*' && i === pattern.length - 1) return true
    if (i >= path.length || (p !== '*' && p !== path[i])) return false
  }
  return pattern.length === path.length
}

/** The route's schema as declared, kept aside so recomposition re-merges from a clean base. */
const Declared = Symbol.for('Galbe.Route.DeclaredSchema')

/**
 * Merges the matched middlewares' schema fragments into a route's request
 * schema — fragments in registration order, route-declared keys last, so a
 * route can always tighten or override. Returns false when there was nothing
 * to merge.
 *
 * Merging is always redone from the declared schema, never from the result of
 * a previous merge: a route recomposes whenever a later `middleware()` call
 * matches it, and a fragment key already merged in would otherwise shadow the
 * newcomer's, making the outcome depend on registration order.
 *
 * Copy-on-merge: a `RequestSchema` object may be shared by several routes, so
 * the route gets its own copy instead of the user's being mutated.
 */
export const mergeMiddlewareSchema = (route: Route, middlewares: GalbeMiddleware[]): boolean => {
  const fragments = middlewares.flatMap(m => (m.schema ? [m.schema] : []))
  if (!fragments.length) return false
  const declared: Record<string, any> = (route as any)[Declared] ?? route.schema ?? {}
  ;(route as any)[Declared] = declared
  const schema: Record<string, any> = { ...declared }
  for (const key of ['headers', 'query', 'params'] as const) {
    const parts = fragments.flatMap(f => (f[key] ? [f[key]] : []))
    if (parts.length) schema[key] = Object.assign({}, ...parts, declared[key])
  }
  route.schema = schema
  return true
}

export const HttpStatus = {
  100: 'Continue',
  101: 'Switching Protocols',
  102: 'Processing',
  103: 'Early Hints',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  207: 'Multi-Status',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Moved Temporarily',
  303: 'See Other',
  304: 'Not Modified',
  305: 'Use Proxy',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Request Entity Too Large',
  414: 'Request-URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Requested Range Not Satisfiable',
  417: 'Expectation Failed',
  418: "I'm a teapot",
  419: 'Insufficient Space on Resource',
  420: 'Method Failure',
  421: 'Misdirected Request',
  422: 'Unprocessable Entity',
  423: 'Locked',
  424: 'Failed Dependency',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  507: 'Insufficient Storage',
  511: 'Network Authentication Required',
}

const BA_HEADER_RX = /^application\/octet-stream\b/
const JSON_HEADER_RX = /^application\/json\b/
const TXT_HEADER_RX = /^text\//
const FORM_HEADER_RX = /^application\/x-www-form-urlencoded\b/
const MP_HEADER_RX = /^multipart\/form-data\b/

export type ParseMode = 'json' | 'text' | 'byteArray' | 'urlForm' | 'multipart' | 'default'

export const inferBodyType = (contentType?: string | null): ParseMode => {
  if (!contentType) return 'default'
  if (JSON_HEADER_RX.test(contentType)) return 'json'
  if (TXT_HEADER_RX.test(contentType)) return 'text'
  if (FORM_HEADER_RX.test(contentType)) return 'urlForm'
  if (MP_HEADER_RX.test(contentType)) return 'multipart'
  if (BA_HEADER_RX.test(contentType)) return 'byteArray'
  return 'default'
}

/**
 * Trusted proxy resolution: turning the socket peer and an `X-Forwarded-For`
 * header into the address of the actual client. Everything below is fed
 * attacker-controlled text, so nothing here throws and nothing is trusted
 * before it parses as an IP.
 */

/** Beyond this many hops the header is treated as unusable and the socket peer wins. */
const MAX_FORWARDED_HOPS = 32
const IPV4_RX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const IPV6_GROUP_RX = /^[0-9a-f]{1,4}$/

/** Dotted quad → 4 bytes. Leading zeros are rejected: one address, one spelling. */
const ipv4Bytes = (ip: string) => {
  const m = IPV4_RX.exec(ip)
  if (!m) return undefined
  const bytes = new Uint8Array(4)
  for (let i = 0; i < 4; i++) {
    const part = m[i + 1]!
    const value = Number(part)
    if (value > 255 || (part.length > 1 && part[0] === '0')) return undefined
    bytes[i] = value
  }
  return bytes
}

/** RFC 4291 text form → 16 bytes: one `::` run, and an optional trailing dotted quad. */
const ipv6Bytes = (ip: string) => {
  const [head, tail, extra] = ip.split('::')
  if (extra !== undefined) return undefined
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = right.length ? right : left
  let v4: Uint8Array | undefined
  if (groups.at(-1)?.includes('.')) {
    v4 = ipv4Bytes(groups.pop()!)
    if (!v4) return undefined
  }
  const count = left.length + right.length + (v4 ? 2 : 0)
  // without a `::` run every group must be spelled out
  if (count > 8 || (tail === undefined && count !== 8)) return undefined
  const bytes = new Uint8Array(16)
  const write = (group: string, at: number) => {
    if (!IPV6_GROUP_RX.test(group)) return false
    const value = parseInt(group, 16)
    bytes[at] = value >> 8
    bytes[at + 1] = value & 0xff
    return true
  }
  for (let i = 0; i < left.length; i++) if (!write(left[i]!, i * 2)) return undefined
  const start = 16 - right.length * 2 - (v4 ? 4 : 0)
  for (let i = 0; i < right.length; i++) if (!write(right[i]!, start + i * 2)) return undefined
  if (v4) bytes.set(v4, 12)
  return bytes
}

const ipBytes = (ip: string) => (ip.includes(':') ? ipv6Bytes(ip) : ipv4Bytes(ip))

/**
 * Reads one hop — a socket peer or an `X-Forwarded-For` entry — into its
 * canonical text form and its bytes. Brackets and a trailing port are stripped
 * (`[::1]:8080`, `192.0.2.1:8080`) and an IPv4-mapped address is unwrapped, so
 * one client cannot present itself under several spellings.
 */
const parseHop = (raw: string) => {
  let address = raw.trim().toLowerCase()
  if (address[0] === '[') {
    const close = address.indexOf(']')
    if (close < 0) return undefined
    address = address.slice(1, close)
  } else {
    const colon = address.indexOf(':')
    if (colon > 0 && address.includes('.') && address.indexOf(':', colon + 1) < 0) address = address.slice(0, colon)
  }
  if (address.startsWith('::ffff:') && address.includes('.')) address = address.slice(7)
  const bytes = ipBytes(address)
  return bytes && { address, bytes }
}

type Cidr = { bytes: Uint8Array; bits: number }
const parseCidr = (entry: string): Cidr => {
  const slash = entry.lastIndexOf('/')
  const suffix = slash < 0 ? undefined : entry.slice(slash + 1)
  const hop = parseHop(slash < 0 ? entry : entry.slice(0, slash))
  if (!hop) throw new SyntaxError(`trustProxy: '${entry}' is not an IP address or CIDR range`)
  const bits = suffix === undefined ? hop.bytes.length * 8 : Number(suffix)
  if (suffix !== undefined && (!/^\d+$/.test(suffix) || bits > hop.bytes.length * 8))
    throw new SyntaxError(`trustProxy: '${entry}' has an out-of-range prefix length`)
  return { bytes: hop.bytes, bits }
}
const inRange = (ip: Uint8Array, { bytes, bits }: Cidr) => {
  if (ip.length !== bytes.length) return false
  const whole = bits >> 3
  for (let i = 0; i < whole; i++) if (ip[i] !== bytes[i]) return false
  const rest = bits & 7
  return !rest || (ip[whole]! ^ bytes[whole]!) >> (8 - rest) === 0
}

/**
 * Compiles a `trustProxy` config into the per-request client address resolver.
 * The hop chain is the socket peer followed by the `X-Forwarded-For` entries
 * **right to left** — the rightmost entry is the nearest hop, and the only one
 * your own infrastructure wrote. A hop count discards that many entries; a list
 * of ranges discards hops it recognizes and stops at the first it does not.
 *
 * The socket peer wins whenever the chain cannot be walked as configured — an
 * unparseable hop, a header shorter than the hop count, more than
 * {@link MAX_FORWARDED_HOPS} hops — rather than falling through to the
 * leftmost, client-controlled entry. Config errors throw here, at boot.
 */
export const clientAddressResolver = (trustProxy?: false | number | string[]) => {
  const hops = typeof trustProxy === 'number' ? trustProxy : undefined
  if (hops !== undefined && (!Number.isInteger(hops) || hops < 0))
    throw new SyntaxError('trustProxy: hop count must be a positive integer')
  const trusted = Array.isArray(trustProxy) ? trustProxy.map(parseCidr) : undefined
  if (!hops && !trusted?.length) return (_req: Request, peer: string | null) => peer

  return (req: Request, peer: string | null) => {
    const socket = peer ? parseHop(peer) : undefined
    const header = req.headers.get('x-forwarded-for')
    if (!socket || !header) return peer
    let hop: { address: string; bytes: Uint8Array } | undefined
    let end = header.length
    for (let i = 0; i < MAX_FORWARDED_HOPS; i++) {
      // is the hop under examination one of ours? if not, it is the client
      if (hops !== undefined ? i >= hops : !trusted!.some(range => inRange((hop ?? socket).bytes, range)))
        return hop?.address ?? peer
      // out of entries: a hop count that overruns the header is a misconfiguration
      // and falls back, whereas an all-trusted chain leaves the leftmost entry
      if (end <= 0) return hops !== undefined ? peer : (hop?.address ?? peer)
      const comma = header.lastIndexOf(',', end - 1)
      const next = parseHop(header.slice(comma + 1, end))
      if (!next) return peer
      hop = next
      end = comma
    }
    return peer
  }
}
