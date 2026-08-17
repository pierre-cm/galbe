# Router

The Galbe router uses a hybrid approach to store and locate routes.

Static routes are kept in a `Map`, so any incoming request path matching a static route is resolved in constant time `O(1)`.

> [!NOTE]
> A static route is a route that doesn't contain any parameter (e.g. `:param`) or wildcard (`*`) segment.

All other routes are stored in a [Trie](https://en.wikipedia.org/wiki/Trie)-like data structure. The time complexity of the search in this case is `O(n)`, where `n` is the number of segments in the incoming request path.

## Matching precedence

When multiple routes could match a given request, Galbe resolves them with backtracking in the following priority: exact segment match → parameter match (`:param`) → wildcard match (`*`). Precedence is applied segment by segment: the router tries the exact child first and only falls back to `:param`, then `*`, when the branch it took dead-ends further down the path. So with `/user/admin` and `/user/:id` both registered, `/user/admin` wins for that exact path, while `/user/42` falls through to the parameter route.

A trailing `*` also matches the parent path (e.g. `/foo/*` matches both `/foo/bar` and `/foo`), and swallows any number of remaining segments when no deeper route matches, so `/foo/*` answers `/foo/bar/baz` too.

## Path normalization

Trailing slashes are ignored when matching: `/a` and `/a/` resolve to the same route, whichever of the two forms was registered. The root path `/` is special-cased and always refers to the root route.

> [!NOTE]
> Because both forms normalize to the same path, registering `/a` and `/a/` for the same method registers the _same_ route twice — the second overwrites the first and is reported as a [redefined route](#registration-conflicts).

## Registration conflicts

Two kinds of conflict are reported at registration time, on `stderr`, outside production (`BUN_ENV=production` silences them):

- **A redefined route** — registering the same method and path twice overwrites the first, silently before. `route GET /items redefined — previous registration overwritten`.
- **Colliding parameter names** — `/user/:id` and `/user/:name` are the _same_ trie node, and the first registered name wins for both. `/user/:name collides with /user/:id — param routes share one trie node regardless of name`.

Pass `router.warn` in the [Configuration](../reference/configuration.md#routerwarn) to route these somewhere else, or to turn them into errors.

## Caching

Galbe can cache resolved routes, so that a repeated request path skips the trie walk. Caching is **opt-in**: set `router.cacheEnabled` to `true` in the [Configuration](../reference/configuration.md#routercacheenabled) (default: `false`).

When caching is enabled, the router stores the resolved route for a given method and normalized path in a bounded LRU `Map`. Subsequent requests to the same path are then resolved in constant time `O(1)`. Both successful matches and 404 misses are cached, so a flood of unmatched paths doesn't pay for a walk every time. Once the cache reaches `router.cacheLimit` entries (default: `1024`), the least recently used entries are evicted, so it cannot grow without bound.

> [!NOTE]
> Static routes live in the same `Map`, but they are seeded there at registration time and served from it whether or not caching is enabled. `router.cacheEnabled` only changes how dynamic routes (`:param`, `*`) and misses are handled.

> [!IMPORTANT]
> The cache is not a free win. In microbenchmarks on a 50-route trie, a cache hit measured _slower_ than the walk it replaces (~1.8 M vs ~3.7 M ops/s): a lookup costs a key concatenation plus the LRU's delete/re-insert, while a shallow walk is a handful of property lookups. Either way route matching runs at over a million ops/s and is nowhere near being a bottleneck.
>
> Enable the cache for deep or heavily dynamic paths, where the walk is long enough to be worth skipping — and measure your own workload rather than assuming it helps. (Numbers measured over loopback with ±15–20 % cross-session variance: read the ordering as the signal, not the absolute values.)
