# biddeford-charter-code

An MCP (Model Context Protocol) server *and* web explorer for the **City of Biddeford, ME** municipal code — the City Charter, Code of Ordinances, and Land Development Regulations — plus the **Maine state statute** that grants municipalities their charter-amendment powers in the first place. Adapted from [BetaNYC's nyc-charter-laws-rules](https://github.com/BetaNYC/nyc-charter-laws-rules) and [nyc-charter-explorer](https://github.com/joshgreenman1973/nyc-charter-explorer).

Not affiliated with the City of Biddeford, General Code, eCode360, or the Maine Office of the Revisor of Statutes.

## Four corpora, two different levels of confidence, two different sources

| Corpus | Source | Size | How it was built |
|---|---|---|---|
| `charter` | PDF export, ecode360.com/BI3074 | 12 Articles, 74 sections | **Hand-transcribed.** Every section read, and all 15 sections whose sub-lists were displaced by the PDF's two-column layout manually traced and reattached. See `data/source/charter.json`'s `reassembled` fields. |
| `ordinances` | PDF export, ecode360.com/BI3074 | 23 Chapters, 1,239 sections | **Automated parse.** ~688 pages — not feasible to hand-verify. See "Automated parsing" below. |
| `land_dev` | PDF export, ecode360.com/BI3074 | Appendix A + 15 Articles, 209 sections | **Automated parse.** ~346 pages (Rules of City Council + the zoning/subdivision/shoreland/historic-preservation code). |
| `home_rule` | PDF export, legislature.maine.gov | 1 Chapter, 9 sections | **Hand-transcribed.** Maine's 30-A M.R.S. Chapter 111 — the state statute Biddeford's own Charter cites (Art. XII, Sec. 6: "30-A M.R.S.A, §§ 2101—2106") as its authority to revise or amend itself. Small and clean enough to transcribe directly, unlike the eCode360 exports. |

This distinction is surfaced everywhere: each corpus's `dataQualityNote` flows into the MCP server's tool output and `get_version`, and into the web explorer's document tabs (a "verified" vs "auto" badge) and footer.

## Automated parsing (`scripts/parse-large-docs.js`)

Given the scale (~1,000 pages combined), `ordinances` and `land_dev` are parsed programmatically from `pdftotext` output (`data/raw/*.txt`) rather than transcribed by hand:

1. Strip repeated page headers/footers (page-break characters, "City of Biddeford, ME", "Downloaded from ecode360.com...", and the running section-reference/title triplet printed on every page).
2. Split on citation markers — `Chapter N` for Ordinances; `APPENDIX A`, `Chapter LDR`, then `Article I–XV` for Land Development Regulations. Within Ordinances, `ARTICLE` and `DIVISION` headers are also detected (see "Article/Division metadata" below).
3. Within each chapter/article, find every occurrence of a section citation (e.g. `Sec. 18-1.`). Each appears twice — once in that chapter's table of contents (a bare heading with no real body), once as actual content — so rather than just picking the longer one (the TOC's own two-column layout can be internally scrambled and occasionally produce a *longer* fragment than the real content), the parser ranks occurrences: a real citation bracket like `[Code 1975, § ...]` wins outright; failing that, a clean placeholder (`(Reserved)`, or a `Sec. X. through Sec. Y. (Reserved)` range) wins; failing that, longest text wins.
4. Split each section's raw text into a heading (up to the first sentence-ending period) and body.

**Article/Division metadata (Ordinances only):** where a Chapter has internal `ARTICLE`/`DIVISION` structure (about 19 of the 23 do — Division numbers restart within each Article, the same way Charter section numbers restart within each Article), each section in `data/source/ordinances.json` carries `article`, `articleTitle`, `division`, and `divisionTitle` fields, attributed by the section's text position relative to the nearest preceding real Article/Division divider (same TOC-vs-real disambiguation as above, since these headers are also duplicated in the table of contents). This flows through to a `breadcrumb` field on each `ordinances` record in `data/index/json/ordinances.json` (e.g. `"Art. III: Officers and Employees › Div. 2: City Clerk"`), which the MCP server shows in `get_section`/`search` output and the web explorer shows under the citation on each card.

