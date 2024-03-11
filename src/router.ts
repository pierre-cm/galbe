import type { Route, RouteNode, RouteTree } from './types'
import { NotFoundError } from './types'

const ROUTE_REGEX = /^(\/(\*|:?\d+|:?\w+|:?[\w\d][\w-]+[\w\d]))*\/?$/

const walkRoutes = (path: string[], node: RouteNode, alts: RouteNode[] = []): RouteNode => {
  if (path.length < 1) throw new NotFoundError()
  if (path.length === 1 && node.route) return node

  if (node.children?.['*']) alts.push(node.children['*'])
  if (node.param) alts.push(node.param)

  if (node.children && path[1] in node.children) {
    path.shift()
    return walkRoutes(path, node.children[path[0]], alts)
  }
  if (node.param) {
    path.shift()
    alts.pop()
    try {
      return walkRoutes(path, node.param, alts)
    } catch (error) {
      if (error instanceof NotFoundError) console.log(error)
      else throw error
    }
  }
  if (alts.length > 1) {
    return walkRoutes(path, alts.pop() as RouteNode, alts)
  }
  if (alts.length === 1) {
    let lastAlt = alts.pop() as RouteNode
    try {
      return walkRoutes(path, lastAlt, alts)
    } catch (error) {
      if (error instanceof NotFoundError) {
        if (lastAlt?.route) return lastAlt
      } else throw error
    }
  }

  throw new NotFoundError()
}

export class GalbeRouter {
  routes: RouteTree
  prefix: string
  cacheEnabled: boolean
  cachedRoutes: Map<string, Route | null>
  constructor(options?: { prefix?: string; cacheEnabled?: boolean }) {
    this.routes = { GET: {}, POST: {}, PUT: {}, PATCH: {}, DELETE: {}, OPTIONS: {} }
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
    let r = this.routes[route.method.toUpperCase()]
    if (!path.length) {
      r.route = route
    } else {
      while (path.length) {
        let p = path.shift()
        if (p === undefined) break
        if (!path.length) {
          if (p.match(/^:/)) r.param = { route }
          else {
            if (!r.children) r.children = {}
            r.children[p] = { ...r.children[p], route }
          }
        } else {
          if (p.match(/^:/)) {
            if (!r.param) r.param = {}
            r = r.param
          } else {
            if (!r.children) r.children = {}
            if (!(p in r.children)) r.children[p] = {}
            r = r.children[p]
          }
        }
      }
    }
  }
  find(method: string, path: string) {
    const staticRoute = this.cachedRoutes.get(`[${method}]${path}`)
    if (staticRoute === null) throw new NotFoundError()
    if (staticRoute !== undefined) return staticRoute
    let parts = path.split('/')
    const route = walkRoutes(parts, this.routes[method]).route
    if (!route) {
      if (this.cacheEnabled) this.cachedRoutes.set(`[${method}]${path}`, null)
      throw new NotFoundError()
    }
    if (this.cacheEnabled) this.cachedRoutes.set(`[${method}]${path}`, route)
    return route
  }
}
