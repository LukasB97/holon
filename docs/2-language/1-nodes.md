---
title: Nodes
summary: What functions see.
---

Every folder and every `.md` file in the source folder is a node. A folder's `index.md` holds the folder's own text, so from outside a folder looks like a file. Names starting with `.` are skipped, and so are folders with no `index.md` and no children.

A node is plain data:

| Field | Meaning |
| :-- | :-- |
| `path` | Path from the source folder: `/guides/setup.md`, or `/guides` for a folder |
| `meta` | The front matter |
| `title` | The `title` from the front matter, or `null` |
| `children` | The child nodes, sorted by name. Parts are not among them |
| `artifact` | The node's own output file from `render_to`, or `null` |
| `backlinks` | The nodes whose text links to this node |
| `at(path)` | The node at a path relative to this node's file, or from the source folder with a leading `/` |

The title names the node. Every node with text has one, unless it is a part. A name starting with `_` makes a node and everything inside it a part: a piece of text that belongs to the places that use it, not to the tree. The node is not among its folder's `children`, so a function that walks the tree never meets it. `at()` finds it, and it appears only where a function renders it. A part has no `render_to`, and a part that no function renders is an error, so no text lies around unused.

Front matter other than `title` and `render_to` means nothing to Holon. It is there for your functions to read.
