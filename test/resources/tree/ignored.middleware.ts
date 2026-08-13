// @galbe-ignore
export default () => {
  ;(globalThis as any).__mwOrder?.push('ignored')
}
