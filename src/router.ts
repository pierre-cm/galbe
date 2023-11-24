import { NotFoundError, Route, RouteNode, RouteTree } from './types'

const walkRoutes = (path: string[], node: RouteNode): RouteNode => {
  if (path.length < 1) throw new NotFoundError()
  if (path.length === 1 && node.route) return node
  if (node.children && path[1] in node.children) {
    path.shift()
    return walkRoutes(path, node.children[path[0]])
  }
  if (node.param) {
    path.shift()
    try {
      return walkRoutes(path, node.param)
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error
      else console.log(error)
    }
  }
  if (node.children && '*' in node.children && node.children['*']) return node.children['*']
  throw new NotFoundError()
}

export class KadreRouter {
  routes: RouteTree
  prefix: string
  constructor(prefix?: string) {
    this.routes = { GET: {}, POST: {}, PUT: {}, PATCH: {}, DELETE: {} }
    prefix = prefix || ''
    if (prefix && !prefix.match(/^\//)) prefix = `/${prefix}`
    this.prefix = prefix
  }
  add(route: Route) {
    route.path = `${this.prefix || ''}${route.path}`
    let path = route.path.replace(/^\/$(.*)\/?$/, '$1').split('/')
    path.shift()
    let r = this.routes[route.method.toUpperCase()]
    while (path.length) {
      let p = path.shift()
      if (p === undefined) break
      if (!path.length) {
        if (p.match(/^:/)) r.param = { route }
        else {
          if (!r.children) r.children = {}
          r.children[p] = { route }
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
  find(method: string, path: string) {
    let parts = path.replace(/^\/$(.*)\/?$/, '$1').split('/')
    const route = walkRoutes(parts, this.routes[method]).route
    if (!route) throw new NotFoundError()
    return route
  }
}
