export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompletion {
  text: string;
  provider: string;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  complete(messages: ChatMessage[]): Promise<LLMCompletion>;
}

function parseJsonSlice(slice: string): unknown {
  try {
    return JSON.parse(slice);
  } catch {
    return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
  }
}

export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const objStart = raw.indexOf("{");
  const arrStart = raw.indexOf("[");
  const useArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
  if (useArray) {
    const end = raw.lastIndexOf("]");
    if (end <= arrStart) throw new Error("LLM response did not contain JSON");
    return parseJsonSlice(raw.slice(arrStart, end + 1));
  }
  if (objStart === -1) throw new Error("LLM response did not contain JSON");
  const end = raw.lastIndexOf("}");
  if (end <= objStart) throw new Error("LLM response did not contain JSON");
  return parseJsonSlice(raw.slice(objStart, end + 1));
}
