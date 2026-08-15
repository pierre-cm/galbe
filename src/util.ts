import type { Method, Route, RouteNode } from '.'
import type { RouteFileMeta, RouteMeta } from './routes'

const METHOD_COLOR: Record<string, string> = {
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
