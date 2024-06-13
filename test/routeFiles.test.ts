import { expect, test, describe } from 'bun:test'
import { defineRoutes, metaAnalysis } from '../src/routes'
import { Galbe } from '../src'

describe('routeFiles', () => {
  test('meta analysis, empty', async () => {
    let meta = await metaAnalysis('./test/resources/test.route.empty.ts')
    expect(meta).toEqual({
      header: {},
      routes: {
        '/one': {
          get: {}
        },
        '/two': {
          post: {}
        },
        '/three': {
          put: {}
        }
      }
    })
  })

  test('meta analysis, comments', async () => {
    let meta = await metaAnalysis('./test/resources/test.route.comment.ts')
    expect(meta).toEqual({
      header: {
        head: 'description\nmultiline',
        tag: 'test'
      },
      routes: {
        '/test/:param1': {
          get: {
            head: 'This part\nhere',
            tags: 'tag1, tag2, tag3',
            summary: 'short summary',
            description: 'longer description example',
            deprecated: true,
            param: ['{path} param1 description', '{query} param2 description']
          }
        },
        '/test': {
          post: {
            tags: 'tag1, tag2, tag3',
            summary: 'short summary',
            description: 'longer description example',
            body: 'body descripton'
          },
          put: {
            tags: 'tag1, tag2',
            other: 'Hello Mom!'
          },
          patch: {
            head: 'patch method'
          },
          options: {
            head: 'options method'
          },
          delete: {
            head: 'delete method'
          },
          head: {
            head: 'head method'
          }
        }
      }
    })
  })

  test('define routes, no route', async () => {
    const k = new Galbe()
    await defineRoutes({}, k)
    expect(k.router.routes).toEqual({
      routes: {}
    })
  })

  test('define routes, no route (false)', async () => {
    const k = new Galbe({ routes: false })
    await defineRoutes({}, k)
    expect(k.router.routes).toEqual({
      routes: {}
    })
  })

  test('define routes, no route found', async () => {
    const k = new Galbe()
    await defineRoutes({ routes: 'unexisting_route' }, k)
    expect(k.router.routes).toEqual({
      routes: {}
    })
  })

  test('define routes, route.empty', async () => {
    const k = new Galbe()

    await defineRoutes({ routes: 'test/resources/test.route.empty.ts' }, k)

    const r = k.router.routes
    expect(r?.children?.one?.routes.get).toMatchObject({
      method: 'get',
      path: '/one',
      handler: () => {}
    })
    expect(r?.children?.two?.routes.post).toMatchObject({
      method: 'post',
      path: '/two',
      handler: () => {}
    })
    expect(r?.children?.three?.routes.put).toMatchObject({
      method: 'put',
      path: '/three',
      handler: () => {}
    })
    expect(k.meta).toMatchObject([
      {
        header: {},
        routes: {
          '/one': {
            get: {}
          },
          '/two': {
            post: {}
          },
          '/three': {
            put: {}
          }
        }
      }
    ])
    expect(k.meta?.[0].file).toMatch(/test\.route\.empty\.ts$/)
  })

  test('define routes, all', async () => {
    const k = new Galbe()

    await defineRoutes({ routes: ['test/resources/test.route.*.ts'] }, k)

    const r = k.router.routes
    expect(r?.children?.one?.routes.get).toMatchObject({
      method: 'get',
      path: '/one',
      handler: () => {}
    })
    expect(r?.children?.two?.routes.post).toMatchObject({
      method: 'post',
      path: '/two',
      handler: () => {}
    })
    expect(r?.children?.three?.routes.put).toMatchObject({
      method: 'put',
      path: '/three',
      handler: () => {}
    })
    expect(r?.children?.test?.param?.routes.get).toMatchObject({
      method: 'get',
      path: '/test/:param1',
      handler: () => {}
    })
    expect(r?.children?.test?.routes.post).toMatchObject({
      method: 'post',
      path: '/test',
      handler: () => {}
    })
    expect(r?.children?.test?.routes.put).toMatchObject({
      method: 'put',
      path: '/test',
      handler: () => {}
    })
    expect(r?.children?.test?.routes.patch).toMatchObject({
      method: 'patch',
      path: '/test',
      handler: () => {}
    })
    expect(r?.children?.test?.routes.options).toMatchObject({
      method: 'options',
      path: '/test',
      handler: () => {}
    })
    expect(r?.children?.test?.routes.delete).toMatchObject({
      method: 'delete',
      path: '/test',
      handler: () => {}
    })
    expect(r?.children?.test?.routes.head).toMatchObject({
      method: 'head',
      path: '/test',
      handler: () => {}
    })
    expect(k.meta?.sort((a, b) => (a.file < b.file ? 1 : -1))).toMatchObject([
      {
        header: {},
        routes: {
          '/one': {
            get: {}
          },
          '/two': {
            post: {}
          },
          '/three': {
            put: {}
          }
        }
      },
      {
        header: {
          head: 'description\nmultiline',
          tag: 'test'
        },
        routes: {
          '/test/:param1': {
            get: {
              head: 'This part\nhere',
              tags: 'tag1, tag2, tag3',
              summary: 'short summary',
              description: 'longer description example',
              deprecated: true,
              param: ['{path} param1 description', '{query} param2 description']
            }
          },
          '/test': {
            post: {
              tags: 'tag1, tag2, tag3',
              summary: 'short summary',
              description: 'longer description example',
              body: 'body descripton'
            },
            put: {
              tags: 'tag1, tag2',
              other: 'Hello Mom!'
            }
          }
        }
      }
    ])
    expect(k.meta?.[0].file).toMatch(/test\.route\..*$/)
    expect(k.meta?.[1].file).toMatch(/test\.route\..*$/)
  })
})
