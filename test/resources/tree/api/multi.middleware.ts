import { $T, middleware, type Galbe } from '../../../../src'

// one file, several registrations at different scopes
export default (g: Galbe) => {
  g.middleware(middleware({ schema: { headers: { 'x-api': $T.optional($T.string()) } } }))
  g.middleware('/users/*', middleware({ schema: { query: { page: $T.optional($T.integer()) } } }))
}
