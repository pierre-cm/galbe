import type { Galbe } from '../../../../../src'

export default (g: Galbe) => {
  g.get('/stats', () => 'stats')
}
