import type { Context, Method, Route } from './types'

import { InternalServerError, RequestError } from './types'
import { parseEntry, requestBodyParser, requestPathParser, responseParser } from './parser'
import { Galbe } from './index'
import { validateResponse } from './validator'
const normalizeContentType = (ct: string | null): string | undefined =>
  ct ? ct.split(';')[0].trim() || undefined : undefined
import { readCookies, stringifyCookie } from './cookies'

type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
const EMPTY_BODY_METHODS = ['GET', 'OPTIONS', 'HEAD']

const handleInternalError = (error: any) => {
  console.error(error)
  return new InternalServerError()
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

  // config.server is passed through to Bun.serve; port/fetch/error are owned by
  // Galbe and the dedicated config keys (port, hostname, reusePort, tls) win
  const serverOptions: Record<string, any> = { ...galbe.config?.server }
  delete serverOptions.port
  delete serverOptions.fetch
  delete serverOptions.error

  const server = Bun.serve({
    ...serverOptions,
    port: port || galbe.config?.port || 3000,
    reusePort: galbe?.config?.reusePort ?? serverOptions.reusePort,
    hostname: hostname || galbe.config?.hostname || serverOptions.hostname || 'localhost',
    tls: galbe.config?.tls ?? serverOptions.tls,

    async fetch(req) {
      if (!METHODS.includes(req.method)) return new Response('', { status: 501 })
      const cookies: string[] = []
      const context = {
        request: req,
        contentType: !EMPTY_BODY_METHODS.includes(req.method)
          ? normalizeContentType(req.headers.get('content-type'))
          : undefined,
        remoteAddress: server.requestIP(req),
        set: {
          headers: { 'set-cookie': [] },
          cookie: (name, value, opt = { path: '/' }) => cookies.push(stringifyCookie(name, value, opt)),
        },
        state: {},
        cookies: readCookies(req.headers.get('cookie')),
      } as MakeOptional<Context, 'headers' | 'params' | 'query' | 'body'>
      const url = new URL(req.url)
      let route: Route
      let response: any = ''
      try {
        for (const p of pluginsCb.onFetch) {
          //@ts-ignore
          const r = await p.onFetch(context)
          if (r) return r
        }
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
        // null-prototype maps: keys are untrusted, a plain {} would collide with
        // Object.prototype members (constructor, __proto__, toString, …)
        const inHeaders: Record<string, any> = Object.create(null)
        for (let [k, v] of req.headers) inHeaders[k] = v
        let inQuery: Record<string, any> = Object.create(null)
        for (let [k, v] of url.searchParams) {
          if (k in inQuery) {
            const cur = inQuery[k]
            if (Array.isArray(cur)) inQuery[k] = [...cur, v]
            else inQuery[k] = [cur, v]
          } else inQuery[k] = v
        }
        let inParams = requestPathParser(url.pathname, route.path)

        context.body = await requestBodyParser(
          req.body,
          inHeaders,
          EMPTY_BODY_METHODS.includes(req.method) ? undefined : schema.body,
          context.contentType
        )
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
        const r = await callChain[0].call()
        if (r) response = r
        if (context.set.status === undefined)
          context.set.status = response instanceof Response ? response.status : 200

        const parsedResponse = responseParser(response, context as Context, cookies, schema.response)

        if (galbe.config?.responseValidator?.enabled !== false && schema.response && !(response instanceof Response))
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
        for (let eh of galbe.errorCb) {
          const result = await eh(error, context as Context)
          if (result === undefined) continue
          customError = responseParser(result, context as Context, cookies)
          break
        }
        if (customError) return customError
        if (error instanceof InternalServerError) {
          let internalPayload = 'Internal Server Error'
          try { internalPayload = JSON.stringify(error?.payload || internalPayload) } catch {}
          return new Response(internalPayload, {
            status: error.status,
            headers: { 'content-type': 'application/json' },
          })
        } else if (error instanceof RequestError) {
          let payload = error.payload
          let headers = new Headers({ ...context.set.headers, ...error?.headers })
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
