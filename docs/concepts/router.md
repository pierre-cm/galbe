# Router

The Galbe router employs a hybrid approach to store and locate routes.
 
The static routes are maintained in a Map structure. This ensures that any incoming request path matching a static route is resolved in constant time `O(1)`.

> [!NOTE]
> A static route is a route that doesn't contain any parameter (e.g.,`:param`) or wildcards `*`.

All other routes are stored in a [Trie](https://en.wikipedia.org/wiki/Trie)-like data structure. The time complexity of the search operation in this case is `O(n)`, where `n` represents the number of segments in the incoming request path.

## Caching

To improve performance, Galbe can cache resolved routes. This is particularly useful for dynamic routes that are accessed frequently.

When caching is enabled, the router stores the resolved route for a given path in a Map. Subsequent requests to the same path are then resolved in constant time `O(1)`.

> [!TIP]
> You can enable route caching by setting `router.cacheEnabled` to `true` in the [Configuration](getting-started.md#configuration).
