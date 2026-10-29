---
title: Headings
summary: How heading levels fit together.
---

A node's title is its heading. Holon writes it above the text when it renders the node, so the text never contains it, and a text whose first heading repeats the title is an error. The top headings of the text are the sections of the node, one level below the title, and the rest nest below them. Write them as if the file stood alone, and Holon fits the levels together with one rule: text put into other text starts one level below the last heading that other text wrote above it.

- `render(node)` returns the node with its title at level one and the top headings of its text at level two. A part without a title gets no heading written above it, so the top headings of its text come out at level one.
- A call's result starts one level below the heading above the call.
- What a function got from `render()` starts one level below the heading the function wrote above it, so a function can group what it renders under headings of its own.

Every heading ends up exactly one level below the heading it belongs to, so gaps close: a text with headings at `##` and `####` comes out the same as one with `#` and `##`. A heading underlined with `===` or `---` is an error. Markdown has six levels. Nesting deeper is an error.
