# Router

Galbe router employs a hybrid approach to store and locate routes.

The static routes are maintained in a Map structure. This ensures that any incoming request path matching a static route is resolved in a constant time `O(1)`.

> [!NOTE]
> A static route is a route that doesn't contain any parameter (e.g.,`:param`) or wildcards `*`.

All other routes are stored in a [Trie](https://en.wikipedia.org/wiki/Trie)-like data structure. The time complexity of the search operation in this case is `O(n)`, where `n` represents the number of segments in the incoming request path.
