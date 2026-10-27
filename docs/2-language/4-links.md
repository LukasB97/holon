---
summary: Where links point after compiling.
---

# Links

A link points to the same target in the output as in the source. Write it relative to its file, or from the source folder with a leading `/`. A link that a function writes resolves like a link in the node that contains the call.

- A link to a node points to where the node landed. That is its own file if it has `render_to`. Otherwise it is the file its text ended up in, at the node's own first heading. The text must be in exactly one place. Text that a function rendered and then dropped does not count.
- A link to any other file points to that file in the source folder. Holon copies nothing.
- A link to a `.md` file that is not a node is an error.

A fragment names one of the target node's own headings, by the anchor the heading has when the node stands alone. A link that is only a fragment, like `#setup`, points to a heading of the node it is written in. Reference links come out as inline links, each with the definition from its own node, and the definitions go.

The links in a node's text are the [backlinks](./1-nodes.md) of their targets. Links that only a function writes do not count, because backlinks are read before anything runs.
