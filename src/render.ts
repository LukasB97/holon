import { randomUUID } from "node:crypto";
import type { Heading, Nodes } from "mdast";
import {
  applyEdits,
  destinations,
  end,
  formatUrl,
  headings,
  levelEdit,
  levels,
  parse,
  referenceEdits,
  removeLines,
  start,
  walk,
  type Edit,
} from "./markdown.ts";
import { location, message, resolveLink, type Node, type Source, type Tree } from "./tree.ts";

/** The default export of `holon.config.mjs`: called for every holon call with the node that contains it. */
export type Config = (context: Context) => Record<string, (...args: any[]) => unknown>;
export type Context = { node: Node; render: (node: Node) => string };

/** The span of a text between the markers `render()` put around a node. */
export type Region = { path: string; start: number; end: number };

type Call = { expression: string; start: number; end: number; block: boolean; level: number; where: string };

/**
 * `render(node)` returns a node's text with its calls evaluated, its links
 * pointing at source paths and its top headings at level 1, between two
 * marker lines that tell Holon where the text ends up. `markers(text)` reads
 * those lines back. Markers carry an id that is new for every compile, so no
 * source text can contain one.
 */
export function createRender(tree: Tree, config: Config | null) {
  const done = new Map<Node, string>();
  const active: Node[] = [];
  const id = randomUUID().slice(0, 8);

  function render(node: Node): string {
    const source = tree.sources.get(node);
    if (!source) throw new Error(`render() expects a node, got ${describe(node)}`);
    const cached = done.get(node);
    if (cached !== undefined) return cached;
    if (active.includes(node)) {
      const cycle = [...active.slice(active.indexOf(node)), node].map((n) => n.path);
      throw new Error(`render cycle: ${cycle.join(" -> ")}`);
    }
    active.push(node);
    try {
      const text = renderSource(source);
      done.set(node, text);
      return text;
    } finally {
      active.pop();
    }
  }

  function renderSource(source: Source): string {
    const { title } = source.node;
    // The title is the heading at level 1, so the headings of the text are sections at level 2.
    const top = title === null ? 1 : 2;
    const list = headings(source.root);
    let depths: number[];
    let edits: Edit[];
    try {
      depths = levels(list, top);
      edits = list.flatMap((heading, i) => levelEdit(heading, depths[i]!) ?? []);
    } catch (error) {
      throw new Error(`${source.file}: ${message(error)}`);
    }
    edits.push(...referenceEdits(source.body, source.root));
    for (const call of findCalls(source, list, depths, top - 1)) {
      const text = expand(call, source);
      // An empty result leaves no block behind.
      edits.push(call.block && text === "" ? removeLines(source.body, call.start, call.end) : { start: call.start, end: call.end, text });
    }
    // The marker lines stand on lines of their own, so blank lines around the text go.
    const text = applyEdits(source.body, edits).replace(/^(?:[ \t]*\n)+/, "").trimEnd();
    const whole = title === null ? text : text === "" ? `# ${title}` : `# ${title}\n\n${text}`;
    return mark(source.node, linkToSources(whole, source));
  }

  function expand(call: Call, source: Source): string {
    try {
      const text = evaluate(call.expression, source.node);
      if (!call.block) {
        if (/[\r\n]/.test(text)) throw new Error("a call inside text must return a single line");
        return text;
      }
      return place(text, call.level + 1);
    } catch (error) {
      throw new Error(`${call.where}: ${message(error)}`);
    }
  }

  /**
   * Fit the headings of a call's result in. Those the function wrote itself
   * start at `base`. Each text it got from render() starts one level below the
   * last heading the function wrote above it.
   */
  function place(text: string, base: number): string {
    const list = headings(parse(text));
    const all = markers(text).regions;
    const outer = all.filter((region) => !all.some((other) => other !== region && other.start <= region.start && region.end <= other.end));
    const own = list.filter((heading) => !outer.some((region) => contains(region, start(heading))));
    const depths = levels(own, base);
    const edits = own.flatMap((heading, i) => levelEdit(heading, depths[i]!) ?? []);
    for (const region of outer) {
      const inside = list.filter((heading) => contains(region, start(heading)));
      const fitted = levels(inside, levelBefore(own, depths, region.start, base - 1) + 1);
      edits.push(...inside.flatMap((heading, i) => levelEdit(heading, fitted[i]!) ?? []));
    }
    return applyEdits(text, edits);
  }

  function evaluate(expression: string, node: Node): string {
    const functions = config ? config({ node, render }) : {};
    if (typeof functions !== "object" || functions === null) throw new Error("holon.config.mjs must return an object of functions");
    for (const name of Object.keys(functions)) {
      if (name === "node" || name === "render") throw new Error(`holon.config.mjs: "${name}" is taken`);
      if (!usable(name)) throw new Error(`holon.config.mjs: "${name}" cannot be the name of a function`);
    }
    const scope = { ...functions, node, render };
    const run = new Function(...Object.keys(scope), `"use strict";\nreturn (\n${expression}\n);`);
    const value: unknown = run(...Object.values(scope));
    if (typeof value !== "string") throw new Error(`a call must produce a string, got ${describe(value)}`);
    return value;
  }

  /** Rewrite links to absolute source paths, so they keep their meaning wherever the text lands. */
  function linkToSources(text: string, source: Source): string {
    const where = source.file ?? source.node.path;
    const edits: Edit[] = [];
    for (const found of destinations(text, parse(text))) {
      const target = resolveLink(tree, found.url, source, where);
      if (target) edits.push({ start: found.start, end: found.end, text: formatUrl(target.path, target.fragment) });
    }
    return applyEdits(text, edits);
  }

  /** Wrap a node's text in marker lines. They stand on lines of their own. Empty text gets no markers. */
  function mark(node: Node, text: string): string {
    if (text === "") return "";
    const path = encodeURI(node.path);
    return `<!-- holon ${id} start ${path} -->\n${text}\n<!-- holon ${id} end ${path} -->`;
  }

  /**
   * The regions the marker lines in `text` enclose, and the changes that remove
   * those lines. A marker line may carry a prefix that a function added to every
   * line, like `> ` or spaces, but nothing else.
   */
  function markers(text: string): { regions: Region[]; removals: Edit[] } {
    const regions: Region[] = [];
    const removals: Edit[] = [];
    const open: { path: string; start: number }[] = [];
    for (const found of text.matchAll(new RegExp(`<!-- holon ${id} (start|end) (\\S+) -->`, "g"))) {
      const path = decodeURI(found[2]!);
      const removal = removeLines(text, found.index, found.index + found[0].length);
      const before = text.slice(removal.start, found.index);
      const after = text.slice(found.index + found[0].length, removal.end);
      if (!/^[ \t>]*$/.test(before) || !/^[ \t]*\n?$/.test(after)) {
        throw new Error(`a function wrote text next to a marker line of ${path}; the text render() returns must stay on lines of its own`);
      }
      removals.push(removal);
      if (found[1] === "start") {
        open.push({ path, start: removal.end });
        continue;
      }
      const index = open.map((region) => region.path).lastIndexOf(path);
      if (index < 0) throw cutApart(path);
      if (index < open.length - 1) throw cutApart(open[open.length - 1]!.path);
      regions.push({ path, start: open.pop()!.start, end: removal.start });
    }
    if (open.length > 0) throw cutApart(open[open.length - 1]!.path);
    return { regions, removals };
  }

  /** The text `render(node)` produced, or undefined if it has not run. */
  function rendered(node: Node): string | undefined {
    return done.get(node);
  }

  return { render, markers, rendered };
}

