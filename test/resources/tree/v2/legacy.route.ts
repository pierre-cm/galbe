import type { Galbe } from '../../../../src'

/**
 * @prefix /legacy
 */
export default (g: Galbe) => {
  g.get('/old', () => 'old')
}
