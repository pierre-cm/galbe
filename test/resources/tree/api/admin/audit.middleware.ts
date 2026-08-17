import type { Galbe } from '../../../../../src'

const audit1 = () => {
  ;(globalThis as any).__mwOrder?.push('audit1')
}
const audit2 = () => {
  ;(globalThis as any).__mwOrder?.push('audit2')
}

// registration function form: a scoped registrar, like a route file gets
export default (g: Galbe) => {
  g.middleware({ hooks: [audit1, audit2] })
}
