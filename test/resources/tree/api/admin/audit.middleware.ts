const audit1 = () => {
  ;(globalThis as any).__mwOrder?.push('audit1')
}
const audit2 = () => {
  ;(globalThis as any).__mwOrder?.push('audit2')
}

export default [audit1, audit2]
