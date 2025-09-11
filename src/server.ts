import type { Context, Method, Route } from './types'

import { InternalError, RequestError } from './types'
import { parseEntry, requestBodyParser, requestPathParser, responseParser } from './parser'
import { Galbe } from './index'
import { validateResponse } from './validator'
import { inferBodyType } from './util'

type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
const EMPTY_BODY_METHODS = ['GET', 'OPTIONS', 'HEAD']

const handleInternalError = (error: any) => {
  console.error(error)
  return new InternalError()
}

const setupPluginCallbacks = (galbe: Galbe) => ({
  onFetch: galbe.plugins.filter(p => p.onFetch),
  onRoute: galbe.plugins.filter(p => p.onRoute),
  beforeHandle: galbe.plugins.filter(p => p.beforeHandle),
  afterHandle: galbe.plugins.filter(p => p.afterHandle),
})

export default async (galbe: Galbe, port?: number, hostname?: string) => {
  const router = galbe.router
  if (galbe?.config?.basePath && galbe?.config?.basePath[0] !== '/')
    galbe.config.basePath = `/${galbe?.config?.basePath}`
  let pluginsCb = setupPluginCallbacks(galbe)

  const server = Bun.serve({
    port: port || galbe.config?.port || 3000,
    reusePort: galbe?.config?.reusePort,
    hostname: hostname || galbe.config?.hostname || 'localhost',
    tls: galbe.config?.tls,

    async fetch(req) {
      if (!METHODS.includes(req.method)) return new Response('', { status: 501 })
      const context = {
        request: req,
        contentType: !EMPTY_BODY_METHODS.includes(req.method)
          ? inferBodyType(req.headers.get('content-type'))
          : undefined,
        remoteAddress: server.requestIP(req),
        set: { headers: { 'set-cookie': [] } },
        state: {},
      } as MakeOptional<Context, 'headers' | 'params' | 'query' | 'body'>
      for (const p of pluginsCb.onFetch) {
        //@ts-ignore
        const r = await p.onFetch(context)
        if (r) return r
      }
      const url = new URL(req.url)
      let route: Route
      let response: any = ''
      try {
        // find route
        try {
          route = router.find(req.method.toLowerCase() as Method, url.pathname)
        } catch (error) {
          if (error instanceof RequestError) throw error
          else throw handleInternalError(error)
        }
        context.route = route

        for (const p of pluginsCb.onRoute) {
          //@ts-ignore
          const r = await p.onRoute(context)
          if (r) return r
        }

        // parse request
        const schema = route.schema
        const inHeaders: Record<string, any> = {}
        for (let [k, v] of req.headers) inHeaders[k] = v
        let inQuery: Record<string, any> = {}
        for (let [k, v] of url.searchParams) {
          if (k in inQuery) {
            const cur = inQuery[k]
            if (Array.isArray(cur)) inQuery[k] = [...cur, v]
            else inQuery[k] = [cur, v]
          } else inQuery[k] = v
        }
        let inParams = requestPathParser(url.pathname, route.path)

        context.body = await requestBodyParser(req.body, inHeaders, schema.body, context.contentType)
        context.headers = inHeaders
        context.query = inQuery
        context.params = inParams

        // request validation
        if (galbe.config?.requestValidator?.enabled !== false) {
          let errors: RequestError[] = []
          try {
            if (schema?.headers)
              context.headers = {
                ...context.headers,
                ...parseEntry(context.headers, schema.headers, { name: 'headers', i: true }),
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
        }

        for (const p of pluginsCb.beforeHandle) {
          //@ts-ignore
          const r = await p.beforeHandle(context)
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
                return await callChain[idx + 1].call()
              }
            }
            let r = await hook(context as Context, next)
            if (r) return r
            if (!nextCalled && !handlerCalled) return await next()
          },
        }))
        callChain.push({
          call: async () => {
            response = await handlerWrapper(context as Context)
            context.set.status = response instanceof Response ? response.status : context.set.status || 200
          },
        })
        if (callChain.length > 1) {
          let r = await callChain[0].call()
          if (r) response = r
        } else response = await handlerWrapper(context as Context)

        const parsedResponse = responseParser(response, context as Context, schema.response)

        if (galbe.config?.responseValidator?.enabled !== false && schema.response)
          validateResponse(response, schema.response, parsedResponse.status || 200)

        for (const p of pluginsCb.afterHandle) {
          //@ts-ignore
          const r = await p.afterHandle(parsedResponse, context)
          if (r) return r
        }

        return parsedResponse
      } catch (error) {
        context.set.status = error instanceof RequestError ? error.status : 500
        let customError
        for (let eh of galbe.errorCb) customError = responseParser(eh(error, context as Context), context as Context)
        if (customError) return customError
        if (error instanceof InternalError) {
          console.log(`Internal Error`, error?.payload || '')
          return new Response('Internal Server Error', {
            status: error.status,
            headers: { 'Content-Type': 'application/json' },
          })
        } else if (error instanceof RequestError) {
          let payload = error.payload
          let headers = new Headers(error?.headers || {})
          if (!headers.has('content-type')) {
            if (typeof error.payload === 'string') headers.set('content-type', 'text/plain')
            else {
              headers.set('content-type', 'application/json')
              try {
                payload = JSON.stringify(error.payload)
              } catch (err) {}
            }
          }
          return new Response(payload, {
            status: error.status,
            headers,
          })
        } else console.log(error)
        return new Response('"Internal Server Error"', {
          status: 500,
          headers: {
            'content-type': 'application/json',
          },
        })
      }
    },
    error(error) {
      console.error(error)
      return new Response('"Internal Server Error"', {
        status: 500,
        headers: {
          'content-type': 'application/json',
        },
      })
    },
  })
  return server
}
