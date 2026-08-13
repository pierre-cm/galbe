import type { Galbe } from '../../../../src'

/**
 * @tags users
 */
export default (g: Galbe) => {
  /**
   * List users
   * @tags users
   */
  g.get('/users', () => [])

  g.get('/users/:id', ctx => ctx.params.id)

  // @galbe-ignore
  g.get('/secret', () => 'nope')

  // @galbe-hide
  g.get('/internal', () => 'internal')

  g.middleware(() => {
    ;(globalThis as any).__mwOrder?.push('infile')
  })
}
