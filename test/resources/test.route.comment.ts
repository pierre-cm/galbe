import type { Galbe } from '../../src'
import { $T } from '../../src'

/**
 * description
 * multiline
 * @tag test
 * ok
 */
export default (g: Galbe) => {
  /**
   * This part
   * here
   * @tags tag1, tag2, tag3
   * @summary short summary
   * @description longer description example
   * @deprecated
   * @param {path} param1 description
   * @param  {query} param2 description
   */
  g.get('/test/:param1', _ => {})

  // Comment between enpoints

  /**
   * @tags tag1, tag2, tag3
   * @summary short summary
   * @description longer description example
   * @body body descripton
   */
  g.post('/test', { body: $T.object({ foo: $T.string() }) }, _ => {})

  /**
   * @tags tag1, tag2
   * @other Hello Mom!
   */
  g.put('/test', { body: $T.object({ foo: $T.string() }) }, [() => {}], _ => {})
}
