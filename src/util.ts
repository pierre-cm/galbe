import type { Route, RouteNode, RouteTree } from '.'
import type { RouteMeta } from './routes'

const METHOD_COLOR: Record<string, string> = {
  get: '\x1b[32m',
  post: '\x1b[34m',
  put: '\x1b[36m',
  patch: '\x1b[33m',
  delete: '\x1b[31m',
  options: '',
  head: ''
}

export const logRoute = (
  r: { method: string; path: string },
  meta?: RouteMeta,
  format?: { maxPathLength?: number }
) => {
  let color = METHOD_COLOR?.[r.method] || ''
  console.log(
    `    [${color}${`${r.method.toUpperCase()}\x1b[0m]`.padEnd(12, ' ')} ${r.path
      .padEnd(format?.maxPathLength ?? r.path.length, ' ')
      .replaceAll(/:([^\/]+)/g, '\x1b[0;33m:$1\x1b[0m')}${meta?.head ? `  ${meta.head}` : ''}`
  )
}

export const walkRouteNode = (node: RouteNode, cb: (route: Route) => void) => {
  if (node?.route) cb(node.route)
  for (let c of Object.values(node?.children || {})) walkRouteNode(c, cb)
  if (node?.param) walkRouteNode(node.param, cb)
}

export const walkRoutes = (routes: RouteTree, cb: (route: Route) => void) => {
  Object.values(routes).forEach(node => walkRouteNode(node, cb))
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
  511: 'Network Authentication Required'
}
