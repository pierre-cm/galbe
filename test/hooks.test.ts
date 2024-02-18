import { expect, test, describe } from 'bun:test'
import { Galbe } from '../src'

const port = 7360

describe('hooks', async () => {
  const galbe = new Galbe()
  await galbe.listen(port)

  test('hooks, empty', async () => {
    galbe.get('/hooks/empty', [], () => 'handled')

    let resp = await fetch(`http://localhost:${port}/hooks/empty`, {
      method: 'GET'
    })
    expect(resp.status).toBe(200)
    expect(await resp?.text()).toBe('handled')
  })

  test('hooks, void', async () => {
    galbe.get('/hooks/void', [(_ctx, _next) => {}], () => 'handled')

    let resp = await fetch(`http://localhost:${port}/hooks/void`, {
      method: 'GET'
    })
    expect(resp.status).toBe(200)
    expect(await resp?.text()).toBe('handled')
  })

  test('hooks, called without next', async () => {
    let hookCalled = 0
    galbe.get(
      '/hooks/called',
      [
        _ => {
          hookCalled++
        }
      ],
      () => 'handled'
    )
    expect(hookCalled).toBe(0)
    let resp = await fetch(`http://localhost:${port}/hooks/called`, {
      method: 'GET'
    })
    expect(hookCalled).toBe(1)
    expect(resp.status).toBe(200)
    expect(await resp?.text()).toBe('handled')
  })

  test('hooks, called with next', async () => {
    let hookCalled = 0
    galbe.get(
      '/hooks/called',
      [
        async (_, next) => {
          hookCalled++
          await Bun.sleep(10)
          await next()
        }
      ],
      () => 'handled'
    )
    expect(hookCalled).toBe(0)
    let resp = await fetch(`http://localhost:${port}/hooks/called`, {
      method: 'GET'
    })
    expect(hookCalled).toBe(1)
    expect(resp.status).toBe(200)
    expect(await resp?.text()).toBe('handled')
  })

  test('hooks, wrapper hook', async () => {
    let before = 0
    let after = 0
    galbe.get(
      '/hooks/called',
      [
        async (_, next) => {
          before++
          await Bun.sleep(10)
          await next()
          after++
        }
      ],
      () => {
        expect(before).toBe(1)
        expect(after).toBe(0)
        return 'handled'
      }
    )
    expect(before).toBe(0)
    expect(after).toBe(0)
    let resp = await fetch(`http://localhost:${port}/hooks/called`, {
      method: 'GET'
    })
    expect(before).toBe(1)
    expect(after).toBe(1)
    expect(resp.status).toBe(200)
    expect(await resp?.text()).toBe('handled')
  })

  test('hooks, nested wrappers', async () => {
    let before1 = 0
    let after1 = 0
    let before2 = 0
    let after2 = 0
    galbe.get(
      '/hooks/called',
      [
        async (_, next) => {
          before1++
          await Bun.sleep(10)
          await next()
          after1++
        },
        async (_, next) => {
          before2++
          await Bun.sleep(10)
          await next()
          after2++
        }
      ],
      () => {
        expect(before1).toBe(1)
        expect(before2).toBe(1)
        expect(after1).toBe(0)
        expect(after2).toBe(0)
        return 'handled'
      }
    )
    expect(before1).toBe(0)
    expect(before2).toBe(0)
    expect(after1).toBe(0)
    expect(after2).toBe(0)
    let resp = await fetch(`http://localhost:${port}/hooks/called`, {
      method: 'GET'
    })
    expect(before1).toBe(1)
    expect(before2).toBe(1)
    expect(after1).toBe(1)
    expect(after2).toBe(1)
    expect(resp.status).toBe(200)
    expect(await resp?.text()).toBe('handled')
  })

  test('hooks, linear chaining', async () => {
    let hook1 = 0
    let hook2 = 0
    galbe.get(
      '/hooks/called',
      [
        async _ => {
          hook1++
          await Bun.sleep(10)
        },
        async _ => {
          hook2++
          await Bun.sleep(10)
        }
      ],
      () => {
        expect(hook1).toBe(1)
        expect(hook2).toBe(1)
        return 'handled'
      }
    )
    expect(hook1).toBe(0)
    expect(hook2).toBe(0)
    let resp = await fetch(`http://localhost:${port}/hooks/called`, {
      method: 'GET'
    })
    expect(hook1).toBe(1)
    expect(hook2).toBe(1)
    expect(resp.status).toBe(200)
    expect(await resp?.text()).toBe('handled')
  })
})
