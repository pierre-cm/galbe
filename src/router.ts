import type { Method, Route, RouteNode } from './types'
import { MethodNotAllowedError, NotFoundError } from './types'

const ROUTE_REGEX = /^(\/(\*|:?\d+|:?\w+|:?[\w\d.][\w-.]+[\w\d]))*\/?$/

// null-prototype map: segments are looked up with `in`, a plain {} would collide
// with Object.prototype members (constructor, __proto__, toString, …)
const newChildren = (): Record<string, RouteNode> => Object.create(null)

// trailing slashes are ignored when matching: /tail and /tail/ resolve to the
// same route regardless of how the route was declared ('/' itself excepted)
const normalizePath = (path: string) => (path.length > 1 ? path.replace(/\/+$/g, '') || '/' : path)

const DEFAULT_CACHE_LIMIT = 1024

const walk = (path: string[], node: RouteNode, index: number = 0): RouteNode | null => {
  if (index === path.length - 1) {
    if (node.routes && !!Object.keys(node.routes).length) return node
    // /a/* should match /a — fall back to a wildcard child if the node has no
    // routes of its own.
    const wc = node.children?.['*']
    if (wc?.routes && !!Object.keys(wc.routes).length) return wc
    return null
  }

  const nextSegment = path[index + 1]

  // 1. Exact Match
  if (node.children && nextSegment !== undefined && nextSegment in node.children) {
    const r = walk(path, node.children[nextSegment]!, index + 1)
    if (r) return r
  }

  // 2. Param Match
  if (node.param) {
    const r = walk(path, node.param, index + 1)
    if (r) return r
  }

  // 3. Wildcard Match
  if (node.children && '*' in node.children) {
    const wc = node.children['*']
    const r = walk(path, wc, index + 1)
    if (r) return r
    // a wildcard with routes of its own swallows the remaining segments:
    // /a/* answers /a/b/c once the deeper walk found nothing
    if (wc.routes && !!Object.keys(wc.routes).length) return wc
  }

  return null
}

export class GalbeRouter {
  routes: RouteNode
  prefix: string
  cacheEnabled: boolean
  cacheLimit: number
  cachedRoutes: Map<string, Route | null>
  // registration-conflict warnings; injectable so tests can observe them. The
  // console.warn default is silenced in production, an injected hook is not.
  warn: (message: string) => void
  constructor(options?: {
    prefix?: string
    cacheEnabled?: boolean
    cacheLimit?: number
    warn?: (message: string) => void
  }) {
    this.routes = { routes: {} }
    let prefix = options?.prefix || ''
    if (prefix && !prefix.match(/^\//)) prefix = `/${prefix}`
    this.prefix = prefix
    this.cachedRoutes = new Map()
    this.cacheEnabled = options?.cacheEnabled ?? false
    this.cacheLimit = options?.cacheLimit ?? DEFAULT_CACHE_LIMIT
    this.warn = options?.warn ?? (message => Bun.env.BUN_ENV !== 'production' && console.warn(message))
  }
  // bounded LRU: gets refresh recency, sets evict the oldest entry once past
  // cacheLimit, so a flood of distinct lookups (including cached misses) can't
  // grow the map without bound
  private cacheGet(key: string): Route | null | undefined {
    if (!this.cachedRoutes.has(key)) return undefined
    const route = this.cachedRoutes.get(key) as Route | null
    this.cachedRoutes.delete(key)
    this.cachedRoutes.set(key, route)
    return route
  }
  private cacheSet(key: string, route: Route | null) {
    if (this.cachedRoutes.has(key)) this.cachedRoutes.delete(key)
    this.cachedRoutes.set(key, route)
    while (this.cachedRoutes.size > this.cacheLimit)
      this.cachedRoutes.delete(this.cachedRoutes.keys().next().value as string)
  }
  add(route: Route) {
    route.path = route?.path?.[0] === '/' ? route.path : `/${route.path}`
    if (!route.path.match(ROUTE_REGEX)) throw new SyntaxError(`${route.path} is not a valid route path.`)
    const isStatic = !route.path.match(/(:[\w\d-]+|\*)/)
    route.path = `${this.prefix || ''}${route.path}`
    if (isStatic) this.cacheSet(`[${route.method}]${normalizePath(route.path)}`, route)
    let path = route.path.replace(/^\/+|\/+$/g, '').split('/')
    if (path[0] === '') path.shift()
    let r = this.routes
    let walked = ''
    while (path.length) {
      let p = path.shift()
      if (p === undefined) break
      if (p.match(/^:/)) {
        // params sharing a trie node keep the first registered name: a later
        // registration with a different name lands on the same node
        if (!r.param) r.param = { routes: {}, paramName: p.slice(1) }
        else if (r.param.paramName !== p.slice(1))
          this.warn(
            `${walked}/${p} collides with ${walked}/:${r.param.paramName} — param routes share one trie node regardless of name`
          )
        r = r.param
      } else {
        if (!r.children) r.children = newChildren()
        if (!(p in r.children)) r.children[p] = { routes: {} }
        r = r.children[p]!
      }
      walked += `/${p}`
    }
    if (r.routes[route.method])
      this.warn(`route ${route.method.toUpperCase()} ${route.path} redefined — previous registration overwritten`)
    r.routes[route.method] = route
  }
  /**
   * Unregister a route. Identity-checked: the node's entry is only deleted when
   * it still holds this exact route object, so removing a route that was since
   * redefined leaves the newer registration in place.
   */
  remove(route: Route): boolean {
    let path = route.path.replace(/^\/+|\/+$/g, '').split('/')
    if (path[0] === '') path.shift()
    let r: RouteNode | undefined = this.routes
    for (const p of path) {
      if (p === '') break
      r = p.match(/^:/) ? r.param : r.children?.[p]
      if (!r) return false
    }
    if (r.routes[route.method] !== route) return false
    delete r.routes[route.method]
    for (const [key, cached] of this.cachedRoutes) if (cached === route) this.cachedRoutes.delete(key)
    return true
  }
  find(method: Method, path: string): Route {
    path = normalizePath(path)
    const staticRoute = this.cacheGet(`[${method}]${path}`)
    if (staticRoute === null) throw new NotFoundError()
    if (staticRoute !== undefined) return staticRoute
    let parts = path === '/' ? [''] : path.split('/')
    let r = walk(parts, this.routes)
    if (!r || !Object.keys(r.routes).length) {
      if (this.cacheEnabled) this.cacheSet(`[${method}]${path}`, null)
      throw new NotFoundError()
    }
    // RFC 9110 §9.3.3: HEAD is GET without a body. An explicit head route wins;
    // otherwise fall back to the get route (the server strips the response body).
    const route = (r.routes[method] ?? (method === 'head' ? r.routes.get : undefined)) as Route | undefined
    if (!route) {
      // RFC 9110 §15.5.6: a 405 must carry an Allow header listing the methods
      // the resource supports; HEAD is implicitly allowed whenever GET is.
      const allow = Object.keys(r.routes).map(m => m.toUpperCase())
      if ('get' in r.routes && !('head' in r.routes)) allow.push('HEAD')
      throw new MethodNotAllowedError(undefined, { allow: allow.join(', ') })
    }
    if (this.cacheEnabled) this.cacheSet(`[${method}]${path}`, route)
    return route
  }
}
