// Hermetic smoke for the feedback → self-learning loop. No infra, no LLM.
// Run: REDIS_URL= ANTHROPIC_API_KEY= OPENAI_API_KEY= OLLAMA_HOST= EMBED_PROVIDER=local \
//        TIRUNO_VAULT_DIR=./.tmp-vault npx tsx scripts/feedback-smoke.ts
//
// Verifies: the Fargate article + "I don't know Docker" feedback yields a Docker
// prerequisite gap, persists the accepted prerequisite, and writes a knowledge note.

import { saveArticle, type StoredArticle } from "../src/lib/articles";
import { analyzeFeedback, recordPrereqAcceptance, listPendingPrereqs } from "../src/lib/learn/feedback";
import { getVault } from "../src/lib/core/vault";

let failures = 0;
const ok = (cond: boolean, label: string) => {
  if (!cond) {
    console.error(`FAIL ${label}`);
    failures += 1;
  }
};

async function main() {
  const article: StoredArticle = {
    id: "fargate-test",
    url: "https://example.com/fargate",
    title: "Getting started with AWS Fargate",
    source: "example.com",
    topic: "AWS Fargate",
    text: "AWS Fargate is a serverless compute engine for containers. You package your app as a Docker image and Fargate runs the container without you managing servers or clusters.",
    summary: "Run Docker containers on AWS without managing servers.",
    status: "ready",
    ready: true,
    kind: "bookmark",
    addedAt: Date.now(),
  };
  await saveArticle(article);

  // Struggling learner: low score + names the missing prerequisite.
  const res = await analyzeFeedback({
    uid: "demo",
    articleId: article.id,
    topic: article.topic,
    lessonTitle: "AWS Fargate · Part 1",
    scorePct: 20,
    feedbackText: "I couldn't answer because I don't know Docker.",
  });

  ok(res.outcome === "prereq", `outcome prereq (got ${res.outcome})`);
  ok(res.gap?.blocker === "docker", `gap blocker docker (got ${res.gap?.blocker})`);
  ok(res.gap?.topic === "aws-fargate", `gap topic fargate (got ${res.gap?.topic})`);

  // Accept "learn Docker first" → persisted as a pending prerequisite.
  if (res.gap) await recordPrereqAcceptance("demo", res.gap);
  const pending = await listPendingPrereqs("demo");
  ok(pending.some((p) => p.concept === "docker"), "docker pending after acceptance");

  // Knowledge note written to the vault.
  const notes = await getVault().list("knowledge/demo");
  ok(notes.length > 0, "knowledge note written");

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("FEEDBACK_SMOKE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
