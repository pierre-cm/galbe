import { relative } from 'path'
import { watch } from 'chokidar'
import { Galbe, Route } from '../src'
import { logRoute, walkRoutes } from '../src/util'
import { RouteMeta, defineRoutes } from '../src/routes'

export { default as pckg } from '../package.json'

export const CWD = process.cwd()
export const WATCH_IGNORE = /\.galbe/

export const fmtVal = (v: any) => {
  if (typeof v === 'boolean') return `\x1b[3${v ? '2' : '1'}m${v}\x1b[0m`
  if (typeof v === 'string') return `\x1b[33m${v}\x1b[0m`
  if (typeof v === 'number') return `\x1b[36m${v}\x1b[0m`
  return v
}
export const fmtList = (l: any) => `[${l.map(v => fmtVal(v)).join(', ')}]`
export const fmtInterval = (a: any, b: any) => `[${fmtVal(a)}-${fmtVal(b)}]`

export const silentExec = async (fn: () => any) => {
  let consoleMock = Object.fromEntries(
    Object.entries(console)
      .filter(([_, v]) => typeof v === 'function')
      .map(([k, _]) => [k, () => {}])
  )
  const _console = console
  const _processStdoutWrite = process.stdout.write
  const _processStderrWrite = process.stderr.write
  //@ts-ignore
  global.console = consoleMock
  //@ts-ignore
  process.stdout.write = function () {}
  //@ts-ignore
  process.stderr.write = function () {}
  const r = await fn()
  global.console = _console
  process.stdout.write = _processStdoutWrite
  process.stderr.write = _processStderrWrite
  return r
}
export const watchDir = async (
  path: string,
  callback: (event: {
    path: string | null
    eventType: 'change' | 'add' | 'addDir' | 'unlink' | 'unlinkDir'
  }) => any | Promise<any>,
  options?: { ignore?: RegExp }
) => {
  let watcher = watch(path, {
    persistent: false,
    ignored: options?.ignore,
    ignoreInitial: true
  })
  watcher.on('all', async (eventType, filename) => {
    if (filename.match(WATCH_IGNORE)) return
    await callback({ path: filename.toString(), eventType })
  })
}
export const instanciateRoutes = async (g: Galbe) => {
  console.log('🏗️  \x1b[1;30mConstructing routes\x1b[0m\n')
  // Main thread routes definitions
  let hasMainRoutes = false
  walkRoutes(g.router.routes, r => {
    hasMainRoutes = true
    logRoute(r)
  })
  if (hasMainRoutes) process.stdout.write('\n')
  // Route Files Analysis
  let routes: Record<string, { route?: Route; meta?: RouteMeta; error?: any }[]> = {}
  let errors: Record<string, any> = {}
  await defineRoutes({ routes: g?.config?.routes }, g, ({ type, route, error, filepath, meta }) => {
    if (!filepath) return
    if (!(filepath in routes)) routes[filepath] = []
    if (type === 'add' && route && filepath) routes[filepath].push({ route, meta })
    if (type === 'error') errors[filepath] = error
  })
  for (let [fp, e] of Object.entries(routes)) {
    console.log(`\x1b\[0;36m    ${relative(CWD, fp)}\x1b[0m`)
    let maxPathLength = e.reduce((p, c) => {
      return Math.max(p, c.route?.path.length || 0)
    }, 0)
    for (let r of e) {
      if (r.route) logRoute(r.route, r.meta, { maxPathLength })
    }
    if (errors?.[fp]) {
      console.log(`\x1b\[0;31m    Error:\x1b[0m`)
      console.log(errors?.[fp])
    }
    process.stdout.write('\n')
  }
  console.log('\x1b[1;30m\x1b[32mdone\x1b[0m\n')
}

export const softMerge = (base, override) => {
  for (const key in override) {
    if (override[key] instanceof Object && !(override[key] instanceof Array)) {
      if (!base[key]) Object.assign(base, { [key]: {} })
      softMerge(base[key], override[key])
    } else Object.assign(base, { [key]: override[key] })
  }
  return base
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
  511: 'Network Authentication Required'
}
