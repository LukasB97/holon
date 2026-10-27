# Holon

Holon compiles a folder of small Markdown files into the documents people read.

## The idea

In a folder of Markdown files, the file you maintain is the file someone reads. The two jobs pull in different directions. Maintaining wants small files that each hold one thing in one place. Reading wants a few complete documents, shaped for whoever opens them.

Holon separates the two. You write a tree of small files. Functions you write project that tree into the documents you publish. Holon runs the functions, fits the heading levels together and keeps every link pointing at the right place.

A product described in three files:

```text
docs/
  holon.config.js
  index.md
  billing.md
  login.md
```

`index.md` says where it goes and pulls in its children:

```md
---
render_to: README.md
---
# Product

## Features

`holon sections()`
```

`holon.config.js` defines what `sections` means:

```js
export default ({ node, render }) => ({
  sections: () => node.children.map(render).join("\n\n"),
});
```

`billing.md` and `login.md` are plain Markdown, each starting with its own `#` heading. Holon writes one `README.md` in which both appear as sections under Features.

The whole [language](#language) fits on one page.

## Language

A source folder is GitHub Flavored Markdown with front matter. Holon gives meaning to four things in it: code that starts with `holon`, the front matter field `render_to`, links, and heading levels. Everything else passes through as written.

### Nodes

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

### Calls

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

### Files

A node with `render_to` in its front matter becomes a file at that path inside the output folder:

```yaml
render_to: guides/setup.md
```

Holon renders these nodes and nothing else. Every other node appears only where a function renders it, which can be several places or none.

### Links

A link points to the same target in the output as in the source. Write it relative to its file, or from the source folder with a leading `/`. A link that a function writes resolves like a link in the node that contains the call.

- A link to a node points to where the node landed. That is its own file if it has `render_to`. Otherwise it is the file its text ended up in, at the node's own first heading. The text must be in exactly one place. Text that a function rendered and then dropped does not count.
- A link to any other file points to that file in the source folder. Holon copies nothing.
- A link to a `.md` file that is not a node is an error.

A fragment names one of the target node's own headings, by the anchor the heading has when the node stands alone. A link that is only a fragment, like `#setup`, points to a heading of the node it is written in. Reference links come out as inline links, each with the definition from its own node, and the definitions go.

The links in a node's text are the [backlinks](#nodes) of their targets. Links that only a function writes do not count, because backlinks are read before anything runs.

### Headings

Write every file as if it stood alone, starting at `#`. A heading underlined with `===` or `---` is an error. Holon fits the levels together with one rule: text put into other text starts one level below the last heading that other text wrote above it.

- `render(node)` returns the node with its top headings at level one.
- A call's result starts one level below the heading above the call.
- What a function got from `render()` starts one level below the heading the function wrote above it, so a function can group what it renders under headings of its own.

Every heading ends up exactly one level below the heading it belongs to, so gaps close: a file using only `##` and `####` comes out as `#` and `##`. Markdown has six levels. Nesting deeper is an error.

## Essentials

Holon ships no functions. The ones this README is built with are in [holon.config.js](docs/holon.config.js). Copy what you need:

- `sections()` puts the children one after another, skipping those with their own file.
- `ref(path)` links to a node with its title as the text.
- `file(path)` prints the output path of a node with its own file.
- `backlinks()` lists the nodes that link here.
- `tree(path)` draws the folder below a path with each node's `summary`.

## Usage

```sh
npm install --save-dev holon-md
npx holon docs .
```

The first argument is the source folder, the second the output folder. Every file lands inside the output folder and none inside the source folder. Holon prints every file as it writes it and stops at the first error, saying where it happened.

This README is compiled from:

```yaml
/:
  1-idea.md: # Why the files you write and the files you read should differ.
  2-language: # Nodes, calls, files, links and headings.
    1-nodes.md: # What functions see.
    2-calls.md: # Code that runs.
    3-files.md: # Which nodes become files.
    4-links.md: # Where links point after compiling.
    5-headings.md: # How heading levels fit together.
  3-essentials.md: # Functions worth copying.
  4-usage.md: # Install and run.
```
