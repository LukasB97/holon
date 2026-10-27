---
summary: Why the files you write and the files you read should differ.
---

# The idea

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

`index.md` says where it goes and pulls in its children:

```md
---
render_to: README.md
---
# Product

## Features

`holon sections()`
```

`holon.config.mjs` defines what `sections` means:

```js
export default ({ node, render }) => ({
  sections: () => node.children.map(render).join("\n\n"),
});
```

`billing.md` and `login.md` are plain Markdown, each starting with its own `#` heading. Holon writes one `README.md`:

```md
# Product

## Features

### Billing

...

### Login

...
```

An include would paste the two files in as they are. Holon moves their headings to where they now belong and keeps every link pointing where it pointed in the source, so a file reads right wherever it lands: as a section here, as a chapter of another document, or as a file of its own.

The whole [language](./2-language/index.md) fits on one page.
