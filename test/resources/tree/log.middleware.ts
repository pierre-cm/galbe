export default () => {
  ;(globalThis as any).__mwOrder?.push('log')
}