function cutApart(path: string): Error {
  return new Error(`a function cut the rendered text of ${path} apart; keep the marker lines render() puts around it`);
}

/** Whether `offset` lies in `region`. */
export function contains(region: Region, offset: number): boolean {
  return region.start <= offset && offset < region.end;
}

/** The level of the last heading in `list` before `offset`, or `none` if there is no heading before it. */
function levelBefore(list: Heading[], depths: number[], offset: number, none: number): number {
  let level = none;
  for (let i = 0; i < list.length && start(list[i]!) < offset; i++) level = depths[i]!;
  return level;
}

/** Whether a call can use `name`: JavaScript accepts it as the name of a function. */
function usable(name: string): boolean {
  try {
    new Function(`"use strict"; function ${name}() {}`);
    return true;
  } catch {
    return false;
  }
}

/** The calls in `source`. `above` is the level of the title the text sits under, 0 without one. */
function findCalls(source: Source, list: Heading[], depths: number[], above: number): Call[] {
  const calls: Call[] = [];
  walk(source.root, (node, ancestors) => {
    const expression = holonExpression(node, source);
    if (expression === null) return;
    const parent = ancestors[ancestors.length - 1];
    const where = location(source, start(node));
    let block: boolean;
    if (node.type === "code") {
      if (parent?.type !== "root") throw new Error(`${where}: a holon block must stand at the top level, not inside a ${parent?.type}`);
      block = true;
    } else {
      block = parent?.type === "paragraph" && parent.children.length === 1 && ancestors[ancestors.length - 2]?.type === "root";
    }
    // The call sits below the last heading before it, at that heading's level in the finished text.
    const level = levelBefore(list, depths, start(node), above);
    calls.push({ expression, start: start(node), end: end(node), block, level, where });
  });
  return calls;
}

/** The expression of a holon call, or null if the node is not one. */
function holonExpression(node: Nodes, source: Source): string | null {
  if (node.type === "code" && node.lang === "holon") {
    if (node.meta) throw new Error(`${location(source, start(node))}: unexpected "${node.meta}" after holon`);
    return node.value;
  }
  if (node.type === "inlineCode") {
    const match = /^holon\s+(\S[\s\S]*)$/.exec(node.value);
    return match ? match[1]! : null;
  }
  return null;
}

function describe(value: unknown): string {
  if (typeof value === "function") return "a function (call it to get its text)";
  if (value === null || value === undefined) return String(value);
  return typeof value === "object" ? "an object" : `the ${typeof value} ${String(value)}`;
}
