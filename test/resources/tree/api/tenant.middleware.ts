import { $T, middleware } from '../../../../src'

export const scope = '/users/*'

export default middleware({
  schema: { headers: { 'x-tenant-id': $T.string() } },
  security: 'apiKey',
  hooks: ctx => {
    // typed by the fragment above, no annotation
    ctx.state.tenant = ctx.headers['x-tenant-id']
    ;(globalThis as any).__mwOrder?.push('tenant')
  },
})
