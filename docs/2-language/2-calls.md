---
summary: Code that runs.
---

# Calls

Code that starts with the word `holon` is a call. Holon evaluates the rest as a JavaScript expression and puts the resulting string in its place. A code span is a call on one line, a code block tagged `holon` is a call on several:

````md
See `holon ref("./setup.md")`.

```holon
node.children
  .map((child) => `- ${child.title}: ${child.meta.summary}`)
  .join("\n")
```
````

An expression sees `node`, the node whose text contains the call, `render`, and the functions from `holon.config.js`, or `holon.config.mjs`, in the source folder. That file exports one function. Holon calls it for every call with the same `node` and `render`, so the functions it returns know where they are used:

```js
export default ({ node, render }) => ({
  ref: (path) => `[${node.at(path).title}](${node.at(path).path})`,
});
```

`render(child)` returns a node's text with its own calls evaluated. Each node renders once. Rendering a node from inside itself is an error.

The text comes between two marker lines. Holon reads them to see where the text ends up and removes them at the end. A function may put a prefix in front of every line, like `> ` or the indent of a list item, but the marker lines must stay whole and on lines of their own. A node without text renders to an empty string without markers.

A call that stands alone in a paragraph, and every `holon` block, may return whole blocks with headings. A call inside text must return a single line. To show a call without running it, put it in a fenced code block, as on this page.
