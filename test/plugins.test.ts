import { expect, test, describe, afterEach, mock } from 'bun:test'
import { Context, Kadre, KadrePlugin, Route } from '../src'

const port = 7361

describe('plugins', async () => {
  const kadre = new Kadre({
    plugin: {
      'dev.kadre.test.init': {
        message: 'Hello Mom!'
      }
    }
  })
  kadre.get('/plugin', ctx => ctx.query.param)
  kadre.get('/plugin/state', ctx => ctx.state)

  afterEach(() => {
    kadre.plugins = []
  })

  test('plugin init', async () => {
    let pluginConfig: any = null
    const plugin: KadrePlugin = {
      name: 'dev.kadre.test.init',
      init: mock(config => {
        pluginConfig = config
      })
    }

    await kadre.use(plugin)
    expect(plugin.init).toHaveBeenCalledTimes(0)

    await kadre.listen(port)
    expect(plugin.init).toHaveBeenCalledTimes(1)
    expect(pluginConfig).toEqual({ message: 'Hello Mom!' })
  })

  test('plugin onFetch, no return', async () => {
    let request: any = null
    const plugin: KadrePlugin = {
      name: 'dev.kadre.test.init',
      onFetch: mock(req => {
        request = req
      })
    }

    await kadre.use(plugin)
    await kadre.listen(port)

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
    const plugin: KadrePlugin = {
      name: 'dev.kadre.test.init',
      onFetch: mock(() => {
        return response
      })
    }

    await kadre.use(plugin)
    await kadre.listen(port)

    expect(plugin.onFetch).toHaveBeenCalledTimes(0)

    let resp = await fetch(`http://localhost:${port}/plugin`)

    expect(plugin.onFetch).toHaveBeenCalledTimes(1)
    expect(resp).toEqual(response)
  })

  test('plugin onRoute, no return', async () => {
    let route: Route | null = null
    const plugin: KadrePlugin = {
      name: 'dev.kadre.test.init',
      onRoute: mock(r => {
        route = r
      })
    }

    await kadre.use(plugin)
    await kadre.listen(port)

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
    const plugin: KadrePlugin = {
      name: 'dev.kadre.test.init',
      onRoute: mock(() => {
        return response
      })
    }

    await kadre.use(plugin)
    await kadre.listen(port)

    expect(plugin.onRoute).toHaveBeenCalledTimes(0)

    let resp = await fetch(`http://localhost:${port}/plugin`)

    expect(plugin.onRoute).toHaveBeenCalledTimes(1)
    expect(resp).toEqual(response)
  })

  test('plugin beforeHandle, no return', async () => {
    let context: Context | undefined
    const plugin: KadrePlugin = {
      name: 'dev.kadre.test.init',
      beforeHandle: mock((ctx: Context) => {
        context = ctx
      })
    }

    await kadre.use(plugin)
    await kadre.listen(port)

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
    const plugin: KadrePlugin = {
      name: 'dev.kadre.test.init',
      beforeHandle: mock(() => {
        return response
      })
    }

    await kadre.use(plugin)
    await kadre.listen(port)

    expect(plugin.beforeHandle).toHaveBeenCalledTimes(0)

    let resp = await fetch(`http://localhost:${port}/plugin`)

    expect(plugin.beforeHandle).toHaveBeenCalledTimes(1)
    expect(resp).toEqual(response)
  })

  test('plugin afterHandle, no return', async () => {
    let response: Response | undefined
    const plugin: KadrePlugin = {
      name: 'dev.kadre.test.init',
      afterHandle: mock((resp: Response) => {
        response = resp
      })
    }

    await kadre.use(plugin)
    await kadre.listen(port)

    expect(plugin.afterHandle).toHaveBeenCalledTimes(0)

    const url = `http://localhost:${port}/plugin?param=hello`
    let resp = await fetch(url)

    expect(plugin.afterHandle).toHaveBeenCalledTimes(1)
    expect(response).toEqual(resp)
  })

  test('plugin afterHandle, return', async () => {
    let response = new Response('🫖', { status: 418 })
    const plugin: KadrePlugin = {
      name: 'dev.kadre.test.init',
      afterHandle: mock(() => {
        return response
      })
    }

    await kadre.use(plugin)
    await kadre.listen(port)

    expect(plugin.afterHandle).toHaveBeenCalledTimes(0)

    let resp = await fetch(`http://localhost:${port}/plugin`)

    expect(plugin.afterHandle).toHaveBeenCalledTimes(1)
    expect(resp).toEqual(response)
  })

  test('plugin add state to context', async () => {
    const plugin: KadrePlugin = {
      name: 'dev.kadre.test.init',
      beforeHandle: mock((ctx: Context) => {
        ctx.state.foo = 'bar'
      })
    }

    await kadre.use(plugin)
    await kadre.listen(port)

    const url = `http://localhost:${port}/plugin/state`
    let resp = await fetch(url)

    expect(resp.status).toBe(200)
    expect(await resp.json()).toEqual({ foo: 'bar' })
  })
})
