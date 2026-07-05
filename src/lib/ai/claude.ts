// Deprecated shim. Q&A reasoning now goes through the provider-agnostic
// `answerQuestion` in ./answer.ts (selects Anthropic/OpenAI/Ollama from env).
// Kept so any older imports of `askClaude` keep working.

import { answerQuestion, type AnswerOpts } from "./answer";

export type AskOpts = AnswerOpts;

/** @deprecated Use `answerQuestion` from `@/lib/ai/answer`. */
export async function askClaude(question: string, opts: AskOpts = {}): Promise<string | null> {
  return answerQuestion(question, opts);
}
