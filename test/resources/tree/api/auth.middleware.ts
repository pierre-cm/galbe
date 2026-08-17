import { middleware } from '../../../../src'

/**
 * @security bearerAuth
 * @tags api
 */
export default middleware({
  hooks: () => {
    ;(globalThis as any).__mwOrder?.push('auth')
  },
})
