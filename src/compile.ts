import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { anchors, applyEdits, destinations, formatUrl, headings, parse, start, type Edit } from "./markdown.ts";
import { contains, createRender, type Config, type Region } from "./render.ts";
import { isPart, loadTree, message, resolveLink, type Node } from "./tree.ts";

/** A file to write: its path inside the output folder and its content. */
export type Artifact = { path: string; content: string };

/** Where a node's text ended up: the file, and for each of its own headings the anchor it got there, by the anchor it has when the node stands alone. */
type Place = { file: string; anchors: Map<string, string> };

/** Compile `sourceDir` for `outputDir` without writing anything. */
export function compile(sourceDir: string, outputDir: string, config?: Config): Artifact[] {
  const source = resolve(sourceDir);
  const output = resolve(outputDir);
  const tree = loadTree(source);
  const { render, markers, rendered } = createRender(tree, config ?? null);
  const files = new Map<string, Node>();
  for (const node of tree.nodes.values()) {
    if (!node.artifact) continue;
    const other = files.get(node.artifact);
    if (other) throw new Error(`${other.path} and ${node.path} both render_to ${node.artifact}`);
    const target = resolve(output, node.artifact);
    if (!within(output, target)) throw new Error(`${node.path} would render_to ${node.artifact}, which is not inside the output folder`);
    if (within(source, target)) throw new Error(`${node.path} would render_to ${node.artifact}, which is inside the source folder`);
    files.set(node.artifact, node);
  }
  if (files.size === 0) throw new Error("no node has render_to, so there is nothing to write");

  const texts = new Map<string, string>();
  for (const [path, node] of files) texts.set(path, render(node));
  // A part exists to be rendered somewhere, so one that nobody renders is text lying around unused.
  for (const [node, { file }] of tree.sources) {
    if (file && isPart(node.path) && !rendered(node)) throw new Error(`${file} is a part that no function renders`);
  }

  // Read from the markers where each node's text ended up and which headings are its own.
  const places = new Map<string, Place[]>();
  const marked = new Map<string, { regions: Region[]; removals: Edit[] }>();
  for (const [file, text] of texts) {
    const list = headings(parse(text));
    const names = anchors(list);
    let found: { regions: Region[]; removals: Edit[] };
    try {
      found = markers(text);
    } catch (error) {
      throw new Error(`${file}: ${message(error)}`);
    }
    const owners = list.map((heading) => innermost(found.regions, start(heading)));
    for (const region of found.regions) {
      const own = owners.flatMap((owner, i) => (owner === region ? [i] : []));
      const alone = anchors(own.map((i) => list[i]!));
      const place = { file, anchors: new Map(alone.map((anchor, j) => [anchor, names[own[j]!]!])) };
      places.set(region.path, [...(places.get(region.path) ?? []), place]);
    }
    marked.set(file, found);
  }

  /** The file a node's text is in, and the anchors of its headings there. */
  const landing = (node: Node): Place => {
    const found = places.get(node.path) ?? [];
    if (node.artifact) return found.find((place) => place.file === node.artifact) ?? { file: node.artifact, anchors: new Map() };
    if (found.length === 1) return found[0]!;
    const where = found.length === 0 ? "no file" : `${found.length} places (${[...new Set(found.map((place) => place.file))].join(", ")})`;
    throw new Error(`${node.path} has no render_to and its text is in ${where}, so links to it have no target`);
  };

  /** Where a link from `from` to `node` points. */
  const nodeUrl = (node: Node, fragment: string | null, from: string): string => {
    const place = landing(node);
    let anchor: string | null = null;
    if (fragment !== null) {
      anchor = place.anchors.get(fragment) ?? null;
      if (anchor === null) throw new Error(`${node.path} has no heading with the anchor #${fragment}`);
    } else if (!node.artifact) {
      anchor = place.anchors.values().next().value ?? null;
      if (anchor === null) throw new Error(`${node.path} has no heading in ${place.file} to link to`);
    }
    const path = place.file === from ? (anchor === null ? posix.basename(place.file) : "") : posix.relative(posix.dirname(from), place.file);
    return formatUrl(path, anchor);
  };

  /** Where a link to a file that is not a node points: the file in the source folder. */
  const fileUrl = (path: string, fragment: string | null, from: string): string => {
    const target = join(source, ...path.split("/"));
    return formatUrl(relative(dirname(join(output, from)), target).split(sep).join("/"), fragment);
  };

  return [...texts].map(([path, text]) => {
    const { regions, removals } = marked.get(path)!;
    const edits = [...removals];
    // Every link Holon handles is an absolute source path by now, see render().
    for (const found of destinations(text, parse(text))) {
      const target = resolveLink(tree, found.url, tree.sources.get(files.get(path)!)!, path);
      if (!target) continue;
      let url: string;
      try {
        url = target.node ? nodeUrl(target.node, target.fragment, path) : fileUrl(target.path, target.fragment, path);
      } catch (error) {
        const owner = innermost(regions, found.start)!.path;
        const file = tree.sources.get(tree.nodes.get(owner)!)?.file ?? owner;
        throw new Error(`${path}: link in ${file}: ${message(error)}`);
      }
      edits.push({ start: found.start, end: found.end, text: url });
    }
    // Removing the last marker line leaves the line break before it behind.
    return { path, content: `${applyEdits(text, edits).replace(/\n+$/, "")}\n` };
  });
}

/** Whether `path` lies inside `folder`, the folder itself excluded. */
function within(folder: string, path: string): boolean {
  const inside = relative(folder, path);
  return inside !== "" && inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

/** The innermost region around `offset`. */
function innermost(regions: Region[], offset: number): Region | undefined {
  let found: Region | undefined;
  for (const region of regions) {
    if (contains(region, offset) && (!found || region.start > found.start)) found = region;
  }
  return found;
}
