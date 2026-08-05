#!/usr/bin/env node
// Parses the two large eCode360 PDF exports (already run through `pdftotext`,
// see data/raw/*.txt) into structured data/source/{ordinances,land_dev}.json.
//
// Unlike data/source/charter.json — which was hand-transcribed and every
// displaced sub-list manually traced and reattached — these two corpora
// (1,374 + 209 sections across ~1,000 pages) are parsed automatically. That
// is disclosed in each file's "dataQualityNote" and surfaced in the MCP
// server and the web explorer. See README "Data quality" section.
//
// Run: node scripts/parse-large-docs.js
// Regenerating data/raw/*.txt (if the source PDFs change) requires poppler's
// `pdftotext`: pdftotext <file>.pdf data/raw/<name>.txt

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW_DIR = join(ROOT, "data", "raw");
const SOURCE_DIR = join(ROOT, "data", "source");
const SOURCE_URL = "https://ecode360.com/BI3074";
const AS_OF = "2026-07-14";

const AUTO_PARSE_NOTE =
  "This corpus was parsed automatically from a PDF export downloaded from " +
  SOURCE_URL +
  " on " +
  AS_OF +
  " — unlike data/source/charter.json, it was NOT hand-verified section by section (that was feasible for the Charter's 74 sections; it is not for a corpus this size). The parser strips repeated page headers/footers, splits on citation markers ('Sec. 18-1.', 'ARTICLE VI', 'DIVISION 2'), and — since each of these appears twice in the source (once as a bare table-of-contents entry, once as the real content) — ranks the two occurrences by signal strength (a citation bracket like '[Code 1975, § ...]' beats a clean placeholder, which beats a raw TOC fragment) rather than by length alone, since the TOC's two-column layout can itself be internally scrambled. For Ordinances, each section also carries its enclosing Article/Division (when the chapter has that structure), attributed by text position relative to the nearest preceding real Article/Division divider. Known limitations: a small number of '(Reserved)' range-placeholder sections fall before any Article divider is detected and so have no Article/Division attributed; heading/body splitting uses the first sentence-ending period, which can occasionally cut a heading short if it contains an abbreviation. Always verify anything load-bearing — especially permitting, setback, or fee figures — against the live source.";

function splitHeadingAndBody(raw) {
  const text = raw.trim();

  // "through Sec.2-45. (Reserved)" (the neutered form of a reserved-range
  // declaration — see the ordinances cleaning step) reads badly if split at
  // the first period like a normal heading. Give it a clean heading instead.
  const rangeMatch = text.match(/^through\s+Sec\.\s*(\d+-\d+[A-Za-z]?)\.\s*\(Reserved\)/i);
  if (rangeMatch) {
    return { heading: `(Reserved, through Sec. ${rangeMatch[1]})`, body: "" };
  }

  // Heading = up to the first ". " or ".\n" (end of the title sentence);
  // body = everything after, including amendment-citation brackets.
  const m = text.match(/^(.{1,180}?\.)(?:\s|$)/s);
  if (m) {
    return { heading: m[1].trim(), body: text.slice(m[0].length).trim() };
  }
  // No period found (e.g. "(Reserved)") — use the first line as heading.
  const nl = text.indexOf("\n");
  if (nl === -1) return { heading: text, body: "" };
  return { heading: text.slice(0, nl).trim(), body: text.slice(nl).trim() };
}

