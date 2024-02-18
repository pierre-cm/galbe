import type { Galbe } from '../../src'

export default (g: Galbe) => {
  g.get('/one', _ => {})
  // Comment between enpoints
  g.post('/two', _ => {})

  g.put('/three', _ => {})
}
