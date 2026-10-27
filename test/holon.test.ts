import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "../src/index.ts";

const lines = (...parts: string[]): string => parts.join("\n");
const file = (renderTo: string, ...body: string[]): string => lines("---", `render_to: ${renderTo}`, "---", ...body, "");

const sections =
  'export default ({ node, render }) => ({ sections: () => node.children.filter((c) => !c.artifact).map(render).join("\\n\\n") });';

function write(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "holon-"));
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, "src", name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

async function run(files: Record<string, string>): Promise<Record<string, string>> {
  const dir = write(files);
  const config = "holon.config.mjs" in files ? (await import(pathToFileURL(join(dir, "src", "holon.config.mjs")).href)).default : undefined;
  const artifacts = compile(join(dir, "src"), join(dir, "out"), config);
  return Object.fromEntries(artifacts.map((artifact) => [artifact.path, artifact.content]));
}

async function fails(files: Record<string, string>, expected: RegExp): Promise<void> {
  await assert.rejects(run(files), expected);
}

test("projects children into the parent's file, one level below the call", async () => {
  const out = await run({
    "holon.config.mjs": sections,
    "index.md": file("README.md", "# Product", "", "## Features", "", "`holon sections()`"),
    "billing.md": lines("## Billing", "", "Monthly invoices.", "", "#### Refunds", "", "Within 30 days.", ""),
    "login.md": lines("# Login", "", "Users sign in with email.", "", "## SSO", "", "Also via Google.", ""),
  });
  assert.equal(
    out["README.md"],
    lines(
      "# Product", "", "## Features", "",
      "### Billing", "", "Monthly invoices.", "", "#### Refunds", "", "Within 30 days.", "",
      "### Login", "", "Users sign in with email.", "", "#### SSO", "", "Also via Google.", "",
    ),
  );
});

test("puts every heading one level below the heading it belongs to", async () => {
  const out = await run({ "index.md": file("out.md", "## A", "", "#### B", "", "### C", "", "# D") });
  assert.equal(out["out.md"], lines("# A", "", "## B", "", "## C", "", "# D", ""));
});

test("a function groups what it renders under headings of its own", async () => {
  const config = [
    "export default ({ node, render }) => ({",
    '  grouped: () => "# Billing\\n\\n" + node.children.map(render).join("\\n\\n") + "\\n\\n# Appendix",',
    "});",
  ].join("\n");
  const out = await run({
    "holon.config.mjs": config,
    "index.md": file("out.md", "# Docs", "", "```holon", "grouped()", "```"),
    "invoices.md": lines("# Invoices", "", "## Detail", ""),
    "refunds.md": lines("# Refunds", ""),
  });
  assert.equal(
    out["out.md"],
    lines("# Docs", "", "## Billing", "", "### Invoices", "", "#### Detail", "", "### Refunds", "", "## Appendix", ""),
  );
});

test("a function needs a name a call can use", async () => {
  const index = file("out.md", '`holon "x"`');
  await fails({ "holon.config.mjs": 'export default () => ({ "my-fn": () => "x" });', "index.md": index }, /"my-fn" cannot be the name of a function/);
  await fails({ "holon.config.mjs": 'export default () => ({ class: () => "x" });', "index.md": index }, /"class" cannot be the name of a function/);
  await fails({ "holon.config.mjs": 'export default () => ({ render: () => "x" });', "index.md": index }, /"render" is taken/);
});

test("refuses headings deeper than Markdown allows", async () => {
  const deep = ["# 1", "## 2", "### 3", "#### 4", "##### 5", "###### 6", "", '`holon "# 7"`'];
  await fails({ "index.md": file("out.md", ...deep) }, /would need level 7/);
});

test("headings underlined with === or --- are an error", async () => {
  await fails({ "index.md": file("out.md", "Title", "=====") }, /\/index\.md: heading "Title" is underlined/);
  await fails({ "index.md": file("out.md", "# Doc", "", '`holon "Sub\\n---"`') }, /\/index\.md:6: heading "Sub" is underlined/);
  await fails({ "index.md": file("out.md", "#hashtag", "===") }, /heading "#hashtag" is underlined/);
});

