#!/usr/bin/env node
// CLI: transforms data/source/{charter,ordinances,land_dev}.json into the
// per-corpus JSON + Markdown indexes the MCP server reads at runtime, plus a
// shared data/index/json/versions.json.
//
// charter.json is hand-curated (see its "dataQualityNote"); ordinances.json
// and land_dev.json are produced by scripts/parse-large-docs.js and are
// disclosed as automated, not hand-verified — see their own
// "dataQualityNote" fields, which flow through into the index and the MCP
// server's footer text unchanged.
//
// Run: npm run build-index

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const SOURCE_DIR = join(DATA_DIR, "source");
const JSON_DIR = join(DATA_DIR, "index", "json");
const MD_DIR = join(DATA_DIR, "index", "markdown");

mkdirSync(JSON_DIR, { recursive: true });
mkdirSync(MD_DIR, { recursive: true });

function loadSource(name) {
  const path = join(SOURCE_DIR, `${name}.json`);
  if (!existsSync(path)) {
    console.error(`Missing ${path}. Run scripts/parse-large-docs.js first (for ordinances/land_dev) or check data/source/charter.json.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

// ------------------------------- charter -------------------------------
function buildCharter(source) {
  const records = [];
  for (const article of source.articles) {
    records.push({
      corpus: "charter",
      id: `art-${article.article}`,
      group: article.article,
      groupLabel: `Article ${article.article}: ${article.title}`,
      citation: `Art. ${article.article}`,
      heading: `Article ${article.article}: ${article.title}`,
      text: "",
      isDivider: true,
    });
    for (const sec of article.sections) {
      const citation = sec.sec ? `Art. ${article.article}, Sec. ${sec.sec}` : `Art. ${article.article}`;
      const tag = sec.amended ? `Amended ${sec.amended}` : sec.added ? `Added ${sec.added}` : null;
      records.push({
        corpus: "charter",
        id: `art-${article.article}-sec-${sec.sec || "0"}`,
        group: article.article,
        groupLabel: `Article ${article.article}: ${article.title}`,
        citation,
        heading: sec.sec ? `Sec. ${sec.sec}. ${sec.heading}` : sec.heading,
        tag,
        text: sec.text || "",
        reassembled: sec.reassembled || null,
        isDivider: false,
      });
    }
  }
  return records;
}

// ------------------------------ ordinances ------------------------------
function buildOrdinances(source) {
  const records = [];
  for (const ch of source.chapters) {
    records.push({
      corpus: "ordinances",
      id: `ch-${ch.chapter}`,
      group: ch.chapter,
      groupLabel: `Chapter ${ch.chapter}: ${ch.title}`,
      citation: `Ch. ${ch.chapter}`,
      heading: `Chapter ${ch.chapter}: ${ch.title}`,
      text: "",
      isDivider: true,
    });
    for (const sec of ch.sections) {
      const breadcrumb = sec.article
        ? sec.division
          ? `Art. ${sec.article}: ${sec.articleTitle} › Div. ${sec.division}: ${sec.divisionTitle}`
          : `Art. ${sec.article}: ${sec.articleTitle}`
        : null;
      records.push({
        corpus: "ordinances",
        id: `ch-${ch.chapter}-sec-${sec.sec}`,
        group: ch.chapter,
        groupLabel: `Chapter ${ch.chapter}: ${ch.title}`,
        citation: `Sec. ${sec.sec}`,
        heading: sec.heading,
        text: sec.text || "",
        article: sec.article || null,
        articleTitle: sec.articleTitle || null,
        division: sec.division || null,
        divisionTitle: sec.divisionTitle || null,
        breadcrumb,
        isDivider: false,
      });
    }
  }
  return records;
}

// ------------------------------- land_dev -------------------------------
function buildLandDev(source) {
  const records = [];

  // Appendix A: Rules of City Council — flat, like Charter articles without
  // sub-grouping.
  records.push({
    corpus: "land_dev",
    id: "app-a",
    group: "app-a",
    groupLabel: `Appendix A: ${source.appendixA.title}`,
    citation: "App. A",
    heading: `Appendix A: ${source.appendixA.title}`,
    text: "",
    isDivider: true,
  });
  for (const sec of source.appendixA.sections) {
    records.push({
      corpus: "land_dev",
      id: `app-a-sec-${sec.sec}`,
      group: "app-a",
      groupLabel: `Appendix A: ${source.appendixA.title}`,
      citation: `App. A, Sec. ${sec.sec}`,
      heading: sec.heading,
      text: sec.text || "",
      isDivider: false,
    });
  }

  // Chapter LDR: Land Development Regulations — Article I-XV, each with its
  // own Section numbering (restarts per Article, like the Charter).
  for (const art of source.chapterLDR.articles) {
    const group = `ldr-${art.article}`;
    records.push({
      corpus: "land_dev",
      id: group,
      group,
      groupLabel: `LDR Art. ${art.article}: ${art.title}`,
      citation: `LDR Art. ${art.article}`,
      heading: `LDR Article ${art.article}: ${art.title}`,
      text: "",
      isDivider: true,
    });
    for (const sec of art.sections) {
      records.push({
        corpus: "land_dev",
        id: `${group}-sec-${sec.sec}`,
        group,
        groupLabel: `LDR Art. ${art.article}: ${art.title}`,
        citation: `LDR Art. ${art.article}, Sec. ${sec.sec}`,
        heading: sec.heading,
        text: sec.text || "",
        isDivider: false,
      });
    }
  }

  return records;
}

// ------------------------------- home_rule -------------------------------
function buildHomeRule(source) {
  const records = [];
  records.push({
    corpus: "home_rule",
    id: "ch-111",
    group: "111",
    groupLabel: "30-A M.R.S. Chapter 111: Home Rule",
    citation: "Ch. 111",
    heading: "30-A M.R.S. Chapter 111: Home Rule",
    text: "",
    isDivider: true,
  });
  for (const sec of source.sections) {
    records.push({
      corpus: "home_rule",
      id: `sec-${sec.sec}`,
      group: "111",
      groupLabel: "30-A M.R.S. Chapter 111: Home Rule",
      citation: `Sec. ${sec.sec}`,
      heading: `§${sec.sec}. ${sec.heading}`,
      text: sec.text || "",
      isDivider: false,
    });
  }
  return records;
}

// --------------------------------- shared ---------------------------------
function writeCorpus(corpusKey, records, source, extraMeta) {
  writeFileSync(join(JSON_DIR, `${corpusKey}.json`), JSON.stringify(records, null, 2));

  const md = [
    `# ${extraMeta.title}`,
    ``,
    `> As of ${source.asOf}. Source: ${source.sourceUrl}`,
    ``,
    `_${records.length} records indexed._`,
    ``,
    `> ⚠️ **Data quality note:** ${source.dataQualityNote}`,
    ``,
    `---`,
    ``,
    ...records.map((r) =>
      [
        `## ${r.heading}`,
        ``,
        `**Citation:** ${r.citation}`,
        ``,
        r.text || "_No text — heading/divider record only._",
        ``,
        `---`,
        ``,
      ].join("\n")
    ),
  ].join("\n");
  writeFileSync(join(MD_DIR, `${corpusKey}.md`), md);

  console.log(`  Saved data/index/json/${corpusKey}.json + markdown/${corpusKey}.md (${records.length} records)`);

  return {
    currentThrough: `As transcribed from ${source.sourceUrl} on ${source.asOf}`,
    indexedAt: new Date().toISOString(),
    sectionCount: records.filter((r) => !r.isDivider).length,
    dataQuality: source.dataQualityNote.startsWith("This corpus was hand-transcribed")
      ? "hand-verified"
      : "automated-parse",
  };
}

console.log("\nBuilding all corpora...\n");

const charterSource = loadSource("charter");
const ordinancesSource = loadSource("ordinances");
const landDevSource = loadSource("land_dev");
const homeRuleSource = loadSource("home_rule");

const versions = {
  charter: writeCorpus("charter", buildCharter(charterSource), charterSource, {
    title: "City of Biddeford, ME — City Charter",
  }),
  ordinances: writeCorpus("ordinances", buildOrdinances(ordinancesSource), ordinancesSource, {
    title: "City of Biddeford, ME — Code of Ordinances",
  }),
  land_dev: writeCorpus("land_dev", buildLandDev(landDevSource), landDevSource, {
    title: "City of Biddeford, ME — Land Development Regulations",
  }),
  home_rule: writeCorpus("home_rule", buildHomeRule(homeRuleSource), homeRuleSource, {
    title: "Maine Revised Statutes, Title 30-A, Chapter 111: Home Rule",
  }),
};

writeFileSync(join(JSON_DIR, "versions.json"), JSON.stringify(versions, null, 2));
console.log("\nVersions saved to data/index/json/versions.json:");
console.log(JSON.stringify(versions, null, 2));
console.log("\nIndex build complete.");
