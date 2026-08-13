import type { Galbe } from '../../../../src'

/**
 * @prefix /
 */
export default (g: Galbe) => {
  g.get('/root', () => 'root')
}
