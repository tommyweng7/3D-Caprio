import { resolveLlmProvider } from "@/lib/llm";
import { HeuristicLLMProvider } from "@/caprio/llm/heuristic-provider";
import { SondialLLMProvider } from "@/caprio/llm/sondial-provider";
import type { LLMProvider } from "@/caprio/llm/provider";

/**
 * Follows Sondial's LLM_PROVIDER selection. `mock` maps to Caprio's heuristic
 * planner, which is the deterministic no-key path for component decomposition.
 */
export function createLLMProvider(override?: LLMProvider): LLMProvider {
  if (override) return override;
  const explicit = (process.env.CAPRIO_LLM_PROVIDER || process.env.LLM_PROVIDER)?.trim().toLowerCase();
  if (explicit === "heuristic" || explicit === "mock") {
    return new HeuristicLLMProvider();
  }
  const name = explicit === "gemini" || explicit === "anthropic" ? explicit : resolveLlmProvider();
  if (name === "mock") return new HeuristicLLMProvider();
  return new SondialLLMProvider(name);
}
