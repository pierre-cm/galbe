import type { Kadre } from '../../src'

export default (k: Kadre) => {
  k.get('/one', _ => {})
  // Comment between enpoints
  k.post('/two', _ => {})

  k.put('/three', _ => {})
}
