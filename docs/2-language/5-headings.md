---
summary: How heading levels fit together.
---

# Headings

Write every file as if it stood alone, starting at `#`. A heading underlined with `===` or `---` is an error. Holon fits the levels together with one rule: text put into other text starts one level below the last heading that other text wrote above it.

- `render(node)` returns the node with its top headings at level one.
- A call's result starts one level below the heading above the call.
- What a function got from `render()` starts one level below the heading the function wrote above it, so a function can group what it renders under headings of its own.

Every heading ends up exactly one level below the heading it belongs to, so gaps close: a file using only `##` and `####` comes out as `#` and `##`. Markdown has six levels. Nesting deeper is an error.
