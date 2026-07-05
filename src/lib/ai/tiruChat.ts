// Tiru feedback/chat service. Owns the prompt + provider policy so the API route stays
// thin (SRP). Depends only on the LLMProvider abstraction + the registry factories
// (DIP) — no vendor SDK is imported here.

import type { LLMProvider } from "@/lib/core/llm";
import { getLLM, getSubscriptionLLM } from "@/lib/core/llm";

export interface ChatTurn {
  role: "tiru" | "user";
  text: string;
}

export interface TiruChatInput {
  message: string;
  history?: ChatTurn[];
  page?: string;
  /** Provider override for tests/DI. Defaults to subscription-first selection. */
  llm?: LLMProvider;
}

export interface TiruChatResult {
  reply: string;
  /** Which provider answered: "claude-subscription" | "anthropic" | … | "local". */
  via: string;
}

const SYSTEM =
  "You are Tiru, the warm, upbeat learning companion inside the Tiruno app. " +
  "The learner opens this chat to (1) give feedback that helps you build better lessons, and " +
  "(2) ask you questions or just talk. Reply in 2-4 short, friendly sentences. " +
  "When they give feedback, acknowledge it concretely and say how you'll use it to improve their lessons. " +
  "When they ask something, answer clearly and encouragingly. " +
  "Never use markdown, bullet points, headings, or code blocks — write plainly, like speech.";

const CANNED =
  "Thanks so much — I've noted that and I'll use it to make your lessons better. " +
  "Tell me more, or ask me anything you're curious about.";

/** Build a single prompt from the recent conversation + the new message. */
function buildPrompt(message: string, history: ChatTurn[], page: string): string {
  const convo = history
    .slice(-6)
    .map((h) => `${h.role === "tiru" ? "Tiru" : "Learner"}: ${h.text}`)
    .join("\n");
  const where = page ? `\n\n(The learner is on the "${page}" screen.)` : "";
  return `${convo ? convo + "\n" : ""}Learner: ${message}${where}`;
}

/**
 * Generate Tiru's reply. Prefers the Claude **subscription**, falls back to the app's
 * default provider, then a canned line — so the chat always responds.
 */
export async function tiruChat({ message, history = [], page = "", llm }: TiruChatInput): Promise<TiruChatResult> {
  const prompt = buildPrompt(message, history, page);

  const chain: Array<{ provider: LLMProvider | null; via: string }> = llm
    ? [{ provider: llm, via: llm.name }]
    : [
        { provider: getSubscriptionLLM(), via: "claude-subscription" },
        { provider: getLLM(), via: "" },
      ];

  for (const { provider, via } of chain) {
    if (!provider) continue;
    try {
      const reply = (
        await provider.complete(prompt, { system: SYSTEM, maxTokens: 320, temperature: 0.5, timeoutMs: 30000 })
      ).trim();
      if (reply) return { reply, via: via || provider.name };
    } catch {
      /* try the next provider */
    }
  }
  return { reply: CANNED, via: "local" };
}
