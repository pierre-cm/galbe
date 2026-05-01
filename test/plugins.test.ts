import { expect, test, describe, afterEach, mock } from 'bun:test'
import { type Context, Galbe, type GalbePlugin, type Route } from '../src'

const port = 7361

describe('plugins', async () => {
  const galbe = new Galbe({
    plugin: {
      'dev.galbe.test.init': {
        message: 'Hello Mom!'
      }
    }
  })
  galbe.get('/plugin', ctx => ctx.query.param)
  galbe.get('/plugin/state', ctx => ctx.state)

  afterEach(() => {
    galbe.plugins = []
  })

  test('plugin init', async () => {
    let pluginConfig: any = null
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      init: mock(config => {
        pluginConfig = config
      })
    }

    await galbe.use(plugin)
    expect(plugin.init).toHaveBeenCalledTimes(0)

    await galbe.listen(port)
    expect(plugin.init).toHaveBeenCalledTimes(1)
    expect(pluginConfig).toEqual({ message: 'Hello Mom!' })
  })

  test('plugin onFetch, no return', async () => {
    let request: any = null
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      onFetch: mock(ctx => {
        request = ctx.request
      })
    }

    await galbe.use(plugin)
    await galbe.listen(port)

    expect(plugin.onFetch).toHaveBeenCalledTimes(0)

    const url = `http://localhost:${port}/plugin?param=hello`
    const resp = await fetch(url)

    expect(plugin.onFetch).toHaveBeenCalledTimes(1)
    expect(request).toMatchObject({
      method: 'GET',
      url: url
    })
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('hello')
  })

  test('plugin onFetch, return', async () => {
    let response = new Response('🫖', { status: 418 })
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      onFetch: mock(() => {
        return response
      })
    }

    await galbe.use(plugin)
    await galbe.listen(port)

    expect(plugin.onFetch).toHaveBeenCalledTimes(0)

    let resp = await fetch(`http://localhost:${port}/plugin`)

    expect(plugin.onFetch).toHaveBeenCalledTimes(1)
    expect(resp).toEqual(response)
  })

  test('plugin onRoute, no return', async () => {
    let route: Route | null = null
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      onRoute: mock(r => {
        route = r.route
      })
    }

    await galbe.use(plugin)
    await galbe.listen(port)

    expect(plugin.onRoute).toHaveBeenCalledTimes(0)

    let resp = await fetch(`http://localhost:${port}/plugin?param=hello`)

    expect(plugin.onRoute).toHaveBeenCalledTimes(1)
    expect(route).toMatchObject({
      method: 'get',
      path: `/plugin`,
      hooks: [],
      handler: () => {}
    })
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('hello')
  })

  test('plugin onRoute, return', async () => {
    let response = new Response('🫖', { status: 418 })
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      onRoute: mock(() => {
        return response
      })
    }

    await galbe.use(plugin)
    await galbe.listen(port)

    expect(plugin.onRoute).toHaveBeenCalledTimes(0)

    let resp = await fetch(`http://localhost:${port}/plugin`)

    expect(plugin.onRoute).toHaveBeenCalledTimes(1)
    expect(resp).toEqual(response)
  })

  test('plugin beforeHandle, no return', async () => {
    let context: Context | undefined
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      beforeHandle: mock((ctx: Context) => {
        context = ctx
      })
    }

    await galbe.use(plugin)
    await galbe.listen(port)

    expect(plugin.beforeHandle).toHaveBeenCalledTimes(0)

    const url = `http://localhost:${port}/plugin?param=hello`
    let resp = await fetch(url)

    expect(plugin.beforeHandle).toHaveBeenCalledTimes(1)
    expect(context?.request).toMatchObject({
      method: 'GET',
      url: url
    })
    expect(context?.query).toEqual({
      param: 'hello'
    })
    expect(context?.body).toBeNull()
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('hello')
  })

  test('plugin beforeHandle, return', async () => {
    let response = new Response('🫖', { status: 418 })
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      beforeHandle: mock(() => {
        return response
      })
    }

    await galbe.use(plugin)
    await galbe.listen(port)

    expect(plugin.beforeHandle).toHaveBeenCalledTimes(0)

    let resp = await fetch(`http://localhost:${port}/plugin`)

    expect(plugin.beforeHandle).toHaveBeenCalledTimes(1)
    expect(resp).toEqual(response)
  })

  test('plugin afterHandle, no return', async () => {
    let response: Response | undefined
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      afterHandle: mock((resp: Response) => {
        response = resp
      })
    }

    await galbe.use(plugin)
    await galbe.listen(port)

    expect(plugin.afterHandle).toHaveBeenCalledTimes(0)

    const url = `http://localhost:${port}/plugin?param=hello`
    let resp = await fetch(url)

    expect(plugin.afterHandle).toHaveBeenCalledTimes(1)
    expect(response).toEqual(resp)
  })

  test('plugin afterHandle, return', async () => {
    let response = new Response('🫖', { status: 418 })
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      afterHandle: mock(() => {
        return response
      })
    }

    await galbe.use(plugin)
    await galbe.listen(port)

    expect(plugin.afterHandle).toHaveBeenCalledTimes(0)

    let resp = await fetch(`http://localhost:${port}/plugin`)

    expect(plugin.afterHandle).toHaveBeenCalledTimes(1)
    expect(resp).toEqual(response)
  })

  test('plugin add state to context', async () => {
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      beforeHandle: mock((ctx: Context) => {
        ctx.state.foo = 'bar'
      })
    }

    await galbe.use(plugin)
    await galbe.listen(port)

    const url = `http://localhost:${port}/plugin/state`
    let resp = await fetch(url)

    expect(resp.status).toBe(200)
    expect(await resp.json()).toEqual({ foo: 'bar' })
  })

  test('afterHandle sees context.set.status set by handler when there are no hooks', async () => {
    // Previously, the no-hooks code path skipped the auto-status assignment
    // so afterHandle plugins observed `context.set.status === undefined` even
    // when the handler returned a Response with a specific status.
    galbe.get('/plugin/status', () => new Response('teapot', { status: 418 }))

    let observedStatus: number | undefined
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      afterHandle: mock((_resp: Response, ctx: Context) => {
        observedStatus = ctx.set.status
      })
    }

    await galbe.use(plugin)
    await galbe.listen(port)

    const resp = await fetch(`http://localhost:${port}/plugin/status`)
    expect(plugin.afterHandle).toHaveBeenCalledTimes(1)
    expect(observedStatus).toBe(418)
    expect(resp.status).toBe(418)
  })

  test('plugin onFetch errors flow through onError instead of bypassing user error handling', async () => {
    // Previously a throw inside onFetch ran outside the request try/catch and
    // hit Bun's top-level error handler, returning a generic 500 with no
    // chance for `onError` to intervene.
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.init',
      onFetch: mock(() => {
        throw new Error('boom')
      })
    }
    let onErrorCalled = 0
    galbe.onError(() => {
      onErrorCalled++
      return new Response('handled', { status: 503 })
    })

    await galbe.use(plugin)
    await galbe.listen(port)

    const resp = await fetch(`http://localhost:${port}/plugin`)
    expect(plugin.onFetch).toHaveBeenCalledTimes(1)
    expect(resp.status).toBe(503)
    expect(await resp.text()).toBe('handled')
    expect(onErrorCalled).toBe(1)

    galbe.errorCb = []
  })
})
