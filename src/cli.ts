#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

/** The default export of `holon.config.mjs` in `sourceDir`, or undefined without one. */
async function loadConfig(sourceDir: string): Promise<Config | undefined> {
  const file = resolve(sourceDir, "holon.config.mjs");
  if (!existsSync(file)) return undefined;
  let module: { default?: unknown };
  try {
    module = await import(pathToFileURL(file).href);
  } catch (error) {
    throw new Error(`holon.config.mjs: ${message(error)}`);
  }
  if (typeof module.default !== "function") throw new Error("holon.config.mjs must export a default function");
  return module.default as Config;
}
