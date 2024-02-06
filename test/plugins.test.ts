import { expect, test, describe, afterEach } from 'bun:test'
import { Kadre } from '../src'

const port = 7361

describe('hooks', async () => {
  const kadre = new Kadre({
    plugin: {
      'dev.kadre.test.init': {
        message: 'Hello Mom!'
      }
    }
  })
  kadre.get('/plugin', ctx => ctx.query.param)
  await kadre.listen(port)
  afterEach(() => {
    kadre.plugins = []
  })

  test('plugin init', async () => {
    let initCalled = 0
    let fetchCalled = 0
    let pluginConfig: any = null
    await kadre.use({
      name: 'dev.kadre.test.init',
      init: (_, config) => {
        initCalled++
        pluginConfig = config
      },
      fetch: () => {
        fetchCalled++
      }
    })
    expect(initCalled === 1)
    expect(fetchCalled === 0)
    expect(pluginConfig).toEqual({ message: 'Hello Mom!' })

    await fetch(`http://localhost:${port}/plugin`)

    expect(initCalled === 1)
    expect(fetchCalled === 1)
  })

  test('plugin, return', async () => {
    await kadre.use({
      name: 'dev.kadre.test.return',
      fetch: () => {
        return new Response('🫖', { status: 418 })
      }
    })

    let resp = await fetch(`http://localhost:${port}/plugin`)

    expect(resp.status).toBe(418)
    expect(await resp.text()).toBe('🫖')
  })

  test('plugin, conditional return', async () => {
    await kadre.use({
      name: 'dev.kadre.test.conditionalReturn',
      fetch: req => {
        const url = new URL(req.url)
        if (!url?.search) return new Response('plugin')
      }
    })

    let resp = await fetch(`http://localhost:${port}/plugin`)

    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('plugin')

    resp = await fetch(`http://localhost:${port}/plugin?param=handler`)

    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('handler')
  })

  test('plugin, define route', async () => {
    await kadre.use({
      name: 'dev.kadre.test.defineRoute',
      init: k => {
        k.get('/doc', () => 'Hello Mom!')
      },
      fetch: () => {}
    })

    let resp = await fetch(`http://localhost:${port}/doc`)

    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('Hello Mom!')
  })
})
