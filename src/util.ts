import type { Route, RouteNode } from '.'
import type { RouteMeta } from './routes'

const METHOD_COLOR: Record<string, string> = {
  get: '\x1b[32m',
  post: '\x1b[34m',
  put: '\x1b[36m',
  patch: '\x1b[33m',
  delete: '\x1b[31m',
  options: ''
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

export const walkRoutes = (node: RouteNode, cb: (route: Route) => void) => {
  if (node?.route) cb(node.route)
  for (let c of Object.values(node?.children || {})) walkRoutes(c, cb)
  if (node?.param) walkRoutes(node.param, cb)
}

export const isIterator = (obj: any) => typeof obj?.next === 'function'
