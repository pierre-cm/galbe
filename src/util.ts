import type { Method, Route, RouteNode, STBodyType } from '.'
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

export const softMerge = <T>(base: T, override: T): T => {
  for (const key in override) {
    if (override[key] instanceof Object && !(override[key] instanceof Array)) {
      if (!base[key]) Object.assign(base as any, { [key]: {} })
      softMerge(base[key], override[key])
    } else Object.assign(base as any, { [key]: override[key] })
  }
  return base
}
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
    let [_, summary, _description] = meta?.head?.match(/^([^\n]*)\n\n(.*)/) || []
    if (!summary) _description = meta?.head || ''
    routeLog = `[${color}${`${method.toUpperCase()}\x1b[0m]`.padEnd(12, ' ')} ${path
      .padEnd(format?.maxPathLength ?? path.length, ' ')
      .replaceAll(/:([^\/]+)/g, '\x1b[0;33m:$1\x1b[0m')}${(summary ? `  ${summary}` : '').replace(/\n/, '')}\x1b[0m`
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

const BA_HEADER = 'application/octet-stream'
const JSON_HEADER = 'application/json'
const TXT_HEADER_RX = /^text\//
const FORM_HEADER_RX = /^application\/x-www-form-urlencoded/
const MP_HEADER_RX = /^multipart\/form-data/

export const inferBodyType = (contentType?: string | null): STBodyType | undefined => {
  if (!contentType) return 'default'
  if (contentType === JSON_HEADER) return 'json'
  if (TXT_HEADER_RX.test(contentType)) return 'text'
  if (FORM_HEADER_RX.test(contentType)) return 'urlForm'
  if (MP_HEADER_RX.test(contentType)) return 'multipart'
  if (contentType === BA_HEADER) return 'byteArray'
  return 'default'
}

export const inferContentType = (bodyType?: string | undefined): string => {
  if (!bodyType) return 'default'
  if (bodyType === 'json') return JSON_HEADER
  if (bodyType === 'text') return 'text/plain'
  if (bodyType === 'urlForm') return 'application/x-www-form-urlencoded'
  if (bodyType === 'multipart') return 'multipart/form-data'
  if (bodyType === 'byteArray') return BA_HEADER
  return 'default'
}
