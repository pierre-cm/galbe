import { middleware } from '../../../src'

// @galbe-ignore
export default middleware({
  hooks: () => {
    ;(globalThis as any).__mwOrder?.push('ignored')
  },
})
