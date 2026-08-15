# Router

The Galbe router uses a hybrid approach to store and locate routes.

Static routes are kept in a `Map`, so any incoming request path matching a static route is resolved in constant time `O(1)`.

> [!NOTE]
> A static route is a route that doesn't contain any parameter (e.g. `:param`) or wildcard (`*`) segment.

All other routes are stored in a [Trie](https://en.wikipedia.org/wiki/Trie)-like data structure. The time complexity of the search in this case is `O(n)`, where `n` is the number of segments in the incoming request path.

When multiple routes could match a given request, Galbe resolves them with backtracking in the following priority: exact segment match → parameter match (`:param`) → wildcard match (`*`). A trailing `*` also matches the parent path (e.g. `/foo/*` matches both `/foo/bar` and `/foo`).

## Registration conflicts

Two kinds of conflict are reported at registration time, on `stderr`, outside production (`BUN_ENV=production` silences them):

- **A redefined route** — registering the same method and path twice overwrites the first, silently before. `route GET /items redefined — previous registration overwritten`.
- **Colliding parameter names** — `/user/:id` and `/user/:name` are the *same* trie node, and the first registered name wins for both. `/user/:name collides with /user/:id — param routes share one trie node regardless of name`.

Pass `router.warn` in the [Configuration](../reference/configuration.md#routerwarn) to route these somewhere else, or to turn them into errors.

## Caching

To improve performance, Galbe can cache resolved routes. This is particularly useful for dynamic routes that are accessed frequently.

When caching is enabled, the router stores the resolved route for a given path in a bounded LRU `Map`. Subsequent requests to the same path are then resolved in constant time `O(1)`. Both successful matches and 404 misses are cached. Once the cache reaches `router.cacheLimit` entries (default: `1024`), the least recently used entries are evicted, so a flood of distinct paths cannot exhaust memory.

> [!TIP]
> You can enable route caching by setting `router.cacheEnabled` to `true` in the [Configuration](../reference/configuration.md#routercacheenabled).