**Known limitations**, disclosed in the data itself: a handful of `(Reserved)` range-placeholder sections fall before any Article divider is detected and so have no Article/Division attributed; the heading/body split can occasionally cut a heading short around an abbreviation (spot-checked at ~1 in 1,580 sections). Always verify anything load-bearing — setbacks, fees, deadlines, permitting requirements — against the live source.

To regenerate `data/raw/*.txt` from fresh PDFs (requires poppler's `pdftotext`):
```bash
pdftotext Code_of_Ordinances.pdf data/raw/ordinances.txt
pdftotext Land_Development_Regulations.pdf data/raw/land-development.txt
node scripts/parse-large-docs.js   # -> data/source/ordinances.json, land_dev.json
```

## Tools

| Tool | Example |
|---|---|
| `search` | `search({ query: "setback", corpus: "land_dev" })` — omit `corpus` to search all four |
| `get_section` | `get_section({ citation: "Sec. 18-1" })` (Ordinances) · `get_section({ citation: "LDR Art. VI, Sec. 7" })` (Land Dev) · `get_section({ citation: "Art. II, Sec. 4" })` (Charter) · `get_section({ citation: "§2102" })` (Home Rule) |
| `list_titles` | `list_titles({ corpus: "ordinances" })` — lists all 23 Chapters |
| `get_title` | `get_title({ corpus: "land_dev", title: "App. A" })` — full text of a Chapter/Article/Appendix |
| `get_version` | `get_version()` — currency date **and data-quality status** for all 4 corpora |

Each corpus has its own citation convention (see table above); natural-language forms are also accepted — "Chapter 18", "Article 2 Section 4", "Appendix A" — see `normalizeCitation` in `src/corpus.ts`.

## Setup

```bash
npm install            # installs deps and runs the TypeScript build (via `prepare`)
npm run build-index    # regenerates data/index/ from data/source/*.json
npm start               # runs the MCP server over stdio
```

## Using it as an MCP server

```json
{
  "mcpServers": {
    "biddeford-charter-code": {
      "command": "node",
      "args": ["/path/to/biddeford-charter-code/dist/index.js"]
    }
  }
}
```

## Web explorer (`docs/index.html`)

A single-file, searchable/sortable web explorer, adapted from [nyc-charter-explorer](https://github.com/joshgreenman1973/nyc-charter-explorer). Document tabs to filter to Charter / Code of Ordinances / Land Development Regulations / Home Rule Statute / All (each tab shows its section count and a hand-verified/auto-parsed badge); a chapter/article sidebar scoped to whichever document is selected; full-text search with relevance ranking across one or all documents; sort (document order / A–Z / longest first); a toggle for the Charter's 15 "reassembled" sections; pagination (results load 40 at a time, since the combined corpus is ~1,530 sections); light/dark/auto theme; shareable URLs; keyboard shortcuts (`/` to search, `Esc` to clear).

```bash
npm run build-index          # must run first — the site reads data/index/json/*.json
node scripts/build-site.js   # regenerates docs/index.html
```

**To use it right now:** open `docs/index.html` directly in a browser — it's fully self-contained (~2.9 MB, all four corpora embedded inline), no server required.

**To get a public URL:** push this repo to GitHub, then in the repo's **Settings → Pages**, set Source to "Deploy from a branch", branch `main`, folder `/docs`, and save. GitHub will publish it at `https://<your-username>.github.io/<repo-name>/` within a minute or two.

## Civic quiz (`docs/quiz.html`)

A ten-question quiz, adapted (feel, not code or graphics) from [LovePawsona](https://github.com/IseeJ/LovePawsona)'s personality-quiz interactivity. Each attempt draws 2 random questions from each of 5 themes — Welcome to City Hall, Who Does What?, How Decisions Are Made, Your Voice Matters, You're in Charge! — so every run covers the whole Charter, in a different order, every time.

- **Immediate reveal**, NYT-News-Quiz style: answer, see whether you're right, read a short explanation, and see what percentage of other respondents got that question right.
- **"Read the Charter" pop-up** on every question, showing the exact cited section's text inline, plus a deep link that opens the full section in the web explorer (`docs/index.html?doc=charter&grp=charter::<article>#<section-id>`).
- **Six civic titles** assigned by final score, from 🌱 Emerging Citizen up to 🏛️ Charter Champion (10/10).
- **Live answer stats** ("62% of 340 respondents got this right") are read from `docs/stats.json` — the durable, repo-committed record described below. A question shows "No data yet for this question" until at least one real attempt answering it has been recorded there; there's no local-only fallback for this line, so what you see is always the real, cross-visitor number (or an honest "not yet known"), never a per-browser guess.

The 50-question bank lives in `data/source/quiz-questions.json`, each entry hand-written and cited against the actual Charter text (not generated from a template) — see its `citations` field for the exact quoted text and explorer deep-link ID behind every "Read the Charter" pop-up.

```bash
node scripts/build-quiz.js   # regenerates docs/quiz.html, linking to index.html (same-folder deploy)

# for a standalone copy (e.g. to hand someone a single file, not the whole repo):
node scripts/build-quiz.js --explorer-url=biddeford-charter-explorer.html --out=/tmp/quiz.html
```

**Adding or editing questions:** edit `data/source/quiz-questions.json`. Every question needs a `theme` (1–5, matching the `themes` object), a `citation` key that exists in the `citations` map (or a new entry there — copy the Charter section's exact text and the explorer record id, e.g. `art-II-sec-4`), and enough questions per theme that a random 2-per-theme draw never runs dry (currently 6–15 per theme). Re-run `node scripts/build-quiz.js` after editing.

### Setting up live stat tracking

The quiz has two independent stats systems:

1. **Instant per-question feedback** ("62% of respondents got this right," shown right after answering) reads from `docs/stats.json`, fetched once (with a 3-second timeout) when the quiz starts. There's no local-only fallback here on purpose — a question with no recorded attempts yet honestly says "No data yet" rather than showing a number that only reflects one browser. This means the feature stays quiet until the pipeline below is set up and has real attempts recorded.
2. **Landing-page total** ("N people have taken this quiz") and **the `quiz:totalStarts` used as its fallback**: the landing page also reads `docs/stats.json` first and shows the real `totalAttempts` count when available; only before any attempts exist (or if `stats.json` is unreachable) does it fall back to a `window.storage`/`localStorage`-tracked local count, labeled "(this device)" when it's local-only.

Both read from the same durable, repo-committed record — real numbers, aggregated across every visitor regardless of how they reached the quiz, viewable at `quiz.html?stats=1` and stored in version-controlled `data/stats/quiz-stats.json`. Getting real numbers on GitHub Pages requires a one-time setup:

```
Quiz (browser) → Cloudflare Worker relay → GitHub Actions (repository_dispatch) → commits data/stats/quiz-stats.json + docs/stats.json
```

The Worker is deliberately the *least* powerful link in that chain — it only holds a token scoped to "trigger a workflow," not "write to the repo." The actual commit happens inside the GitHub Actions run, using GitHub's own short-lived token, which the Worker never sees.

**1. Create a fine-grained GitHub PAT.** GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Scope it to **only this repository**. Under Repository permissions, grant just enough to call the dispatch endpoint (in practice this is bundled under "Contents: Read and write" on most accounts — check what your token needs by testing the dispatch call once you have it; if `Contents: None` plus no other permission succeeds, use that instead, since it's strictly less access).

**2. Deploy the Cloudflare Worker.**
```bash
cd cloudflare-worker
npx wrangler login
npx wrangler secret put GITHUB_TOKEN      # paste the PAT from step 1
npx wrangler secret put GITHUB_OWNER      # your GitHub username or org
npx wrangler secret put GITHUB_REPO       # e.g. biddeford-charter-code
npx wrangler deploy
```
This prints your Worker's URL, something like `https://biddeford-quiz-relay.<you>.workers.dev`.

**3. Point the quiz at it and rebuild:**
```bash
node scripts/build-quiz.js --stats-endpoint-url=https://biddeford-quiz-relay.<you>.workers.dev
```

**4. Commit and push** `docs/quiz.html`, `.github/workflows/quiz-stats.yml`, and `scripts/update-quiz-stats.js`. The workflow only needs to exist in the repo — nothing else to configure on the GitHub side; its `permissions: contents: write` is enough for the built-in `GITHUB_TOKEN` to commit.

**5. Take the quiz once yourself** to confirm the pipeline works end to end, then check the repo's **Actions** tab for a completed "Update quiz stats" run, and visit `quiz.html?stats=1` to see it.

**Data integrity:** `scripts/update-quiz-stats.js` is the real validation boundary — it re-checks every incoming attempt against the actual question bank (valid question IDs, matching themes, exactly 10 answers, score matching the correct count) and rejects anything malformed before it touches the stats file, regardless of what the Worker already let through.

**Testing without any of this set up:** `QUIZ_PAYLOAD='{"score":7,"total":10,"answers":[...]}' node scripts/update-quiz-stats.js` runs the merge logic directly against a hand-written payload — useful for verifying changes to the stats schema without needing a live Worker or Actions run.

## Updating the data

There's no automated refresh here — eCode360 has no public bulk feed, and Maine's statute site (legislature.maine.gov) is simple HTML but likewise has no bulk API (see "Automated parsing" above). When a source document is amended:

1. Download a fresh PDF export from ecode360.com/BI3074 (municipal code) or legislature.maine.gov/statutes (Home Rule statute), or request eCode360 API credentials from the City of Biddeford for a cleaner JSON source going forward.
2. For the Charter or Home Rule statute (both hand-transcribed): update `data/source/charter.json` or `data/source/home_rule.json` directly, watching for the sub-list displacement issue described in charter.json's `dataQualityNote`.
3. For Ordinances/Land Development Regs (automated parse): re-run `pdftotext` and `node scripts/parse-large-docs.js` (spot-check the diff — the parser is good but not infallible at this scale).
4. Bump each file's `asOf` field.
5. Run `npm run build-index && node scripts/build-site.js` and commit the regenerated `data/index/` and `docs/` files.

## Adding more corpora

The four corpora above cover Biddeford's own code (ecode360.com/BI3074) plus the one state statute its Charter directly invokes. `home_rule` is a good template for adding another small, clean, hand-transcribed corpus from a different source — the pattern:

1. Add it to the `Corpus` union and `ALL_CORPORA` in `src/corpus.ts`.
2. Add a `data/source/<corpus>.json` (hand-curated like `charter.json`/`home_rule.json`, or parsed like `ordinances`/`land_dev`).
3. Add a `build<Corpus>()` function to `scripts/build-index.js` producing the same flat record shape (`corpus`, `id`, `group`, `groupLabel`, `citation`, `heading`, `text`, `isDivider`).
4. Update the `enum` lists and `CORPUS_LABELS` in each tool's `inputSchema` in `src/index.ts`, and `CORPUS_META` in `scripts/build-site.js`.
5. If citations use a symbol/word `normalizeCitation` in `src/corpus.ts` doesn't already handle (like Maine's `§`), extend it there rather than special-casing the new corpus.

## License

MIT, same as the upstream nyc-charter-laws-rules project.
