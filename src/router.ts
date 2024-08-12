import type { Method, Route, RouteNode } from './types'
import { MethodNotAllowedError, NotFoundError } from './types'

const ROUTE_REGEX = /^(\/(\*|:?\d+|:?\w+|:?[\w\d.][\w-.]+[\w\d]))*\/?$/

const walk = (path: string[], node: RouteNode, alts: RouteNode[] = []): RouteNode => {
  if (path.length < 1) throw new NotFoundError()
  if (path.length === 1 && node.routes && !!Object.keys(node.routes).length) return node

  if (node.children?.['*']) alts.push(node.children['*'])
  if (node.param) alts.push(node.param)

  if (node.children && path[1] in node.children) {
    path.shift()
    return walk(path, node.children[path[0]], alts)
  }
  if (node.param) {
    path.shift()
    alts.pop()
    return walk(path, node.param, alts)
  }
  if (alts.length > 1) {
    return walk(path, alts.pop() as RouteNode, alts)
  }
  if (alts.length === 1) {
    let lastAlt = alts.pop() as RouteNode
    try {
      return walk(path, lastAlt, alts)
    } catch (error) {
      if (error instanceof NotFoundError) {
        if (lastAlt?.routes) return lastAlt
      } else throw error
    }
  }

  throw new NotFoundError()
}

export class GalbeRouter {
  routes: RouteNode
  prefix: string
  cacheEnabled: boolean
  cachedRoutes: Map<string, Route | null>
  constructor(options?: { prefix?: string; cacheEnabled?: boolean }) {
    this.routes = { routes: {} }
    let prefix = options?.prefix || ''
    if (prefix && !prefix.match(/^\//)) prefix = `/${prefix}`
    this.prefix = prefix
    this.cachedRoutes = new Map()
    this.cacheEnabled = options?.cacheEnabled ?? false
  }
  add(route: Route) {
    route.path = route?.path?.[0] === '/' ? route.path : `/${route.path}`
    if (!route.path.match(ROUTE_REGEX)) throw new SyntaxError(`${route.path} is not a valid route path.`)
    const isStatic = !route.path.match(/(:[\w\d-]+|\*)/)
    if (isStatic) this.cachedRoutes.set(`[${route.method.toUpperCase()}]${route.path}`, route)
    route.path = `${this.prefix || ''}${route.path}`
    let path = route.path.replace(/^\/$(.*)\/?$/, '$1').split('/')
    path.shift()
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
            if (!r.children) r.children = {}
            if (!(p in r.children)) r.children[p] = { routes: {} }
            r.children[p].routes[route.method] = route
          }
        } else {
          if (p.match(/^:/)) {
            if (!r.param) r.param = { routes: {} }
            r = r.param
          } else {
            if (!r.children) r.children = {}
            if (!(p in r.children)) r.children[p] = { routes: {} }
            r = r.children[p]
          }
        }
      }
    }
  }
  find(method: Method, path: string): Route {
    const staticRoute = this.cachedRoutes.get(`[${method}]${path}`)
    if (staticRoute === null) throw new NotFoundError()
    if (staticRoute !== undefined) return staticRoute
    let parts = path === '/' ? [''] : path.split('/')
    let r = walk(parts, this.routes)
    if (!r || !Object.keys(r.routes).length) {
      if (this.cacheEnabled) this.cachedRoutes.set(`[${method}]${path}`, null)
      throw new NotFoundError()
    } else if (!(method in r.routes)) throw new MethodNotAllowedError()
    const route = r.routes[method] as Route
    if (this.cacheEnabled) this.cachedRoutes.set(`[${method}]${path}`, route)
    return route
  }
}
