/**
 * @security bearerAuth
 * @tags api
 */
export default () => {
  ;(globalThis as any).__mwOrder?.push('auth')
}
