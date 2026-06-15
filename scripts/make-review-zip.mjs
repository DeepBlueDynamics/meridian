#!/usr/bin/env node
// Build a code-review zip of the project sources.
//
//   node scripts/make-review-zip.mjs        → meridian-review-<sha>.zip at repo root
//
// Uses `git archive HEAD`, so only TRACKED files are included — .env*, crawl
// caches, sailboat_data/, node_modules/, telemetry.log etc. are excluded by
// construction (they're untracked or gitignored). On top of that we exclude:
//   - enc_charts/   (S-57 chart data — not reviewable code)
//   - dotfiles      (.gitignore, .env.example, editor configs)
// Note: the zip reflects HEAD; uncommitted changes are not included.
import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();

const dirty = run("git status --porcelain");
if (dirty) {
  console.warn("WARNING: working tree has uncommitted/untracked changes — the zip contains HEAD only:");
  console.warn(dirty.split("\n").slice(0, 10).map((l) => "  " + l).join("\n"));
}

const sha = run("git rev-parse --short HEAD");
const out = `meridian-review-${sha}.zip`;
const excludes = ['":!enc_charts"', '":!.*"', '":!**/.*"'];
execSync(`git archive --format=zip -o ${out} HEAD -- . ${excludes.join(" ")}`, { cwd: root, stdio: "inherit" });

// Same pathspec as the archive — what git lists is what the zip contains.
const list = run(`git ls-files -- . ${excludes.join(" ")}`).split("\n").filter(Boolean);
const kb = Math.round(statSync(path.join(root, out)).size / 1024);
console.log(`\n${out} — ${list.length} files, ${kb} KB`);
console.log(list.map((f) => "  " + f).join("\n"));
