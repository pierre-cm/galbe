import type { Context, Route } from './types'

import { InternalError, RequestError } from './types'
import { parseEntry, requestBodyParser, requestPathParser, responseParser } from './parser'
import { Galbe } from './index'

const handleInternalError = (error: any) => {
  console.error(error)
  return new InternalError()
}

const setupPluginCallbacks = (galbe: Galbe) => ({
  init: galbe.plugins.reduce((l: { name: string; cb: Function }[], p) => {
    if (p.init) l.push({ name: p.name, cb: p.init })
    return l
  }, []),
  onFetch: galbe.plugins.reduce((l: Function[], p) => {
    if (p.onFetch) l.push(p.onFetch)
    return l
  }, []),
  onRoute: galbe.plugins.reduce((l: Function[], p) => {
    if (p.onRoute) l.push(p.onRoute)
    return l
  }, []),
  beforeHandle: galbe.plugins.reduce((l: Function[], p) => {
    if (p.beforeHandle) l.push(p.beforeHandle)
    return l
  }, []),
  afterHandle: galbe.plugins.reduce((l: Function[], p) => {
    if (p.afterHandle) l.push(p.afterHandle)
    return l
  }, [])
})

export default async (galbe: Galbe, port?: number) => {
  const router = galbe.router
  if (galbe?.config?.basePath && galbe?.config?.basePath[0] !== '/')
    galbe.config.basePath = `/${galbe?.config?.basePath}`
  let pluginsCb = setupPluginCallbacks(galbe)
  for (const { name, cb } of pluginsCb.init) await cb(galbe?.config?.plugin?.[name], galbe)

  return Bun.serve({
    port: port || galbe.config?.port || 3000,
    async fetch(req) {
      const context: Context = {
        request: req,
        set: { headers: {} },
        headers: {},
        params: {},
        query: {},
        body: {},
        state: {}
      }
      for (const cb of pluginsCb.onFetch) {
        const r = await cb(req)
        if (r) return r
      }
      const url = new URL(req.url)
      let route: Route
      let response: any = ''
      try {
        // find route
        try {
          route = router.find(req.method, url.pathname)
        } catch (error) {
          if (error instanceof RequestError) throw error
          else throw handleInternalError(error)
        }

        for (const cb of pluginsCb.onRoute) {
          const r = await cb(route)
          if (r) return r
        }

        // parse request
        const schema = route.schema
        const inHeaders: Record<string, any> = {}
        for (let [k, v] of req.headers) inHeaders[k] = v
        let inQuery: Record<string, any> = {}
        for (let [k, v] of url.searchParams) inQuery[k] = v
        let inParams = requestPathParser(url.pathname, route.path)

        context.body = await requestBodyParser(req.body, inHeaders, schema.body)
        context.headers = inHeaders
        context.query = inQuery
        context.params = inParams

        // request validation
        let errors: RequestError[] = []
        try {
          if (schema?.headers)
            context.headers = {
              ...context.headers,
              ...parseEntry(context.headers, schema.headers, { name: 'headers', i: true })
            }
        } catch (error) {
          if (error instanceof RequestError) errors.push(error)
          else throw handleInternalError(error)
        }
        try {
          if (schema?.query) context.query = parseEntry(context.query, schema.query, { name: 'query' })
        } catch (error) {
          if (error instanceof RequestError) errors.push(error)
          else throw handleInternalError(error)
        }
        try {
          if (schema?.params) context.params = parseEntry(context.params, schema.params, { name: 'params' })
        } catch (error) {
          if (error instanceof RequestError) errors.push(error)
          else throw handleInternalError(error)
        }
        if (errors.length) {
          throw new RequestError({ status: 400, payload: errors.reduce((acc, c) => ({ ...acc, ...c.payload }), {}) })
        }

        for (const cb of pluginsCb.beforeHandle) {
          const r = await cb(context)
          if (r) return r
        }

        // call chain
        let handlerCalled = false
        const handlerWrapper = async (context: Context) => {
          handlerCalled = true
          return route.handler(context)
        }
        const callChain: { call: () => any }[] = route.hooks.map((hook, idx) => ({
          call: async () => {
            let nextCalled = false
            let next = async () => {
              if (nextCalled) console.error('Hook already called - ignored')
              else {
                nextCalled = true
                await callChain[idx + 1].call()
              }
            }
            let r = await hook(context, next)
            if (r) return r
            if (!nextCalled && !handlerCalled) await next()
          }
        }))
        callChain.push({
          call: async () => {
            response = await handlerWrapper(context)
            context.set.status = response instanceof Response ? response.status : 200
          }
        })
        if (callChain.length > 1) {
          let r = await callChain[0].call()
          if (r) response = r
        } else response = await handlerWrapper(context)

        const parsedResponse = responseParser(response, context)

        for (const cb of pluginsCb.afterHandle) {
          const r = await cb(parsedResponse)
          if (r) return r
        }

        return parsedResponse
      } catch (error) {
        context.set.status = error instanceof RequestError ? error.status : 500
        let customError
        if (galbe.errorHandler) customError = responseParser(galbe.errorHandler(error, context), context)
        if (customError) return customError
        if (error instanceof RequestError) {
          return new Response(JSON.stringify(error.payload), {
            status: error.status,
            headers: { 'Content-Type': 'application/json' }
          })
        }
        return new Response('"Internal Server Error"', {
          status: 500,
          headers: {
            'content-type': 'application/json'
          }
        })
      }
    },
    error(error) {
      console.error(error)
      return new Response('"Internal Server Error"', {
        status: 500,
        headers: {
          'content-type': 'application/json'
        }
      })
    }
  })
}
