// Deterministic lesson-plan tests. Run: npx tsx scripts/learn-plan.test.ts
// Verifies length→#lessons boundaries, the prerequisite graph, outcome grading,
// and the worked Fargate/Docker gap-detection case. No infra, no LLM.

import {
  lengthBucket,
  lessonCountForText,
  gradeOutcome,
  identifyConcept,
  prerequisiteChain,
  detectPrerequisiteGap,
} from "../src/lib/learn/plan";

let failures = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}: expected ${e}, got ${a}`);
    failures += 1;
  }
}

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

// 1. Length → bucket boundaries
eq(lengthBucket(799), "short", "799 → short");
eq(lengthBucket(800), "medium", "800 → medium");
eq(lengthBucket(2499), "medium", "2499 → medium");
eq(lengthBucket(2500), "long", "2500 → long");
eq(lengthBucket(5000), "long", "5000 → long");
eq(lengthBucket(5001), "epic", "5001 → epic");

// 2. Length → lesson count (default cap 4)
eq(lessonCountForText(words(500)), 1, "500w → 1 lesson");
eq(lessonCountForText(words(1500)), 2, "1500w → 2 lessons");
eq(lessonCountForText(words(3000)), 3, "3000w → 3 lessons");
eq(lessonCountForText(words(8000)), 4, "8000w → 4 lessons");

// 3. Outcome grading
eq(gradeOutcome(90), "mastered", "90% mastered");
eq(gradeOutcome(80), "mastered", "80% mastered");
eq(gradeOutcome(79), "review", "79% review");
eq(gradeOutcome(50), "review", "50% review");
eq(gradeOutcome(49), "prereq", "49% prereq");

// 4. Prerequisite graph
eq(identifyConcept("A deep dive into AWS Fargate task definitions"), "aws-fargate", "identify fargate");
eq(prerequisiteChain("aws-fargate"), ["containers", "docker"], "fargate chain");
eq(prerequisiteChain("rag"), ["embeddings", "vector-search"], "rag chain");

// 5. Worked case: Fargate article + "I don't know Docker" feedback → Docker blocker
const gap = detectPrerequisiteGap(
  "AWS Fargate lets you run containers without managing servers.",
  "I couldn't answer because I don't know Docker."
);
eq(gap?.blocker, "docker", "gap blocker = docker");
eq(gap?.topic, "aws-fargate", "gap topic = fargate");
if (gap && !/Docker/.test(gap.suggestion)) {
  console.error("FAIL suggestion mentions Docker");
  failures += 1;
}

// 6. No gap when feedback doesn't implicate a prereq
const none = detectPrerequisiteGap("AWS Fargate overview", "The pacing was a bit fast.");
eq(none, null, "no prereq named → null");

if (failures) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("PLAN_OK");
