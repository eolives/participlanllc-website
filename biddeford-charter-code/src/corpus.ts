import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, "..", "data", "index", "json");

// Charter (hand-verified), Ordinances, Land Development Regulations (both
// automated-parse), and the Home Rule statute (hand-verified) — see each
// corpus's dataQualityNote in data/index/json/versions.json and the MCP
// server's footer text.
export type Corpus = "charter" | "ordinances" | "land_dev" | "home_rule";
const ALL_CORPORA: Corpus[] = ["charter", "ordinances", "land_dev", "home_rule"];

export interface Section {
  corpus: Corpus;
  id: string;
  group: string; // groups a divider record with its child sections (e.g. "18", "app-a", "ldr-VI")
  groupLabel: string; // human-readable group name, e.g. "Chapter 18: Buildings and Building Regulations"
  citation: string;
  heading: string;
  text: string;
  tag?: string | null;
  reassembled?: string | null;
  isDivider?: boolean;
  // Ordinances only: which Article/Division (if any) this section falls
  // under within its chapter — Division numbers restart per Article, so
  // both are needed to place a section precisely.
  article?: string | null;
  articleTitle?: string | null;
  division?: string | null;
  divisionTitle?: string | null;
  breadcrumb?: string | null;
}

export interface CorpusVersion {
  currentThrough: string;
  indexedAt: string;
  sectionCount: number;
  dataQuality: "hand-verified" | "automated-parse";
}

export type Versions = Record<Corpus, CorpusVersion>;

// Lazy-loaded per-corpus index.
const cache: Partial<Record<Corpus, Section[]>> = {};
let versionsCache: Versions | null = null;

function loadCorpus(corpus: Corpus): Section[] {
  if (cache[corpus]) return cache[corpus]!;
  const path = join(INDEX_DIR, `${corpus}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Index for "${corpus}" not found. Run: npm run build-index`
    );
  }
  cache[corpus] = JSON.parse(readFileSync(path, "utf8")) as Section[];
  return cache[corpus]!;
}

function loadVersions(): Versions {
  if (versionsCache) return versionsCache;
  const path = join(INDEX_DIR, "versions.json");
  if (!existsSync(path)) {
    throw new Error("Version index not found. Run: npm run build-index");
  }
  versionsCache = JSON.parse(readFileSync(path, "utf8")) as Versions;
  return versionsCache;
}

