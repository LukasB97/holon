---
title: The idea
summary: Why the files you write and the files you read should differ.
---

In a folder of Markdown files, the file you maintain is the file someone reads. The two jobs pull in different directions. Maintaining wants small files that each hold one thing in one place. Reading wants a few complete documents, shaped for whoever opens them.

Holon separates the two. You write a tree of small files. Functions you write project that tree into the documents you publish. Holon runs the functions, fits the heading levels together and keeps every link pointing at the right place.

A product described in three files:

```text
docs/
  holon.config.mjs
  index.md
  billing.md
  login.md
```

`index.md` names the document, says where it goes and pulls in its children:

```md
---
title: Product
render_to: README.md
---

# Features

`holon sections()`
```

`holon.config.mjs` defines what `sections` means:

```js
export default ({ node, render }) => ({
  sections: () => node.children.map(render).join("\n\n"),
});
```

`billing.md` and `login.md` are plain Markdown, each with a `title` in its front matter. Holon writes one `README.md`:

```md
# Product

## Features

### Billing

...

### Login

...
```

An include would paste the two files in as they are. Holon writes each title as a heading, moves the headings below it to where they now belong and keeps every link pointing where it pointed in the source, so a file reads right wherever it lands: as a section here, as a chapter of another document, or as a file of its own.

# One place for everything

The tree holds every fact once, in the node the fact is about. The name of a feature is the `title` of its file, its one-line description is a `summary` in the front matter of that file, and the text that explains it is that file. A document never restates a fact. It calls a function, and the function reads the fact from where it lives.

A table of all features is therefore not a list of rows in the front matter of the document that shows it. It is a function over `node.children` that reads each child's `summary`, so a feature that gets a file gets a row, and a summary that changes changes everywhere it appears. The test is simple: if the front matter of one file describes other files, the facts are in the wrong file. Move each one to the node it is about, and write a function.

The same holds for text. A paragraph that two documents share is a part, a file with a name starting in `_` that both render, and Holon checks that it is rendered somewhere. Nothing is written twice, and nothing lies around unused.

The whole [language](./2-language/index.md) fits on one page.
