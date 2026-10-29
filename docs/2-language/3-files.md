---
title: Files
summary: Which nodes become files.
---

A node with `render_to` in its front matter becomes a file at that path inside the output folder:

```yaml
render_to: guides/setup.md
```

Holon renders these nodes and nothing else. Every other node appears only where a function renders it, which can be several places or none. A part cannot have `render_to`.
