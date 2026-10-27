---
summary: What functions see.
---

# Nodes

Every folder and every `.md` file in the source folder is a node. A folder's `index.md` holds the folder's own text, so from outside a folder looks like a file. Names starting with `.` are skipped, and so are folders without Markdown.

A node is plain data:

| Field | Meaning |
| :-- | :-- |
| `path` | Path from the source folder: `/guides/setup.md`, or `/guides` for a folder |
| `meta` | The front matter |
| `title` | The text of the first heading as written, or `null` |
| `children` | The child nodes, sorted by name |
| `artifact` | The node's own output file from `render_to`, or `null` |
| `backlinks` | The nodes whose text links to this node |
| `at(path)` | The node at a path relative to this node's file, or from the source folder with a leading `/` |

Front matter other than `render_to` means nothing to Holon. It is there for your functions to read.
