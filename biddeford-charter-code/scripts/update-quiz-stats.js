#!/usr/bin/env node
// Merges a single quiz attempt (from a repository_dispatch client_payload)
// into data/stats/quiz-stats.json, and writes an identical copy to
// docs/stats.json so GitHub Pages can serve it same-origin.
//
// Run by .github/workflows/quiz-stats.yml with the incoming payload in the
// QUIZ_PAYLOAD environment variable (a JSON string). Can also be run by hand
// for testing:
//   QUIZ_PAYLOAD='{"score":7,"total":10,"answers":[{"questionId":1,"theme":1,"correct":true}, ...]}' node scripts/update-quiz-stats.js
//
// This script is the actual data-integrity boundary: the Cloudflare Worker
// (or whatever relay is in front of it) does light shape-checking, but this
// script is the last line of defense before anything lands in the repo, so
// it re-validates everything against the real question bank rather than
// trusting the payload.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STATS_PATH = process.env.STATS_PATH || join(ROOT, "data", "stats", "quiz-stats.json");
const DOCS_STATS_PATH = process.env.DOCS_STATS_PATH || join(ROOT, "docs", "stats.json");
const QUESTIONS_PATH = join(ROOT, "data", "source", "quiz-questions.json");

function fail(msg) {
  console.error("REJECTED: " + msg);
  process.exit(1);
}

const rawPayload = process.env.QUIZ_PAYLOAD;
if (!rawPayload) fail("QUIZ_PAYLOAD environment variable is empty or missing.");

let payload;
try {
  payload = JSON.parse(rawPayload);
} catch (e) {
  fail("QUIZ_PAYLOAD is not valid JSON: " + e.message);
}

const questionBank = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8"));
const validQuestionIds = new Set(questionBank.questions.map((q) => q.id));
const questionThemeById = new Map(questionBank.questions.map((q) => [q.id, q.theme]));
const validThemeIds = new Set(Object.keys(questionBank.themes).map(Number));

// ---- validate shape ----
if (typeof payload !== "object" || payload === null) fail("payload is not an object");
if (!Array.isArray(payload.answers)) fail("payload.answers is not an array");
if (payload.answers.length < 1 || payload.answers.length > 10) {
  fail(`payload.answers has ${payload.answers.length} entries; quiz attempts are always exactly 10 questions`);
}
if (typeof payload.score !== "number" || payload.score < 0 || payload.score > payload.answers.length) {
  fail("payload.score is missing or out of range");
}

const seenQuestionIdsThisAttempt = new Set();
for (const a of payload.answers) {
  if (typeof a !== "object" || a === null) fail("an answer entry is not an object");
  if (!validQuestionIds.has(a.questionId)) fail(`unknown questionId: ${a.questionId}`);
  if (seenQuestionIdsThisAttempt.has(a.questionId)) fail(`duplicate questionId in one attempt: ${a.questionId}`);
  seenQuestionIdsThisAttempt.add(a.questionId);
  if (typeof a.correct !== "boolean") fail(`answer.correct must be boolean for questionId ${a.questionId}`);
  const expectedTheme = questionThemeById.get(a.questionId);
  if (a.theme !== expectedTheme) fail(`theme mismatch for questionId ${a.questionId}: got ${a.theme}, expected ${expectedTheme}`);
  if (!validThemeIds.has(a.theme)) fail(`invalid theme: ${a.theme}`);
}

const actualCorrectCount = payload.answers.filter((a) => a.correct).length;
if (actualCorrectCount !== payload.score) {
  fail(`payload.score (${payload.score}) doesn't match the number of correct answers (${actualCorrectCount})`);
}

// ---- load existing stats (or start fresh) ----
let stats = existsSync(STATS_PATH)
  ? JSON.parse(readFileSync(STATS_PATH, "utf8"))
  : { totalAttempts: 0, lastUpdated: null, questions: {}, themes: {}, scoreDistribution: {} };

stats.totalAttempts = (stats.totalAttempts || 0) + 1;
stats.lastUpdated = new Date().toISOString();

for (const a of payload.answers) {
  const qKey = String(a.questionId);
  stats.questions[qKey] = stats.questions[qKey] || { seen: 0, correct: 0 };
  stats.questions[qKey].seen += 1;
  if (a.correct) stats.questions[qKey].correct += 1;

  const tKey = String(a.theme);
  stats.themes[tKey] = stats.themes[tKey] || { seen: 0, correct: 0 };
  stats.themes[tKey].seen += 1;
  if (a.correct) stats.themes[tKey].correct += 1;
}

const scoreKey = String(payload.score);
stats.scoreDistribution[scoreKey] = (stats.scoreDistribution[scoreKey] || 0) + 1;

// ---- write both copies ----
const json = JSON.stringify(stats, null, 2) + "\n";
writeFileSync(STATS_PATH, json);
writeFileSync(DOCS_STATS_PATH, json);

console.log(`OK: merged attempt (score ${payload.score}/${payload.answers.length}). Total attempts now ${stats.totalAttempts}.`);
