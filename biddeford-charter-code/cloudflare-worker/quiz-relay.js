// Cloudflare Worker — the public-facing relay between the quiz (running in
// anyone's browser) and the GitHub Actions workflow that commits stats.
//
// This Worker deliberately holds the LEAST powerful credential possible: a
// fine-grained GitHub PAT scoped to this one repo, with "Contents: none"
// and only the permission needed to trigger a workflow dispatch. It cannot
// write to the repo itself — that happens inside the Actions runner, using
// GitHub's own short-lived token, which this Worker never sees or holds.
// If this Worker's token ever leaked, the blast radius is "someone could
// spam quiz-attempt events" — not "someone could push arbitrary commits."
//
// Setup (see README.md "Setting up live stat tracking" for the full walkthrough):
//   1. wrangler secret put GITHUB_TOKEN        (the fine-grained PAT)
//   2. wrangler secret put GITHUB_OWNER        (your GitHub username/org)
//   3. wrangler secret put GITHUB_REPO         (the repo name)
//   4. wrangler deploy
//   5. Point the quiz's STATS_ENDPOINT_URL (build-time flag on build-quiz.js)
//      at this Worker's URL.

const ALLOWED_ORIGINS_ENV_KEY = "ALLOWED_ORIGIN"; // optional: restrict which site can POST here

function corsHeaders(origin, allowedOrigin) {
  const allow = allowedOrigin && allowedOrigin !== "*" ? (origin === allowedOrigin ? origin : "null") : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env[ALLOWED_ORIGINS_ENV_KEY] || "*";
    const cors = corsHeaders(origin, allowedOrigin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "invalid JSON body" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Light shape validation here — the real, authoritative validation
    // (against the actual question bank) happens in
    // scripts/update-quiz-stats.js inside the Actions run. This Worker just
    // rejects obviously-malformed junk before spending a workflow run on it.
    if (
      typeof payload !== "object" ||
      payload === null ||
      !Array.isArray(payload.answers) ||
      payload.answers.length < 1 ||
      payload.answers.length > 10 ||
      typeof payload.score !== "number"
    ) {
      return new Response(JSON.stringify({ error: "malformed quiz attempt payload" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
      return new Response(JSON.stringify({ error: "relay is not configured (missing secrets)" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const dispatchUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`;
    const ghResponse = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "biddeford-charter-quiz-relay",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "quiz_result",
        client_payload: {
          score: payload.score,
          answers: payload.answers.map((a) => ({
            questionId: a.questionId,
            theme: a.theme,
            correct: !!a.correct,
          })),
        },
      }),
    });

    if (!ghResponse.ok) {
      const text = await ghResponse.text();
      return new Response(JSON.stringify({ error: "GitHub dispatch failed", detail: text.slice(0, 300) }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // GitHub's dispatch endpoint returns 204 No Content on success.
    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