test("a call inside text returns one line", async () => {
  const out = await run({ "index.md": file("out.md", 'Hello `holon "wor" + "ld"`!') });
  assert.equal(out["out.md"], "Hello world!\n");
  await fails({ "index.md": file("out.md", 'Hello `holon "a\\nb"`') }, /single line/);
});

test("a call must produce a string", async () => {
  await fails({ "index.md": file("out.md", "", "`holon 42`") }, /\/index\.md:5: a call must produce a string, got the number 42/);
  await fails({ "index.md": file("out.md", "`holon () => 'x'`") }, /got a function \(call it/);
});

test("code that is not a call stays as written", async () => {
  const body = lines("Run `holon` here.", "", "```md", "`holon sections()`", "```", "", "    indented code");
  const out = await run({ "index.md": file("out.md", body) });
  assert.equal(out["out.md"], `${body}\n`);
});

test("a holon block must stand at the top level", async () => {
  await fails({ "index.md": file("out.md", "- item", "", "  ```holon", "  'x'", "  ```") }, /top level/);
});

test("rendering a node from inside itself is an error", async () => {
  await fails(
    {
      "index.md": file("out.md", '`holon render(node.at("./a.md"))`'),
      "a.md": '`holon render(node.at("./b.md"))`\n',
      "b.md": '`holon render(node.at("./a.md"))`\n',
    },
    /render cycle: \/a\.md -> \/b\.md -> \/a\.md/,
  );
});

test("nodes expose path, meta, title, children and at()", async () => {
  const out = await run({
    "index.md": file(
      "out.md",
      "```holon",
      "node.children.map((c) => `${c.path} ${c.title ?? '-'} ${c.meta.tag ?? '-'}`).join('\\n')",
      "```",
      "",
      '`holon node.at("./c/d.md").path + " " + node.at("/a").title`',
    ),
    "b.md": lines("---", "tag: x", "---", "# Bee", ""),
    "a/index.md": "# Folder A\n",
    "c/d.md": "no heading\n",
    ".hidden/e.md": "# Hidden\n",
    "empty/notes.txt": "not Markdown",
  });
  assert.equal(out["out.md"], lines("/a Folder A -", "/b.md Bee x", "/c - -", "", "/c/d.md Folder A", ""));
  await fails({ "index.md": file("out.md", '`holon node.at("./nope.md").path`') }, /at\("\.\/nope\.md"\) matches no/);
});

test("functions cannot change the shared nodes", async () => {
  const files = { "a.md": "# A\n", "b.md": "# B\n" };
  await fails({ ...files, "index.md": file("out.md", '`holon node.children.reverse() && "x"`') }, /read.only/i);
  await fails({ ...files, "index.md": file("out.md", '`holon (node.meta.x = 1) && "x"`') }, /not extensible|read.only/i);
  const nested = { ...files, "a.md": "---\ntags: [x]\n---\n# A\n" };
  await fails({ ...nested, "index.md": file("out.md", '`holon node.at("./a.md").meta.tags.push("y") && "x"`') }, /not extensible/);
});

test("links point to where their target landed", async () => {
  const out = await run({
    "holon.config.mjs": sections,
    "index.md": file(
      "README.md",
      "# Docs",
      "",
      "See [login](./login.md), [setup](./guides/setup.md) and [SSO](./login.md#sso).",
      "",
      "`holon sections()`",
    ),
    "login.md": lines("# Login", "", "## SSO", ""),
    "guides/index.md": file("guides/README.md", "# Guides", "", "`holon sections()`"),
    "guides/setup.md": lines("# Setup", "", "Back to [login](../login.md).", ""),
  });
  assert.equal(
    out["README.md"],
    lines("# Docs", "", "See [login](#login), [setup](guides/README.md#setup) and [SSO](#sso).", "", "## Login", "", "### SSO", ""),
  );
  assert.equal(out["guides/README.md"], lines("# Guides", "", "## Setup", "", "Back to [login](../README.md#login).", ""));
});

test("a node with its own file is linked there, other files point into the source", async () => {
  const out = await run({
    "index.md": file(
      "README.md",
      "# Docs",
      "",
      "[a](./a.md) ![p](./pic.png) [web](https://x.org) [top](#docs)",
      "",
      '`holon render(node.at("./a.md"))`',
    ),
    "a.md": file("a.md", "# A"),
  });
  assert.equal(out["README.md"], lines("# Docs", "", "[a](a.md) ![p](../src/pic.png) [web](https://x.org) [top](#docs)", "", "## A", ""));
});

test("a link needs a target that exists exactly once", async () => {
  await fails({ "index.md": file("out.md", "[x](./missing.md)") }, /\/missing\.md, which is not a Markdown file/);
  await fails({ "index.md": file("out.md", "[b](./b.md)"), "b.md": "# B\n" }, /its text is in no file/);
  const twice = '`holon render(node.at("./b.md")) + "\\n\\n" + render(node.at("./b.md"))`';
  await fails({ "index.md": file("out.md", "[b](./b.md)", "", twice), "b.md": "# B\n" }, /its text is in 2 places/);
  const written = file("out.md", '`holon "[b](./b.md#nope)"`', "", '`holon render(node.at("./b.md"))`');
  await fails({ "index.md": written, "b.md": "# B\n" }, /out\.md: link in \/index\.md: \/b\.md has no heading/);
  const both = '`holon render(node.at("./b.md")) + "\\n\\n" + render(node.at("./c.md"))`';
  await fails(
    { "index.md": file("out.md", both), "b.md": "# B\n", "c.md": "[b](./b.md#nope)\n" },
    /out\.md: link in \/c\.md: \/b\.md has no heading with the anchor #nope/,
  );
});

test("a link finds a node's own heading, even when titles repeat", async () => {
  const out = await run({
    "holon.config.mjs": sections,
    "index.md": file("out.md", "# Doc", "", "[second](./b.md)", "", "`holon sections()`"),
    "a.md": lines("# Setup", "", "first", ""),
    "b.md": lines("# Setup", "", "second", ""),
  });
  assert.equal(out["out.md"], lines("# Doc", "", "[second](#setup-1)", "", "## Setup", "", "first", "", "## Setup", "", "second", ""));
});

test("a fragment names a heading of the node it belongs to", async () => {
  const out = await run({
    "holon.config.mjs": sections,
    "index.md": file("out.md", "# Doc", "", "[b](./b.md#details)", "", "`holon sections()`"),
    "a.md": lines("# A", "", "## Details", ""),
    "b.md": lines("# B", "", "Jump to [details](#details).", "", "## Details", ""),
  });
  assert.equal(
    out["out.md"],
    lines("# Doc", "", "[b](#details-1)", "", "## A", "", "### Details", "", "## B", "", "Jump to [details](#details-1).", "", "### Details", ""),
  );
});

test("reference links use the definitions of their own node", async () => {
  const out = await run({
    "holon.config.mjs": sections,
    "index.md": file("out.md", "# Doc", "", "`holon sections()`"),
    "a.md": lines("# A", "", "See [the api][api].", "", "[api]: ./x.md 'X'", ""),
    "b.md": lines("# B", "", "See [api].", "", "[api]: ./y.md", ""),
    "x.md": "# X\n",
    "y.md": "# Y\n",
  });
  assert.equal(
    out["out.md"],
    lines(
      "# Doc", "",
      "## A", "", "See [the api](#x 'X').", "",
      "## B", "", "See [api](#y).", "",
      "## X", "", "## Y", "",
    ),
  );
});

test("file names survive links and render_to", async () => {
  const out = await run({
    "holon.config.mjs": sections,
    "index.md": file("out.md", "# Doc", "", "[sp](./sp%20ace.md) [h](./h.md)", "", "`holon sections()`"),
    "sp ace.md": "# Sp Ace\n",
    "h.md": file("a#b.md", "# Hash"),
  });
  assert.equal(out["out.md"], lines("# Doc", "", "[sp](#sp-ace) [h](a%23b.md)", "", "## Sp Ace", ""));
  assert.equal(out["a#b.md"], "# Hash\n");
});

test("a destination may stand on a line of its own", async () => {
  const out = await run({
    "index.md": file("out.md", "# Doc", "", "> [a](", "> ./a.md", "> )", "", '`holon render(node.at("./a.md"))`'),
    "a.md": "# A\n",
  });
  assert.equal(out["out.md"], lines("# Doc", "", "> [a](", "> #a", "> )", "", "## A", ""));
});

test("a node has landed where its text is, not where render() was called", async () => {
  const c = lines("# C", "", "real c", "");
  const discarded = '`holon (render(node.at("./c.md")), "")`';
  await fails(
    { "index.md": file("out.md", "# Doc", "", "## C", "", "unrelated", "", "[c](./c.md)", "", discarded), "c.md": c },
    /\/c\.md has no render_to and its text is in no file/,
  );
  const checkedThenUsed = '`holon render(node.at("./c.md")) ? render(node.at("./c.md")) : ""`';
  const out = await run({ "index.md": file("out.md", "# Doc", "", "[c](./c.md)", "", checkedThenUsed), "c.md": c });
  assert.equal(out["out.md"], lines("# Doc", "", "[c](#c)", "", "## C", "", "real c", ""));
});

test("a call sits one level below where the heading above it ends up", async () => {
  const out = await run({ "index.md": file("out.md", "# A", "", "#### B", "", '`holon "# X\\n\\n## Y\\n\\n### Z"`') });
  assert.equal(out["out.md"], lines("# A", "", "## B", "", "### X", "", "#### Y", "", "##### Z", ""));
});

test("cutting a rendered text apart is an error", async () => {
  const firstTwoLines = '`holon render(node.at("./c.md")).split("\\n").slice(0, 2).join("\\n")`';
  await fails({ "index.md": file("out.md", firstTwoLines), "c.md": "# C\n\nreal c\n" }, /cut the rendered text of \/c\.md apart/);
});

test("a function may put a prefix in front of every line of a rendered text", async () => {
  const config = [
    "export default ({ node, render }) => ({",
    '  quote: (path) => render(node.at(path)).split("\\n").map((line) => "> " + line).join("\\n"),',
    '  indent: (path) => render(node.at(path)).split("\\n").map((line) => "  " + line).join("\\n"),',
    "});",
  ].join("\n");
  const c = lines("# C", "", "real c", "");
  const quoted = await run({ "holon.config.mjs": config, "index.md": file("out.md", "# Doc", "", '`holon quote("./c.md")`'), "c.md": c });
  assert.equal(quoted["out.md"], lines("# Doc", "", "> ## C", "> ", "> real c", ""));
  const indented = await run({
    "holon.config.mjs": config,
    "index.md": file("out.md", "# Doc", "", "- item", "", '`holon indent("./c.md")`'),
    "c.md": c,
  });
  assert.equal(indented["out.md"], lines("# Doc", "", "- item", "", "  ## C", "  ", "  real c", ""));
});

test("text next to a marker line is an error", async () => {
  await fails(
    { "index.md": file("out.md", '`holon "- " + render(node.at("./c.md"))`'), "c.md": "# C\n" },
    /wrote text next to a marker line of \/c\.md/,
  );
});

test("marker text in the source is only text", async () => {
  const body = lines("# Doc", "", "```md", "<!-- holon 0123abcd start /c.md -->", "# C", "<!-- holon 0123abcd end /c.md -->", "```");
  const out = await run({ "index.md": file("out.md", body), "c.md": "# C\n" });
  assert.equal(out["out.md"], `${body}\n`);
});

test("backlinks are the nodes whose text links here", async () => {
  const out = await run({
    "index.md": file("out.md", '`holon node.at("./c.md").backlinks.map((n) => n.path).join(", ")`'),
    "a.md": "[c](./c.md) and [c again](./c.md)\n",
    "b.md": "[c](/c.md)\n",
    "c.md": "[self](./c.md)\n",
  });
  assert.equal(out["out.md"], "/a.md, /b.md\n");
});

test("GitHub Flavored Markdown passes through", async () => {
  const body = lines("# Doc", "", "Claim.[^1] See https://example.com and ~~this~~.", "", "[^1]: Source", "", "| a | b |", "| - | - |", "| 1 | 2 |");
  const out = await run({ "index.md": file("out.md", body) });
  assert.equal(out["out.md"], `${body}\n`);
});

test("a block that goes takes its blank line along", async () => {
  const body = ["# Doc", "", '`holon ""`', "", "See [x][x].", "", "[x]: ./x.txt", "", "More."];
  const out = await run({ "index.md": file("out.md", ...body) });
  assert.equal(out["out.md"], lines("# Doc", "", "See [x](../src/x.txt).", "", "More.", ""));
});

test("front matter fences may end in whitespace", async () => {
  const out = await run({ "index.md": lines("--- ", "render_to: out.md", "---\t", "# Doc", "") });
  assert.equal(out["out.md"], "# Doc\n");
});

test("the CLI loads holon.config.mjs in a CommonJS package and names a config that fails to load", () => {
  const dir = write({
    "package.json": '{ "type": "commonjs" }',
    "holon.config.mjs": 'export default () => ({ hello: () => "hello" });',
    "index.md": file("out.md", "`holon hello()`"),
  });
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const holon = () => spawnSync(process.execPath, [cli, join(dir, "src"), join(dir, "out")], { encoding: "utf8" });
  const ok = holon();
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, "out.md\n");
  assert.equal(readFileSync(join(dir, "out", "out.md"), "utf8"), "hello\n");
  writeFileSync(join(dir, "src", "holon.config.mjs"), "export default (;\n");
  const bad = holon();
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^holon: holon\.config\.mjs: /m);
});