export function getVersions(): Versions {
  return loadVersions();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Relevance-ranked search. Scoring: heading match > citation match > body
// match; whole-word > substring. Same algorithm as nyc-charter-laws-rules.
export function searchCorpus(
  query: string,
  corpus: Corpus | "all" = "all",
  limit = 10
): Section[] {
  const corpora: Corpus[] = corpus === "all" ? ALL_CORPORA : [corpus];

  const q = query.toLowerCase();
  const wordRe = new RegExp(`\\b${escapeRegExp(q)}\\b`, "i");
  const scored: { s: Section; score: number }[] = [];

  for (const c of corpora) {
    const sections = loadCorpus(c);
    for (const s of sections) {
      const inHeading = s.heading.toLowerCase().includes(q);
      const inCitation = s.citation.toLowerCase().includes(q);
      const inText = s.text.toLowerCase().includes(q);
      if (!inHeading && !inCitation && !inText) continue;

      let score = 0;
      if (inHeading) score += 100 + (wordRe.test(s.heading) ? 30 : 0);
      if (inCitation) score += 50 + (wordRe.test(s.citation) ? 15 : 0);
      if (inText) score += 10 + (wordRe.test(s.text) ? 5 : 0);
      scored.push({ s, score });
    }
  }

  scored.sort((a, b) => b.score - a.score); // Array.sort is stable
  return scored.slice(0, limit).map((r) => r.s);
}

const ARABIC_TO_ROMAN: [number, string][] = [
  [12, "xii"], [11, "xi"], [10, "x"], [9, "ix"], [8, "viii"], [7, "vii"],
  [6, "vi"], [5, "v"], [4, "iv"], [3, "iii"], [2, "ii"], [1, "i"],
];

// Normalize a citation for comparison: strip "Art."/"Sec."/"Ch."/"App."/"§"
// prefixes, lowercase, collapse whitespace, and convert an arabic article
// number to its roman-numeral form. Each corpus has its own citation style —
// charter: "Art. II, Sec. 4"; ordinances: "Ch. 18" / "Sec. 18-1"; land_dev:
// "App. A" / "Sec. A-1" / "LDR Art. VI" / "LDR Art. VI, Sec. 7" — but people
// will type "Article 2 Section 4", "Chapter 18", "Appendix A", "Art II Sec
// 4", etc. across all of them.
export function normalizeCitation(input: string): string {
  let s = input
    .toLowerCase()
    .replace(/§§?\s*/g, "sec ")
    .replace(/\barticle\b\.?/g, "art")
    .replace(/\bsection\b\.?/g, "sec")
    .replace(/\bchapter\b\.?/g, "ch")
    .replace(/\bappendix\b\.?/g, "app")
    .replace(/\bart\.?\s*/g, "art ")
    .replace(/\bsec\.?\s*/g, "sec ")
    .replace(/\bch\.?\s*/g, "ch ")
    .replace(/\bapp\.?\s*/g, "app ")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // "art 2 sec 4" -> "art ii sec 4", including when "art" isn't at the very
  // start of the string (e.g. land_dev's "ldr art 6 sec 7" -> "...art vi...").
  s = s.replace(/\bart (\d+)\b/, (_, num) => {
    const n = parseInt(num, 10);
    const roman = ARABIC_TO_ROMAN.find(([v]) => v === n)?.[1];
    return roman ? `art ${roman}` : `art ${num}`;
  });

  return s;
}

export type GetSectionResult =
  | { kind: "match"; section: Section }
  | { kind: "ambiguous"; candidates: Section[] }
  | { kind: "none" };

// Exact-citation lookup with normalization and disambiguation.
// - Input is normalized (Art./Article, Sec./Section, "§", case, punctuation).
// - Exact citation matches are preferred over heading substring matches.
// - If `corpus` is given, only that corpus is consulted (today there's only
//   one corpus, but this keeps parity with nyc-charter-laws-rules' API shape
//   so it's a drop-in fit if you add ordinances/land-dev corpora later).
// - If multiple sections tie, a disambiguation list is returned instead of
//   silently picking the first hit.
export function getSection(
  citation: string,
  corpus?: Corpus
): GetSectionResult {
  const corpora: Corpus[] = corpus ? [corpus] : ALL_CORPORA;
  const q = normalizeCitation(citation);
  if (!q) return { kind: "none" };

  // Pass 1: exact (normalized) citation match across the corpora in scope.
  const exact: Section[] = [];
  for (const c of corpora) {
    for (const s of loadCorpus(c)) {
      if (normalizeCitation(s.citation) === q) exact.push(s);
    }
  }
  if (exact.length === 1) return { kind: "match", section: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  // Pass 2: heading substring fallback (e.g. "City Clerk" or "Veto power").
  const raw = citation.toLowerCase().trim();
  const loose: Section[] = [];
  for (const c of corpora) {
    for (const s of loadCorpus(c)) {
      if (s.heading.toLowerCase().includes(raw)) {
        loose.push(s);
        if (loose.length > 10) break; // cap the disambiguation list
      }
    }
  }
  if (loose.length === 1) return { kind: "match", section: loose[0] };
  if (loose.length > 1) return { kind: "ambiguous", candidates: loose };
  return { kind: "none" };
}

// Lists the top-level divider records for a corpus: Articles for "charter",
// Chapters for "ordinances", Appendix A + LDR Articles for "land_dev". Uses
// the isDivider flag rather than string-matching the heading, since each
// corpus names its groups differently ("Article II", "Chapter 18", "LDR
// Article VI", "Appendix A").
export function listTitles(corpus: Corpus): { citation: string; heading: string }[] {
  const sections = loadCorpus(corpus);
  return sections
    .filter((s) => s.isDivider)
    .map(({ citation, heading }) => ({ citation, heading }));
}

// Retrieve every record in a group (the divider + all its sections) by
// citation or group id — e.g. "Art. II", "Article 2", "Ch. 18", "Chapter 18",
// "App. A", "LDR Art. VI", "LDR Article 6". Matches on the normalized
// citation of each corpus's divider records, so it automatically works for
// all three corpora's different naming schemes without per-corpus logic.
export function getTitle(corpus: Corpus, title: string): Section[] {
  const sections = loadCorpus(corpus);
  const q = title.trim();
  if (!q) return [];
  const normQ = normalizeCitation(q);

  const divider = sections.find((s) => s.isDivider && normalizeCitation(s.citation) === normQ);
  if (divider) return sections.filter((s) => s.group === divider.group);

  // Fallback: maybe they typed a group id directly (e.g. "18" or "ldr-VI").
  const byGroupId = sections.filter((s) => s.group === q);
  if (byGroupId.length) return byGroupId;

  return [];
}
