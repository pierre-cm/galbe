import { middleware } from '../../../src'

export default middleware({
  hooks: () => {
    ;(globalThis as any).__mwOrder?.push('log')
  },
})
