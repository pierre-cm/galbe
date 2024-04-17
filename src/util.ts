import type { RouteFileMeta } from './routes'

const METHOD_COLOR: Record<string, string> = {
  get: '\x1b[32m',
  post: '\x1b[34m',
  put: '\x1b[36m',
  patch: '\x1b[33m',
  delete: '\x1b[31m',
  options: ''
}

export const extractMetaRoute = (route: { path: string; method: string }, meta?: Array<RouteFileMeta>) => {
  return meta?.map(e => (route.path in e.routes ? e.routes[route.path]?.[route.method] : null)).filter(e => e)?.[0]
}

export const logRoute = (
  r: { method: string; path: string },
  meta?: Record<string, boolean | string | string[]> | null
) => {
  let color = METHOD_COLOR?.[r.method] || ''
  console.log(
    `    [${color}${`${r.method.toUpperCase()}\x1b[0m]`.padEnd(12, ' ')} ${r.path}${
      meta?.head ? ` - ${meta.head}` : ''
    }`
  )
}

export const isIterator = (obj: any) => typeof obj?.next === 'function'
