// Builds the published copy of GradWay into dist/: every file of the site, with our own
// JavaScript and CSS minified (comments, spacing and local names removed) and a copyright
// line on top. File names and paths stay the same, so nothing else changes.
// Cloudflare Pages runs this on every push: build command "npm run build", output "dist".
// Locally: npm install, then npm run build.

import { transform } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(ROOT, "dist");
const YEAR = new Date().getFullYear();
const BANNER = `/*! GradWay © ${YEAR} Oakland Software Co. All rights reserved. Proprietary and confidential. Copying, reverse engineering or reuse without written permission is prohibited. */`;

// Never published: the source of the build itself, the Insights server, tests and tools.
const SKIP = new Set(["dist", "node_modules", "worker", "test", "tools", ".git", ".github",
  "build.mjs", "package.json", "package-lock.json", "README.md", "LICENSE", ".gitignore", ".DS_Store"]);
// Already minified third-party code keeps its own license header.
const AS_IS = ["vendor/"];

async function* walk(dir, rel = "") {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.endsWith(".map")) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(path.join(dir, entry.name), r);
    else yield r;
  }
}

await fs.rm(OUT, { recursive: true, force: true });
let saved = 0, count = 0;
for await (const file of walk(ROOT)) {
  const from = path.join(ROOT, file), to = path.join(OUT, file);
  await fs.mkdir(path.dirname(to), { recursive: true });
  const ext = path.extname(file);
  if ((ext === ".js" || ext === ".css") && !AS_IS.some(p => file.startsWith(p))) {
    const source = await fs.readFile(from, "utf8");
    const { code } = await transform(source, {
      loader: ext.slice(1), minify: true, legalComments: "none", banner: BANNER,
      target: ["es2020", "safari15", "chrome100"], charset: "utf8"
    });
    await fs.writeFile(to, code);
    saved += source.length - code.length; count++;
  } else if (ext === ".html") {
    // Drop HTML comments (notes for us, not for visitors).
    const html = (await fs.readFile(from, "utf8")).replace(/<!--(?!\[if)[\s\S]*?-->\n?/g, "");
    await fs.writeFile(to, html);
  } else {
    await fs.copyFile(from, to);
  }
}
console.log(`GradWay build: ${count} scripts and stylesheets minified (${Math.round(saved / 1024)} KB smaller) into dist/`);