test("render_to must name distinct files inside the output folder", async () => {
  await fails({ "index.md": file("../out.md", "x") }, /render_to \.\.\/out\.md, which is not inside the output folder/);
  await fails({ "index.md": file("/out.md", "x") }, /not inside the output folder/);
  await fails({ "index.md": file(".", "x") }, /not inside the output folder/);
  await fails({ "index.md": file("a\\b.md", "x") }, /render_to must be a file path with forward slashes/);
  await fails({ "index.md": file("docs/", "x") }, /render_to must be a file path with forward slashes/);
  await fails({ "index.md": file("out.md", "x"), "a.md": file("out.md", "y") }, /\/ and \/a\.md both render_to out\.md/);
  await fails({ "index.md": "# Nothing\n" }, /nothing to write/);
});

test("no file may land inside the source folder", () => {
  const dir = write({ "index.md": file("out.md", "x") });
  assert.throws(() => compile(join(dir, "src"), join(dir, "src", "out")), /inside the source folder/);
  const docs = write({ "index.md": file("src/generated.md", "x") });
  assert.throws(() => compile(join(docs, "src"), docs), /inside the source folder/);
});

test("the essentials in docs/holon.config.mjs", async () => {
  const out = await run({
    "holon.config.mjs": readFileSync(new URL("../docs/holon.config.mjs", import.meta.url), "utf8"),
    "index.md": file(
      "README.md",
      "# Docs",
      "",
      'See `holon ref("./guide.md")`, file `holon file("./api.md")`.',
      "",
      "`holon tree()`",
      "",
      "`holon sections()`",
    ),
    "guide.md": lines("---", "summary: How to start.", "---", "# Guide", "", "Read [the API](./api.md).", ""),
    "api.md": lines("---", "render_to: api.md", "summary: Reference.", "---", "# API", "", "`holon backlinks()`", ""),
    "more/deep.md": "# Deep\n",
  });
  assert.equal(
    out["README.md"],
    lines(
      "# Docs", "", "See [Guide](#guide), file `api.md`.", "",
      "```yaml", "/:", "  api.md: # Reference.", "  guide.md: # How to start.", "  more:", "    deep.md:", "```", "",
      "## Guide", "", "Read [the API](api.md).", "", "## Deep", "",
    ),
  );
  assert.equal(out["api.md"], lines("# API", "", "- [Guide](README.md#guide)", ""));
});

test("README.md is compiled from docs/", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const config = (await import("../docs/holon.config.mjs")).default;
  const [readme] = compile(join(root, "docs"), root, config);
  assert.equal(readme?.path, "README.md");
  assert.equal(readme.content, readFileSync(join(root, "README.md"), "utf8"));
});
