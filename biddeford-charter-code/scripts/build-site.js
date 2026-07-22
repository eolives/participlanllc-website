#!/usr/bin/env node
// Builds a single-file, offline-capable explorer from
// data/index/json/{charter,ordinances,land_dev,home_rule,versions}.json
// (the same files src/corpus.ts reads at runtime) and scripts/site-template.html.
//
// Run: npm run build-index && node scripts/build-site.js
// Then: open docs/index.html directly, or push this repo to GitHub and
// enable Pages (Settings > Pages > Deploy from branch > /docs) for a public URL.
//
// By default this builds ALL corpora to docs/index.html. To build a version
// with only some corpora (e.g. a Charter-only explorer for the quiz to link
// to, kept at a separate, unlinked URL):
//   node scripts/build-site.js --corpora=charter --out=docs/charter-only.html
// --corpora accepts a comma-separated list of corpus keys (see CORPUS_META
// below). Nothing in site-template.html links to a non-default --out path
// automatically — that's what keeps a build like this "unlinked": it's a
// real, working, publicly-reachable page once pushed, just not referenced
// by any nav link or button on the main site.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const JSON_DIR = join(ROOT, "data", "index", "json");
const TEMPLATE_PATH = join(__dirname, "site-template.html");
const OUT_DIR = join(ROOT, "docs");
const DEFAULT_OUT_PATH = join(OUT_DIR, "index.html");

const args = process.argv.slice(2);
function argVal(flag, fallback) {
  const hit = args.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

function loadIndex(corpus) {
  const path = join(JSON_DIR, `${corpus}.json`);
  if (!existsSync(path)) {
    console.error(`Missing ${path}. Run "npm run build-index" first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const ALL_CORPUS_META = {
  charter: { label: "City Charter", short: "Charter", sourceUrl: "https://ecode360.com/BI3074", sourceLabel: "ecode360.com/BI3074" },
  ordinances: { label: "Code of Ordinances", short: "Ordinances", sourceUrl: "https://ecode360.com/BI3074", sourceLabel: "ecode360.com/BI3074" },
  land_dev: { label: "Land Development Regulations", short: "Land Dev.", sourceUrl: "https://ecode360.com/BI3074", sourceLabel: "ecode360.com/BI3074" },
  home_rule: {
    label: "Maine Home Rule Statute",
    short: "Home Rule (State)",
    sourceUrl: "https://legislature.maine.gov/statutes/30-A/title30-Ach111sec0.html",
    sourceLabel: "legislature.maine.gov",
  },
};

const requestedKeys = argVal("corpora", null);
const outPath = argVal("out", DEFAULT_OUT_PATH);
const selectedKeys = requestedKeys
  ? requestedKeys.split(",").map((k) => k.trim()).filter(Boolean)
  : Object.keys(ALL_CORPUS_META);

for (const k of selectedKeys) {
  if (!ALL_CORPUS_META[k]) {
    console.error(`Unknown corpus "${k}". Valid options: ${Object.keys(ALL_CORPUS_META).join(", ")}`);
    process.exit(1);
  }
}

const CORPUS_META = Object.fromEntries(selectedKeys.map((k) => [k, ALL_CORPUS_META[k]]));

const versions = JSON.parse(readFileSync(join(JSON_DIR, "versions.json"), "utf8"));

let sections = [];
for (const corpus of Object.keys(CORPUS_META)) {
  sections = sections.concat(loadIndex(corpus));
}

const groups = [];
const seenGroups = new Set();
for (const r of sections) {
  if (!r.isDivider) continue;
  const key = `${r.corpus}::${r.group}`;
  if (seenGroups.has(key)) continue;
  seenGroups.add(key);
  groups.push({ corpus: r.corpus, group: r.group, label: r.groupLabel, citation: r.citation });
}
// count children per group
const groupCounts = {};
for (const r of sections) {
  if (r.isDivider) continue;
  const key = `${r.corpus}::${r.group}`;
  groupCounts[key] = (groupCounts[key] || 0) + 1;
}
groups.forEach((g) => {
  g.count = groupCounts[`${g.corpus}::${g.group}`] || 0;
});

const data = {
  meta: {
    corpora: Object.fromEntries(
      Object.entries(CORPUS_META).map(([key, m]) => [
        key,
        {
          label: m.label,
          short: m.short,
          sourceUrl: m.sourceUrl,
          sourceLabel: m.sourceLabel,
          asOf: versions[key]?.currentThrough?.match(/on (\S+)$/)?.[1] || "",
          sectionCount: versions[key]?.sectionCount ?? 0,
          dataQuality: versions[key]?.dataQuality ?? "unknown",
        },
      ])
    ),
  },
  groups,
  sections,
};

// Safe embed: escape "</" so a literal "</script>" inside JSON text can't
// terminate the surrounding <script> tag early.
const json = JSON.stringify(data).replace(/<\//g, "<\\/");

const template = readFileSync(TEMPLATE_PATH, "utf8");
const html = template.replace("/*__CHARTER_DATA__*/", json);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);

console.log(`Built ${outPath} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`  ${groups.length} groups, ${sections.filter((s) => !s.isDivider).length} sections across ${Object.keys(CORPUS_META).length} corpora (${Object.keys(CORPUS_META).join(", ")})`);
