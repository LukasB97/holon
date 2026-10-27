#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "./compile.ts";
import type { Config } from "./render.ts";
import { message } from "./tree.ts";

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("usage: holon <source folder> <output folder>");
  process.exit(1);
}
const [source, output] = args as [string, string];
try {
  for (const artifact of compile(source, output, await loadConfig(source))) {
    const file = join(output, artifact.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, artifact.content);
    console.log(artifact.path);
  }
} catch (error) {
  console.error(`holon: ${message(error)}`);
  process.exit(1);
}

/** The default export of `holon.config.js` or `holon.config.mjs` in `sourceDir`, or undefined without one. */
async function loadConfig(sourceDir: string): Promise<Config | undefined> {
  const found = ["holon.config.js", "holon.config.mjs"].map((name) => resolve(sourceDir, name)).filter(existsSync);
  if (found.length === 0) return undefined;
  if (found.length > 1) throw new Error("holon.config.js and holon.config.mjs both exist, keep one");
  const file = found[0]!;
  let module: { default?: unknown };
  try {
    module = await import(pathToFileURL(file).href);
  } catch (error) {
    throw new Error(`${basename(file)}: ${message(error)}`);
  }
  if (typeof module.default !== "function") throw new Error(`${basename(file)} must export a default function`);
  return module.default as Config;
}
