import type { Kadre } from '../../src'
import { T } from '../../src'

/**
 * description
 * multiline
 * @tag test
 * ok
 */
export default (k: Kadre) => {
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
  k.get('/test/:param1', _ => {})

  // Comment between enpoints

  /**
   * @tags tag1, tag2, tag3
   * @summary short summary
   * @description longer description example
   * @body body descripton
   */
  k.post('/test', { body: T.Object({ foo: T.String() }) }, _ => {})

  /**
   * @tags tag1, tag2
   * @other Hello Mom!
   */
  k.put('/test', { body: T.Object({ foo: T.String() }) }, [() => {}], _ => {})
}
