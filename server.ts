import { PType, parseEntry, requestBodyParser, requestPathParser, responseParser, validateBody } from '#/parser'
import { Context, Hook, Kadre, NotFoundError, RequestError, Route } from '#/types'

const textDecoder = new TextDecoder()

const handleInternalError = (error: any) => {
  console.error(error)
  return new RequestError({ status: 500, error: 'Internal Server Error' })
}

export default (kadre: Kadre, port?: number) => {
  const router = kadre.router
  return Bun.serve({
    port: port || 3000,
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
      for (const plugin of kadre.plugins) {
        let resp = plugin.fetch ? plugin.fetch(req, { kadre, context }) : null
        if (resp) return resp
      }
      const url = new URL(req.url)
      let route: Route
      let response: any = ''

      try {
        // find route
        if (url.pathname.match(new RegExp(`^\\/${kadre.config?.basePath || ''}`))) throw new NotFoundError()
        try {
          route = router.find(req.method, url.pathname)
        } catch (error) {
          if (error instanceof RequestError) throw error
          else throw handleInternalError(error)
        }

        // parse request
        const schema = route.schema
        let inHeaders = Object.fromEntries(req.headers.entries())
        let inQuery = Object.fromEntries(url.searchParams.entries())
        let inParams = requestPathParser(url.pathname, route.path)
        let inBody: string | undefined = ''
        if (req.body) for await (const chunk of req.body) inBody += textDecoder.decode(chunk)

        context.headers = { ...context.headers, ...inHeaders }
        context.query = inQuery
        context.params = inParams
        context.body = inBody ? requestBodyParser(inBody, inHeaders['content-type']) : null
        const hooks: Hook[] = []

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
        try {
          if (schema?.body) context.body = validateBody(context.body, schema.body as PType) ? context.body : undefined
        } catch (error) {
          if (error instanceof RequestError) errors.push(error)
          else throw handleInternalError(error)
        }
        if (errors.length) {
          throw new RequestError({ status: 400, error: errors.reduce((acc, c) => ({ ...acc, ...c.error }), {}) })
        }

        // call chain
        const callStack: number[] = []
        let callStackError: boolean = false
        const callChain = (hooks || []).map((hook, idx) => ({
          call: async () => {
            callStack.push(idx)
            await hook(context, async () => {
              await callChain[idx + 1].call()
            })
            if (callStack.pop() !== idx && !callStackError) {
              console.error('Call stack error')
              callStackError = true
            }
          }
        }))
        callChain.push({
          call: async () => {
            callStack.push(callChain.length - 1)
            response = await route.handler(context)
            callStack.pop()
          }
        })
        if (callChain.length > 1) await callChain[0].call()
        else response = await route.handler(context)
        if (callStackError) {
          context.set.status = 500
          throw new Response('Internal server error', { status: 500 })
        }

        const resp = responseParser(response)
        return new Response(resp.response, {
          status: context.set.status || 200,
          headers: { ...context.set.headers, 'Content-Type': resp.type }
        })
      } catch (error) {
        try {
          context.set.status = 500
          let response = responseParser(kadre.errorHandler(error, context))
          return new Response(response.response, {
            status: context.set.status,
            headers: { ...context.set.headers, 'Content-Type': response.type }
          })
        } catch (error) {
          console.error(error)
        }
        return new Response('Internal Server Error', { status: 500 })
      }
    },
    error(error) {
      console.error(error)
      return new Response('Inyernal Server Error', {
        status: 500,
        headers: {
          'Content-Type': 'text/plain'
        }
      })
    }
  })
}
