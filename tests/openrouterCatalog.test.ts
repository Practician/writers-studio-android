import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPENROUTER_MODEL } from "../src/lib/llmSettings";
import { isOpenRouterModelId, normalizeOpenRouterCatalog } from "../src/lib/openrouterCatalog";

test("DeepSeek V3.2 is the default OpenRouter profile", () => {
  assert.equal(DEFAULT_OPENROUTER_MODEL, "deepseek/deepseek-v3.2");
});

test("OpenRouter catalog keeps only valid text model IDs and removes duplicates", () => {
  const models = normalizeOpenRouterCatalog({
    data: [
      { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", context_length: 163840, architecture: { output_modalities: ["text"] } },
      { id: "deepseek/deepseek-v3.2", name: "Duplicate", architecture: { output_modalities: ["text"] } },
      { id: "image/model", name: "Image only", architecture: { output_modalities: ["image"] } },
      { id: "not a valid model id", name: "Broken", architecture: { output_modalities: ["text"] } },
      { id: "xiaomi/mimo-v2.5-pro", name: "MiMo V2.5 Pro", context_length: 1050000, architecture: { output_modalities: ["text"] } },
    ],
  });

  assert.deepEqual(models.map((model) => model.id), ["deepseek/deepseek-v3.2", "xiaomi/mimo-v2.5-pro"]);
  assert.equal(models[1].contextLength, 1050000);
});

test("OpenRouter model ID validation accepts provider/model slugs and rejects manual free-form text", () => {
  assert.equal(isOpenRouterModelId("qwen/qwen3.5-397b-a17b"), true);
  assert.equal(isOpenRouterModelId("google/gemini-3.7-flash:free"), true);
  assert.equal(isOpenRouterModelId("my favourite model"), false);
  assert.equal(isOpenRouterModelId("vendor/"), false);
});
