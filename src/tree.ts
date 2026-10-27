import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Root } from "mdast";
import { destinations, headings, parse, plainText } from "./markdown.ts";

/** A folder or a Markdown file, as functions see it. */
export type Node = {
  /** Path from the source folder: `/` for the root, `/guides` for a folder, `/guides/setup.md` for a file. */
  path: string;
  /** The front matter. */
  meta: Record<string, unknown>;
  /** Text of the first heading as written, or null. */
  title: string | null;
  /** Output path from `render_to`, or null. */
  artifact: string | null;
  children: readonly Node[];
  /** Nodes whose text links to this node. */
  backlinks: readonly Node[];
  /** The node at `path`, relative to this node's folder or, with a leading `/`, to the source folder. */
  at(path: string): Node;
};

/** What Holon keeps about a node besides what functions see. */
export type Source = {
  node: Node;
  /** The file holding the node's text, for messages. Null for a folder without index.md. */
  file: string | null;
  /** The folder that relative paths in the text start from. */
  dir: string;
  /** The text after the front matter. */
  body: string;
  root: Root;
  /** Line of the file on which `body` starts. */
  line: number;
};

export type Tree = { dir: string; root: Node; nodes: Map<string, Node>; sources: Map<Node, Source> };

/** A link target in source terms, or null for links Holon leaves alone. */
export type Target = { path: string; fragment: string | null; node: Node | null };

export function loadTree(dir: string): Tree {
  const tree: Tree = { dir, root: undefined!, nodes: new Map(), sources: new Map() };
  tree.root = loadFolder(tree, "/") ?? loadNode(tree, "/", null, "/", []);
  for (const node of preorder(tree.root)) {
    const source = tree.sources.get(node)!;
    for (const { url, start } of destinations(source.body, source.root)) {
      const target = resolveLink(tree, url, source, location(source, start))?.node;
      if (target && target !== node && !target.backlinks.includes(node)) (target.backlinks as Node[]).push(node);
    }
  }
  // Functions share these nodes, so nobody may change them.
  for (const node of tree.nodes.values()) {
    freeze(node.meta);
    Object.freeze(node.children);
    Object.freeze(node.backlinks);
    Object.freeze(node);
  }
  return tree;
}

/** Freeze `value` and everything in it. */
function freeze(value: unknown): void {
  if (Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const inner of Object.values(value as object)) freeze(inner);
}

export function preorder(node: Node): Node[] {
  return [node, ...node.children.flatMap(preorder)];
}

export function location(source: Source, offset: number): string {
  const line = source.line + source.body.slice(0, offset).split("\n").length - 1;
  return `${source.file ?? source.node.path}:${line}`;
}

/** Resolve `target` against folder `dir`. Paths leaving the source folder keep their leading `..` segments. */
function resolvePath(dir: string, target: string): string {
  const parts = target.startsWith("/") ? [] : dir.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(segment);
  }
  return `/${parts.join("/")}`;
}

function lookup(tree: Tree, path: string): Node | undefined {
  return tree.nodes.get(path.endsWith("/index.md") ? path.slice(0, -"/index.md".length) || "/" : path);
}

/** The target of `url` in `source`'s text, or null for links Holon leaves alone. */
export function resolveLink(tree: Tree, url: string, source: Source, where: string): Target | null {
  if (url === "" || /^(\?|\/\/|[a-z][a-z0-9+.-]*:)/i.test(url)) return null;
  const hash = url.indexOf("#");
  const path = hash === 0 ? source.node.path : resolvePath(source.dir, decode(hash < 0 ? url : url.slice(0, hash)));
  const fragment = hash < 0 || hash === url.length - 1 ? null : url.slice(hash + 1);
  const node = lookup(tree, path) ?? null;
  if (!node && path.endsWith(".md") && !path.startsWith("/..")) {
    throw new Error(`${where}: link to ${path}, which is not a Markdown file in the source folder`);
  }
  return { path, fragment, node };
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function loadFolder(tree: Tree, path: string): Node | null {
  const entries = readdirSync(join(tree.dir, path), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const children: Node[] = [];
  let index: string | null = null;
  for (const entry of entries) {
    const childPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      const child = loadFolder(tree, childPath);
      if (child) children.push(child);
    } else if (entry.name === "index.md") {
      index = childPath;
    } else if (entry.name.endsWith(".md")) {
      children.push(loadNode(tree, childPath, childPath, path, []));
    }
  }
  if (!index && children.length === 0) return null;
  return loadNode(tree, path, index, path, children);
}

function loadNode(tree: Tree, path: string, file: string | null, dir: string, children: Node[]): Node {
  const text = file ? readFileSync(join(tree.dir, file), "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n") : "";
  const { meta, body, line } = splitFrontMatter(text, file);
  const root = parse(body);
  const first = headings(root)[0];
  const node: Node = {
    path,
    meta,
    title: first ? plainText(first).trim() : null,
    artifact: renderTo(meta, file),
    children,
    backlinks: [],
    at: (target) => {
      const found = lookup(tree, resolvePath(dir, target));
      if (!found) throw new Error(`${path}: at("${target}") matches no Markdown file or folder`);
      return found;
    },
  };
  tree.nodes.set(path, node);
  tree.sources.set(node, { node, file, dir, body, root, line });
  return node;
}

function splitFrontMatter(text: string, file: string | null): { meta: Record<string, unknown>; body: string; line: number } {
  const match = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text, line: 1 };
  let meta: unknown;
  try {
    meta = parseYaml(match[1] ?? "") ?? {};
  } catch (error) {
    throw new Error(`${file}: front matter is not valid YAML: ${message(error)}`);
  }
  if (typeof meta !== "object" || Array.isArray(meta)) throw new Error(`${file}: front matter must be a mapping`);
  return { meta: meta as Record<string, unknown>, body: text.slice(match[0].length), line: match[0].split("\n").length };
}

function renderTo(meta: Record<string, unknown>, file: string | null): string | null {
  const value = meta.render_to;
  if (value === undefined) return null;
  if (typeof value !== "string" || value.includes("\\") || value.endsWith("/")) {
    throw new Error(`${file}: render_to must be a file path with forward slashes, like guides/setup.md`);
  }
  return posix.normalize(value);
}
