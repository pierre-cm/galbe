export const scope = '/users/*'

export default () => {
  ;(globalThis as any).__mwOrder?.push('scoped')
}
