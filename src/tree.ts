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
  /** The `title` from the front matter, or null. */
  title: string | null;
  /** Output path from `render_to`, or null. */
  artifact: string | null;
  /** The nodes in a folder, by name. Parts are not among them. */
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

/** `nodes` holds every node, parts included, each folder before what is in it. */
export type Tree = { dir: string; root: Node; nodes: Map<string, Node>; sources: Map<Node, Source> };

/** A link target in source terms, or null for links Holon leaves alone. */
export type Target = { path: string; fragment: string | null; node: Node | null };

export function loadTree(dir: string): Tree {
  const tree: Tree = { dir, root: undefined!, nodes: new Map(), sources: new Map() };
  const loaded = loadFolder(tree, "/");
  if (loaded[0]?.node.path !== "/") loaded.unshift(loadNode(tree, "/", null, "/", []));
  for (const source of loaded) {
    tree.nodes.set(source.node.path, source.node);
    tree.sources.set(source.node, source);
  }
  tree.root = loaded[0]!.node;
  for (const source of loaded) {
    for (const { url, start } of destinations(source.body, source.root)) {
      const target = resolveLink(tree, url, source, location(source, start))?.node;
      if (target && target !== source.node && !target.backlinks.includes(source.node)) (target.backlinks as Node[]).push(source.node);
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

/** Whether the node at `path` is a part: a name on the way to it starts with `_`. */
export function isPart(path: string): boolean {
  return path.split("/").some((name) => name.startsWith("_"));
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

/**
 * The folder at `path` and everything in it, each folder before its contents.
 * A folder with no index.md and no children is no node, but what is in it stays.
 */
function loadFolder(tree: Tree, path: string): Source[] {
  const entries = readdirSync(join(tree.dir, path), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const inside: Source[] = [];
  const children: Node[] = [];
  let index: string | null = null;
  for (const entry of entries) {
    const entryPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;
    let found: Source[];
    if (entry.isDirectory()) found = loadFolder(tree, entryPath);
    else if (entry.name === "index.md") {
      index = entryPath;
      continue;
    } else if (entry.name.endsWith(".md")) found = [loadNode(tree, entryPath, entryPath, path, [])];
    else continue;
    inside.push(...found);
    if (found[0]?.node.path === entryPath && !entry.name.startsWith("_")) children.push(found[0].node);
  }
  if (!index && children.length === 0) return inside;
  return [loadNode(tree, path, index, path, children), ...inside];
}

function loadNode(tree: Tree, path: string, file: string | null, dir: string, children: Node[]): Source {
  const text = file ? readFileSync(join(tree.dir, file), "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n") : "";
  const { meta, body, line } = splitFrontMatter(text, file);
  const root = parse(body);
  const title = titleOf(meta, file);
  const first = headings(root)[0];
  if (title === null) {
    if (file && !isPart(path)) throw new Error(`${file}: no title in the front matter; every node needs one, unless its name starts with _`);
  } else if (first && plainText(first).trim() === title) {
    throw new Error(`${file}: the heading "${title}" repeats the title; Holon writes the title above the text`);
  }
  const artifact = renderTo(meta, file);
  if (artifact !== null && isPart(path)) throw new Error(`${file}: a part cannot have render_to; it appears only where a function renders it`);
  const node: Node = {
    path,
    meta,
    title,
    artifact,
    children,
    backlinks: [],
    at: (target) => {
      const found = lookup(tree, resolvePath(dir, target));
      if (!found) throw new Error(`${path}: at("${target}") matches no Markdown file or folder`);
      return found;
    },
  };
  return { node, file, dir, body, root, line };
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

function titleOf(meta: Record<string, unknown>, file: string | null): string | null {
  const value = meta.title;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "" || value.includes("\n")) throw new Error(`${file}: title must be one line of text`);
  return value.trim();
}

function renderTo(meta: Record<string, unknown>, file: string | null): string | null {
  const value = meta.render_to;
  if (value === undefined) return null;
  if (typeof value !== "string" || value.includes("\\") || value.endsWith("/")) {
    throw new Error(`${file}: render_to must be a file path with forward slashes, like guides/setup.md`);
  }
  return posix.normalize(value);
}
