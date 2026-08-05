#!/usr/bin/env node
// Builds docs/quiz.html — a single-file, offline-capable civic quiz — from
// data/source/quiz-questions.json and scripts/quiz-template.html.
//
// Run: node scripts/build-quiz.js
// Then: open docs/quiz.html directly, or (once pushed with the rest of
// docs/) it's served alongside the explorer at the same GitHub Pages site.
//
// Two independent stats systems are built in:
//  - Instant per-question "N% of respondents got this right" feedback uses
//    the window.storage API when opened as a Claude artifact (shared across
//    everyone who opens it), falling back to per-browser localStorage
//    otherwise. No setup required, but not visible to you outside an
//    artifact context.
//  - Durable, repo-committed stats (real cross-visitor tracking on GitHub
//    Pages) require the Cloudflare Worker relay in cloudflare-worker/ and
//    .github/workflows/quiz-stats.yml — see README.md "Setting up live stat
//    tracking". Pass --stats-endpoint-url to enable submitting attempts;
//    --stats-json-url controls where the quiz reads the published stats
//    from (defaults to "stats.json", i.e. docs/stats.json next to this
//    file). Visit quiz.html?stats=1 for the dashboard once any attempts
//    have been recorded.

import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SOURCE_PATH = join(ROOT, "data", "source", "quiz-questions.json");
const TEMPLATE_PATH = join(__dirname, "quiz-template.html");
const OUT_DIR = join(ROOT, "docs");
const OUT_PATH = join(OUT_DIR, "quiz.html");

// Default: same-folder deployment (docs/index.html + docs/quiz.html on
// GitHub Pages). Override for a standalone build, e.g.:
//   node scripts/build-quiz.js --explorer-url=biddeford-charter-explorer.html --out=/tmp/quiz.html
const args = process.argv.slice(2);
function argVal(flag, fallback) {
  const hit = args.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}
const explorerUrl = argVal("explorer-url", "index.html");
const outPath = argVal("out", OUT_PATH);
const statsEndpointUrl = argVal("stats-endpoint-url", ""); // empty = submission disabled
const statsJsonUrl = argVal("stats-json-url", "stats.json");

const data = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));

// Safe embed: escape "</" so a literal "</script>" inside JSON text can't
// terminate the surrounding <script> tag early.
const json = JSON.stringify(data).replace(/<\//g, "<\\/");

let html = readFileSync(TEMPLATE_PATH, "utf8");
html = html.replace("/*__QUIZ_DATA__*/", json);
html = html.replace("/*__EXPLORER_URL__*/", explorerUrl);
html = html.replace("/*__STATS_ENDPOINT_URL__*/", statsEndpointUrl);
html = html.replace("/*__STATS_JSON_URL__*/", statsJsonUrl);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);

console.log(`Built ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);
console.log(`  ${data.questions.length} questions across ${Object.keys(data.themes).length} themes`);
console.log(`  explorer link: ${explorerUrl}`);
console.log(`  stats endpoint: ${statsEndpointUrl || "(none — submission disabled)"}`);
console.log(`  stats json: ${statsJsonUrl || "(none — real-stats reading disabled)"}`);
