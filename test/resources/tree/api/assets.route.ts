import type { Galbe } from '../../../../src'

export default (g: Galbe) => {
  g.static('/assets', 'test/resources/static')
}
