export type OpenRouterCatalogModel = {
  id: string;
  name: string;
  contextLength: number;
  description: string;
};

type OpenRouterModelsResponse = {
  data?: Array<{
    id?: unknown;
    name?: unknown;
    context_length?: unknown;
    description?: unknown;
    architecture?: { output_modalities?: unknown };
  }>;
};

export const OPENROUTER_ROLEPLAY_MODELS_URL = "https://openrouter.ai/api/v1/models?category=roleplay&output_modalities=text";

/** Безопасный slug OpenRouter: provider/model, без пробелов и управляющих символов. */
export function isOpenRouterModelId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)+$/.test(value)
    && value.length <= 160;
}

export function normalizeOpenRouterCatalog(payload: OpenRouterModelsResponse): OpenRouterCatalogModel[] {
  const seen = new Set<string>();
  return (Array.isArray(payload.data) ? payload.data : [])
    .map((item) => ({
      id: typeof item.id === "string" ? item.id.trim() : "",
      name: typeof item.name === "string" ? item.name.trim() : "",
      contextLength: typeof item.context_length === "number" && Number.isFinite(item.context_length)
        ? item.context_length
        : 0,
      description: typeof item.description === "string" ? item.description.trim() : "",
      textOutput: Array.isArray(item.architecture?.output_modalities)
        ? item.architecture.output_modalities.includes("text")
        : true,
    }))
    .filter((item) => item.textOutput && isOpenRouterModelId(item.id) && !seen.has(item.id) && Boolean(seen.add(item.id)))
    .map(({ textOutput: _textOutput, ...item }) => item)
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

export async function fetchOpenRouterRoleplayModels(fetcher: typeof fetch = fetch): Promise<OpenRouterCatalogModel[]> {
  const response = await fetcher(OPENROUTER_ROLEPLAY_MODELS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Каталог OpenRouter временно недоступен (HTTP ${response.status}).`);
  return normalizeOpenRouterCatalog(await response.json() as OpenRouterModelsResponse);
}
