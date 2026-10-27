---
summary: Functions worth copying.
---

# Essentials

Holon ships no functions. The ones this README is built with are in [holon.config.mjs](./holon.config.mjs). Copy what you need:

- `sections()` puts the children one after another, skipping those with their own file.
- `ref(path)` links to a node with its title as the text.
- `file(path)` prints the output path of a node with its own file.
- `backlinks()` lists the nodes that link here.
- `tree(path)` draws the folder below a path with each node's `summary`.
