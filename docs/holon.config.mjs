// The functions this README is built with. Copy what you need into your own holon.config.mjs.

/** @type {import("holon-md").Config} */
export default ({ node, render }) => {
  // Children one after another. Children with their own file are skipped,
  // folders without index.md contribute their children directly.
  const sectionsOf = (parent) =>
    parent.children
      .filter((child) => !child.artifact)
      .map((child) => render(child) || sectionsOf(child))
      .filter((text) => text !== "")
      .join("\n\n");

  return {
    sections: () => sectionsOf(node),

    // A link with the target's title as its text.
    ref: (path) => {
      const target = node.at(path);
      if (!target.title) throw new Error(`${target.path} has no title`);
      return `[${target.title}](${target.path})`;
    },

    // The output path of a node with its own file.
    file: (path) => {
      const target = node.at(path);
      if (!target.artifact) throw new Error(`${target.path} has no render_to`);
      return "`" + target.artifact + "`";
    },

    // The nodes that link here, by title. Parts without a title stay out.
    backlinks: () =>
      node.backlinks
        .filter((source) => source.title)
        .map((source) => `- [${source.title}](${source.path})`)
        .join("\n"),

    // The folder below a path, with each node's summary.
    tree: (path = ".") => {
      const lines = [];
      const visit = (current, depth) => {
        const name = current.path === "/" ? "/" : current.path.split("/").pop();
        const summary = current.meta.summary ? ` # ${current.meta.summary}` : "";
        lines.push(`${"  ".repeat(depth)}${name}:${summary}`);
        for (const child of current.children) visit(child, depth + 1);
      };
      visit(node.at(path), 0);
      return ["```yaml", ...lines, "```"].join("\n");
    },

    // The children as a table: a link to each child with a title, and a column per field of their front matter.
    // The facts stay in the children, so a child that gets a file gets a row.
    table: (...fields) => {
      const cell = (value) => String(value ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
      const row = (cells) => `| ${cells.join(" | ")} |`;
      const name = (child) => (child.title ? `[${cell(child.title)}](${child.path})` : child.path.split("/").pop());
      return [
        row(["", ...fields]),
        row(["", ...fields].map(() => ":--")),
        ...node.children.map((child) => row([name(child), ...fields.map((field) => cell(child.meta[field]))])),
      ].join("\n");
    },
  };
};
