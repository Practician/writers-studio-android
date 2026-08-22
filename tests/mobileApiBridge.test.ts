import assert from "node:assert/strict";
import test from "node:test";
import { directApi, directGenerate } from "../src/lib/directLlmClient";

async function withMockFetch<T>(handler: (url: string, init?: RequestInit) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("auto mode chooses NVIDIA and its compatible model despite stale Gemini model", async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const text = await withMockFetch(async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init?.body || "{}")) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "NVIDIA response" } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "auto",
    // Имитирует модель, которую экран UI ранее подставлял для режима «Автовыбор».
    model: "gemini-3.5-flash",
    apiKeys: { nvidia: "nvapi-test", openrouter: "sk-or-test" },
    prompt: "Тест.",
  }));

  assert.equal(text, "NVIDIA response");
  assert.deepEqual(calls, [{
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    body: {
      model: "meta/llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: "Ты внимательный литературный помощник. Отвечай по-русски." },
        { role: "user", content: "Тест." },
      ],
      temperature: 0.75,
    },
  }]);
});

test("auto mode does not include model field in UI request fields", async () => {
  const { llmRequestFields } = await import("../src/lib/llmSettings");
  const fields = llmRequestFields("auto", { gemini: "", groq: "", nvidia: "nvapi-test", openrouter: "sk-or-test" });
  assert.equal(fields.llmProvider, "auto");
  assert.equal(fields.model, undefined);
  assert.deepEqual(fields.apiKeys, { nvidia: "nvapi-test", openrouter: "sk-or-test" });
});

test("direct bridge preserves provider HTTP status and returns non-secret diagnostics", async () => {
  const response = await withMockFetch(async () => new Response(JSON.stringify({
    error: { message: "Маршрут не найден" },
  }), { status: 404 }), () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "continue",
      llmApiFields: {
        llmProvider: "nvidia",
        apiKeys: { nvidia: "nvapi-very-secret-1234" },
      },
    }),
  }));

  const payload = await response.json();
  assert.equal(response.status, 404);
  assert.equal(payload.error, "Маршрут не найден");
  assert.deepEqual(payload.diagnostics, {
    provider: "nvidia",
    model: "meta/llama-3.3-70b-instruct",
    endpoint: "integrate.api.nvidia.com/v1/chat/completions",
    keyPresent: true,
    keySuffix: "1234",
    status: 404,
    message: "Маршрут не найден",
  });
  assert.equal(JSON.stringify(payload).includes("very-secret"), false);
});
