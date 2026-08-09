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

const walk = (path: string[], node: RouteNode, index: number = 0): RouteNode => {
  if (index === path.length - 1) {
    if (node.routes && !!Object.keys(node.routes).length) return node
    // /a/* should match /a — fall back to a wildcard child if the node has no
    // routes of its own.
    const wc = node.children?.['*']
    if (wc?.routes && !!Object.keys(wc.routes).length) return wc
    throw new NotFoundError()
  }

  const nextSegment = path[index + 1]

  // 1. Exact Match
  if (node.children && nextSegment !== undefined && nextSegment in node.children) {
    try {
      return walk(path, node.children[nextSegment]!, index + 1)
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error
    }
  }

  // 2. Param Match
  if (node.param) {
    try {
      return walk(path, node.param, index + 1)
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error
    }
  }

  // 3. Wildcard Match
  if (node.children && '*' in node.children) {
    try {
      return walk(path, node.children['*'], index + 1)
    } catch (error) {
      if (error instanceof NotFoundError) {
        if (node.children['*'].routes && !!Object.keys(node.children['*'].routes).length) {
          return node.children['*']
        }
      }
      if (!(error instanceof NotFoundError)) throw error
    }
  }

  throw new NotFoundError()
}

export class GalbeRouter {
  routes: RouteNode
  prefix: string
  cacheEnabled: boolean
  cacheLimit: number
  cachedRoutes: Map<string, Route | null>
  constructor(options?: { prefix?: string; cacheEnabled?: boolean; cacheLimit?: number }) {
    this.routes = { routes: {} }
    let prefix = options?.prefix || ''
    if (prefix && !prefix.match(/^\//)) prefix = `/${prefix}`
    this.prefix = prefix
    this.cachedRoutes = new Map()
    this.cacheEnabled = options?.cacheEnabled ?? false
    this.cacheLimit = options?.cacheLimit ?? DEFAULT_CACHE_LIMIT
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
    if (!path.length) {
      r.routes[route.method] = route
    } else {
      while (path.length) {
        let p = path.shift()
        if (p === undefined) break
        if (!path.length) {
          if (p.match(/^:/)) {
            if (!r.param) r.param = { routes: {} }
            r.param.routes[route.method] = route
          } else {
            if (!r.children) r.children = newChildren()
            if (!(p in r.children)) r.children[p] = { routes: {} }
            r.children[p]!.routes[route.method] = route
          }
        } else {
          if (p.match(/^:/)) {
            if (!r.param) r.param = { routes: {} }
            r = r.param
          } else {
            if (!r.children) r.children = newChildren()
            if (!(p in r.children)) r.children[p] = { routes: {} }
            r = r.children[p]!
          }
        }
      }
    }
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
    } else if (!(method in r.routes)) throw new MethodNotAllowedError()
    const route = r.routes[method] as Route
    if (this.cacheEnabled) this.cacheSet(`[${method}]${path}`, route)
    return route
  }
}
