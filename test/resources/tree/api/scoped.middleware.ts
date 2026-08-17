import { middleware } from '../../../../src'

export const scope = '/users/*'

export default middleware({
  hooks: () => {
    ;(globalThis as any).__mwOrder?.push('scoped')
  },
})
