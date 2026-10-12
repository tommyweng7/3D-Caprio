import { callLLM, resolveLlmProvider } from "@/lib/llm";
import { AppError } from "@/caprio/errors";
import type { ChatMessage, LLMCompletion, LLMProvider } from "@/caprio/llm/provider";

/**
 * Bridges Caprio's planner onto Sondial's shared `callLLM` (Gemini or Anthropic),
 * so the component layer uses the same key and model as the rest of the app.
 *
 * `callLLM` returns null instead of throwing when there is no key. Caprio's
 * planner recovers from a throw by re-planning with the heuristic provider, so
 * translating null into an AppError keeps the no-key path working.
 */
export class SondialLLMProvider implements LLMProvider {
  readonly name: string;

  constructor(name?: string) {
    this.name = name ?? resolveLlmProvider();
  }

  private get model() {
    return this.name === "anthropic"
      ? process.env.ANTHROPIC_MODEL || "claude-haiku-4-5"
      : process.env.GEMINI_MODEL || "gemini-3.8-flash";
  }

  async complete(messages: ChatMessage[]): Promise<LLMCompletion> {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const user = messages
      .filter((message) => message.role !== "system")
      .map((message) => message.content)
      .join("\n\n");

    const text = await callLLM(system, user, { json: true, maxTokens: 2000, temperature: 0.2 });
    if (!text) {
      throw new AppError(
        `${this.name} returned no completion for the component plan`,
        "llm_unavailable",
        502,
      );
    }
    return { text, provider: this.name, model: this.model };
  }
}