function parseFlatSections(body, refPattern) {
  const re = new RegExp(refPattern, "g");
  const matches = [...body.matchAll(re)];
  const occ = matches.map((m, i) => {
    const s = m.index + m[0].length;
    const e = i + 1 < matches.length ? matches[i + 1].index : body.length;
    let raw = body.slice(s, e).trim();
    // Safety net: if a section's body still leaks past a real structural
    // boundary (a page-header variant the cleaning regexes didn't catch),
    // cut it there instead of letting it swallow unrelated content from the
    // next chapter/article.
    const boundary = raw.match(/\n(?:ARTICLE [IVXLC]+|DIVISION \d+|Chapter \d+|APPENDIX [A-Z])\n/);
    if (boundary && boundary.index !== undefined) {
      raw = raw.slice(0, boundary.index).trim();
    }
    // A table-of-contents number-list entry sits tightly packed against its
    // neighboring "Sec. N." match (just "Sec. 2-301.\nSec. 2-302." back to
    // back, near-zero gap) — as opposed to real content, which always has a
    // full paragraph before the next section starts. Flag these: their
    // trailing text is NOT reliably paired with them (the two-column TOC
    // layout can drift out of alignment once several consecutive ranges are
    // listed), so it should never outrank genuine content — see rank().
    const prevMatchEnd = i > 0 ? matches[i - 1].index + matches[i - 1][0].length : null;
    const gapFromPrev = prevMatchEnd === null ? Infinity : m.index - prevMatchEnd;
    const isTocNumberList = gapFromPrev < 3;
    return { num: m[1], raw, isTocNumberList, pos: m.index };
  });
  const best = new Map();
  const RESERVED_RANGE_RE = /^through\s+Sec\.\s*\d+-\d+[A-Za-z]?\.\s*\(Reserved\)/i;
  const CITATION_RE = /\[(?:Code 1975|Ord\.|Added|Amended)/i;

  // Priority when two occurrences share a section number (one is always the
  // real content, the other a table-of-contents artifact — see the comment
  // above): a TOC number-list entry is ranked lowest regardless of what
  // trailing text it happens to have (untrustworthy — may belong to an
  // unrelated, misaligned range elsewhere in the scrambled TOC). A real
  // citation bracket is the strongest signal of genuine content. Failing
  // that, a clean "(Reserved)" or anchored range description wins. Failing
  // that, longest text wins.
  function rank(o) {
    if (o.isTocNumberList) return 0;
    if (CITATION_RE.test(o.raw)) return 3;
    if (o.raw === "(Reserved)" || RESERVED_RANGE_RE.test(o.raw)) return 2;
    return 1;
  }

  for (const o of occ) {
    const existing = best.get(o.num);
    if (!existing) {
      best.set(o.num, o);
      continue;
    }
    const oRank = rank(o);
    const exRank = rank(existing);
    if (oRank !== exRank) {
      if (oRank > exRank) best.set(o.num, o);
    } else if (o.raw.length > existing.raw.length) {
      best.set(o.num, o);
    }
  }
  return [...best.values()];
}

// Finds real (non-table-of-contents) ARTICLE/DIVISION dividers within a
// chapter. Like sections, these headers appear twice in the source: once in
// the chapter's own local table of contents (a bare "ARTICLE II\nCITY
// COUNCIL" immediately followed by a list of bare "Sec. N." entries with no
// citation), and once as the real divider (immediately followed by actual
// prose with a citation bracket). A citation bracket within the next ~400
// characters reliably distinguishes the two — verified by inspection across
// every Article/Division in Chapter 2, the most deeply-nested chapter.
function findRealDividers(body, headerRegex) {
  const CITATION_WINDOW = 400;
  const CITATION_RE = /\[(?:Code 1975|Ord\.|Added|Amended)/;
  const matches = [...body.matchAll(headerRegex)];
  const real = [];
  for (const m of matches) {
    const after = body.slice(m.index + m[0].length, m.index + m[0].length + CITATION_WINDOW);
    if (CITATION_RE.test(after)) {
      real.push({ num: m[1], title: titleCase(m[2].replace(/\d+$/, "").trim()), pos: m.index });
    }
  }
  return real; // already in document order (ascending pos), since matchAll is
}

// Given a section's position and the chapter's real Article/Division divider
// lists (each ascending by pos), find which Article and Division it falls
// under. Division numbers restart within each Article, so a division only
// counts if its position is both before the section AND after the section's
// enclosing Article — otherwise a chapter where only some Articles use
// Divisions could attribute a later, Division-less Article's sections to an
// earlier Article's trailing Division.
function findEnclosing(sectionPos, articles, divisions) {
  let article = null;
  for (const a of articles) {
    if (a.pos <= sectionPos) article = a;
    else break;
  }
  let division = null;
  for (const d of divisions) {
    if (d.pos <= sectionPos && (!article || d.pos > article.pos)) division = d;
    else if (d.pos > sectionPos) break;
  }
  return { article, division };
}

// ============================== ORDINANCES ==============================
function parseOrdinances() {
  const raw = readFileSync(join(RAW_DIR, "ordinances.txt"), "utf8");

  const text = raw
    .replace(/\f/g, "")
    .replace(/^City of Biddeford, ME$/gm, "")
    .replace(/^BIDDEFORD CODE$/gm, "")
    .replace(/^Code of Ordinances$/gm, "")
    .replace(/^Downloaded from https:\/\/ecode360\.com\/BI3074.*$/gm, "")
    // "Sec. 2-27. through Sec. 2-45. (Reserved)" is a single range
    // declaration, not two sections — but the embedded "Sec. 2-45." looks
    // exactly like a new section boundary to the splitter below, which
    // corrupts both "2-27" (truncated to the word "through") and "2-45"
    // (which swallows unrelated text up to the next real section). Strip
    // the space after "Sec." in the *second* reference only, so it keeps
    // reading as a range description but no longer matches the section-
    // boundary regex. (135 occurrences in this document as of 2026-07-14.)
    .replace(
      /(through\s+)Sec\.\s*(\d+-\d+[A-Za-z]?)\.(\s*\(Reserved\))/gi,
      "$1Sec.$2.$3"
    )
    .replace(
      /^Sec\. \d+-\d+[A-Za-z]?\n+(?:(?!Chapter |ARTICLE |DIVISION )[A-Z0-9 ,'\/&\-]+\n+){1,2}(?:Sec\. \d+-\d+[A-Za-z]?\n+)?/gm,
      "\n"
    )
    .replace(/\n{3,}/g, "\n\n");

  const chapterRe = /^Chapter (\d+)\n([A-Z][A-Z0-9 ,'\/&\-]+)$/gm;
  const chapterMatches = [...text.matchAll(chapterRe)];
  const artRe = /^ARTICLE ([IVXLC]+)\n([A-Z][A-Z0-9 ,'\/&\-]+)$/gm;
  const divRe = /^DIVISION (\d+[A-Za-z]?)\n([A-Z][A-Z0-9 ,'\/&\-()]+)$/gm;

  const chapters = chapterMatches.map((m, i) => {
    const start = m.index;
    const end = i + 1 < chapterMatches.length ? chapterMatches[i + 1].index : text.length;
    const body = text.slice(start, end);
    const articles = findRealDividers(body, artRe);
    const divisions = findRealDividers(body, divRe);
    const rawSections = parseFlatSections(body, "Sec\\. (\\d+-\\d+[A-Za-z]?)\\.\\s*");
    rawSections.sort((a, b) => {
      const an = parseInt(a.num.split("-")[1], 10);
      const bn = parseInt(b.num.split("-")[1], 10);
      return an - bn;
    });
    return {
      chapter: m[1],
      title: titleCase(m[2].replace(/\d+$/, "").trim()),
      sections: rawSections.map(({ num, raw, pos }) => {
        const { heading, body } = splitHeadingAndBody(raw);
        const { article, division } = findEnclosing(pos, articles, divisions);
        return {
          sec: num,
          heading,
          text: body,
          article: article ? article.num : null,
          articleTitle: article ? article.title : null,
          division: division ? division.num : null,
          divisionTitle: division ? division.title : null,
        };
      }),
    };
  });

  return {
    corpus: "ordinances",
    sourceUrl: SOURCE_URL,
    sourceLabel: "City of Biddeford, ME — Code of Ordinances (eCode360 / General Code)",
    asOf: AS_OF,
    dataQualityNote: AUTO_PARSE_NOTE,
    chapters,
  };
}

// ========================= LAND DEVELOPMENT REGS =========================
function parseLandDev() {
  const raw = readFileSync(join(RAW_DIR, "land-development.txt"), "utf8");

  const text = raw
    .replace(/\f/g, "")
    .replace(/^City of Biddeford, ME$/gm, "")
    .replace(/^BIDDEFORD CODE$/gm, "")
    .replace(/^Land Development Regulations$/gm, "")
    .replace(/^Downloaded from https:\/\/ecode360\.com\/BI3074.*$/gm, "")
    .replace(
      /^Sec\. ([A-Z]-\d+[a-z]?)\n+(?:(?!APPENDIX |Chapter |Article )[A-Z0-9 ,'\/&\-]+\n+){1,2}(?:Sec\. \1\n+)?/gm,
      "\n"
    )
    .replace(
      /^Section (\d+)\n+(?:(?!APPENDIX |Chapter |Article )[A-Z0-9 ,'\/&\-\.]+\n+){1,2}(?:Section \1\n+)?/gm,
      "\n"
    )
    .replace(/\n{3,}/g, "\n\n");

  const topRe = /^(APPENDIX [A-Z]|Chapter LDR|Chapter CCT)\n([A-Z][A-Z0-9 ,'\/&\-]*)$/gm;
  const topMatches = [...text.matchAll(topRe)];
  const parts = topMatches.map((m, i) => ({
    key: m[1],
    title: titleCase(m[2].trim()),
    start: m.index,
    end: i + 1 < topMatches.length ? topMatches[i + 1].index : text.length,
  }));

  const appendixA = parts.find((p) => p.key === "APPENDIX A");
  const chapterLDR = parts.find((p) => p.key === "Chapter LDR");
  // Chapter CCT (Code Comparative Table) is a cross-reference table, not
  // enacted regulatory text — intentionally not indexed.

  const appendixASections = appendixA
    ? parseFlatSections(text.slice(appendixA.start, appendixA.end), "Sec\\. (A-\\d+)\\.\\s*").map(
        ({ num, raw }) => {
          const { heading, body } = splitHeadingAndBody(raw);
          return { sec: num, heading, text: body };
        }
      )
    : [];

  const articleRe = /^Article ([IVXLC]+)\n([A-Z][A-Z0-9 ,'\/&\-]+)$/gm;
  const ldrBody = chapterLDR ? text.slice(chapterLDR.start, chapterLDR.end) : "";
  const articleMatches = [...ldrBody.matchAll(articleRe)];
  const articles = articleMatches.map((m, i) => {
    const start = m.index;
    const end = i + 1 < articleMatches.length ? articleMatches[i + 1].index : ldrBody.length;
    const body = ldrBody.slice(start, end);
    const rawSections = parseFlatSections(body, "Section (\\d+)\\.\\s*");
    rawSections.sort((a, b) => parseInt(a.num, 10) - parseInt(b.num, 10));
    return {
      article: m[1],
      title: titleCase(m[2].trim()),
      sections: rawSections.map(({ num, raw }) => {
        const { heading, body } = splitHeadingAndBody(raw);
        return { sec: num, heading, text: body };
      }),
    };
  });

  return {
    corpus: "land_dev",
    sourceUrl: SOURCE_URL,
    sourceLabel: "City of Biddeford, ME — Land Development Regulations (eCode360 / General Code)",
    asOf: AS_OF,
    dataQualityNote: AUTO_PARSE_NOTE,
    appendixA: { title: "Rules of City Council", sections: appendixASections },
    chapterLDR: { title: "Land Development Regulations", articles },
  };
}

function titleCase(s) {
  // "GENERAL PROVISIONS" -> "General Provisions"; keeps small connector
  // words lowercase except at the start, and leaves embedded acronyms/
  // numbers alone since .toLowerCase() only touches letters after the first.
  const small = new Set(["of", "and", "the", "or", "in", "for", "to", "a", "an"]);
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      if (i > 0 && small.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ")
    .replace(/,\s*/g, ", ");
}

const ordinances = parseOrdinances();
const landDev = parseLandDev();

writeFileSync(join(SOURCE_DIR, "ordinances.json"), JSON.stringify(ordinances, null, 2));
writeFileSync(join(SOURCE_DIR, "land_dev.json"), JSON.stringify(landDev, null, 2));

const ordCount = ordinances.chapters.reduce((n, c) => n + c.sections.length, 0);
const ldCount =
  landDev.appendixA.sections.length +
  landDev.chapterLDR.articles.reduce((n, a) => n + a.sections.length, 0);

console.log(`ordinances.json: ${ordinances.chapters.length} chapters, ${ordCount} sections`);
console.log(
  `land_dev.json: Appendix A (${landDev.appendixA.sections.length} sections) + ` +
    `Chapter LDR (${landDev.chapterLDR.articles.length} articles, ${landDev.chapterLDR.articles.reduce((n, a) => n + a.sections.length, 0)} sections) = ${ldCount} sections total`
);
