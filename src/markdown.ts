import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import type { Heading, ImageReference, LinkReference, Nodes, Root } from "mdast";
import { parse as tokenize, postprocess, preprocess } from "micromark";
import { gfm } from "micromark-extension-gfm";

/** Replace `text.slice(start, end)` with `text`. */
export type Edit = { start: number; end: number; text: string };

/** Where a link, image or definition points, and the span of its destination in the text. */
export type Destination = { url: string; start: number; end: number };

/** Holon reads GitHub Flavored Markdown, the dialect whose anchors it writes. */
const extensions = [gfm()];

export function parse(text: string): Root {
  return fromMarkdown(text, { extensions, mdastExtensions: [gfmFromMarkdown()] });
}

export function walk(node: Nodes, visit: (node: Nodes, ancestors: Nodes[]) => void, ancestors: Nodes[] = []): void {
  visit(node, ancestors);
  if ("children" in node) {
    for (const child of node.children) walk(child, visit, [...ancestors, node]);
  }
}

export function start(node: Nodes): number {
  return node.position!.start.offset!;
}

export function end(node: Nodes): number {
  return node.position!.end.offset!;
}

export function applyEdits(text: string, edits: Edit[]): string {
  let result = "";
  let at = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (edit.start < at) throw new Error("two changes overlap");
    result += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return result + text.slice(at);
}

export function headings(root: Root): Heading[] {
  const found: Heading[] = [];
  walk(root, (node) => {
    if (node.type === "heading") found.push(node);
  });
  return found;
}

export function plainText(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if ("children" in node) return node.children.map(plainText).join("");
  return "";
}

/** The anchor GitHub derives from a heading's text. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** The anchors of all headings in order, with GitHub's `-1`, `-2` suffixes for repeats. */
export function anchors(list: Heading[]): string[] {
  const used = new Map<string, number>();
  const result: string[] = [];
  for (const heading of list) {
    const base = slug(plainText(heading));
    let anchor = base;
    while (used.has(anchor)) {
      const count = used.get(base)! + 1;
      used.set(base, count);
      anchor = `${base}-${count}`;
    }
    used.set(anchor, 0);
    result.push(anchor);
  }
  return result;
}

/**
 * The level of each heading such that it sits exactly one level below the
 * heading it belongs to, with the top level at `base`.
 */
export function levels(list: Heading[], base: number): number[] {
  const open: number[] = [];
  return list.map((heading) => {
    while (open.length > 0 && open[open.length - 1]! >= heading.depth) open.pop();
    open.push(heading.depth);
    const depth = base + open.length - 1;
    if (depth > 6) throw new Error(`heading "${plainText(heading)}" would need level ${depth}, Markdown stops at 6`);
    return depth;
  });
}

/** The change that moves `heading` to level `depth`, or null if it is there already. A heading with `#` stands on one line. */
export function levelEdit(heading: Heading, depth: number): Edit | null {
  const { start: from, end: to } = heading.position!;
  if (from.line !== to.line) throw new Error(`heading "${plainText(heading)}" is underlined with === or ---, write it with #`);
  if (heading.depth === depth) return null;
  return { start: from.offset!, end: from.offset! + heading.depth, text: "#".repeat(depth) };
}

/** The change that removes the lines from the one holding `from` to the one holding `to`. A block between blank lines takes one of them along. */
export function removeLines(text: string, from: number, to: number): Edit {
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const lineEnd = text.indexOf("\n", to);
  const end = lineEnd < 0 ? text.length : lineEnd + 1;
  return { start, end: text.endsWith("\n\n", start) && text.startsWith("\n", end) ? end + 1 : end, text: "" };
}

type Span = { start: number; end: number };

/** What the tree does not keep about a link, image or definition: where it ends, where its label ends, its destination and its title. */
type Syntax = { end: number; label: number; destination: Span | null; title: Span | null };

/** The syntax of every link, image and definition in `text`, by the node's start. */
function syntax(text: string): Map<number, Syntax> {
  const found = new Map<number, Syntax>();
  const open: Syntax[] = [];
  for (const [kind, token] of postprocess(tokenize({ extensions }).document().write(preprocess()(text, "utf8", true)))) {
    const span = { start: token.start.offset, end: token.end.offset };
    if (token.type === "link" || token.type === "image" || token.type === "definition") {
      if (kind === "exit") {
        open.pop();
      } else {
        const current = { end: span.end, label: span.start, destination: null, title: null };
        found.set(span.start, current);
        open.push(current);
      }
    } else if (kind === "exit" && open.length > 0) {
      const current = open[open.length - 1]!;
      if (token.type === "label") current.label = span.end;
      else if (token.type === "resourceDestination" || token.type === "definitionDestination") current.destination = span;
      else if (token.type === "resourceTitle" || token.type === "definitionTitle") current.title = span;
    }
  }
  return found;
}

export function destinations(text: string, root: Root): Destination[] {
  const spans = syntax(text);
  const found: Destination[] = [];
  walk(root, (node) => {
    if (node.type !== "link" && node.type !== "image" && node.type !== "definition") return;
    const destination = spans.get(start(node))?.destination;
    if (destination) found.push({ url: node.url, ...destination });
  });
  return found;
}

/** The changes that turn reference links and images into inline ones, each with the destination and title of the definition it uses, and remove the definitions. */
export function referenceEdits(text: string, root: Root): Edit[] {
  const spans = syntax(text);
  const definitions = new Map<string, Syntax>();
  const references: (LinkReference | ImageReference)[] = [];
  const edits: Edit[] = [];
  walk(root, (node) => {
    if (node.type === "definition") {
      if (!definitions.has(node.identifier)) definitions.set(node.identifier, spans.get(start(node))!);
      edits.push(removeLines(text, start(node), end(node)));
    } else if (node.type === "linkReference" || node.type === "imageReference") references.push(node);
  });
  for (const node of references) {
    const reference = spans.get(start(node))!;
    const { destination, title } = definitions.get(node.identifier)!;
    edits.push({ start: reference.label, end: reference.end, text: `(${text.slice(destination!.start, (title ?? destination)!.end)})` });
  }
  return edits;
}

/** A link destination: the path with every segment percent-encoded, then the fragment. */
export function formatUrl(path: string, fragment: string | null): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return fragment === null ? encoded : `${encoded}#${fragment}`;
}
