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
      max_tokens: 2048,
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
    keyIndex: 1,
    keyCount: 1,
    status: 404,
    outputChars: 0,
    message: "Маршрут не найден",
  });
  assert.equal(JSON.stringify(payload).includes("very-secret"), false);
});

test("OpenRouter switches Ox Alpha to free-router and rotates to the next key after quota errors", async () => {
  const calls: Array<{ model: string; authorization: string }> = [];
  const result = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const headers = init?.headers as Record<string, string>;
    calls.push({ model: body.model, authorization: headers.Authorization });
    const isSecondKeyFreeRouter = headers.Authorization === "Bearer second-key" && body.model === "openrouter/free";
    return isSecondKeyFreeRouter
      ? new Response(JSON.stringify({ choices: [{ message: { content: "Ответ после ротации" } }] }), { status: 200 })
      : new Response(JSON.stringify({ error: { message: "Недостаточно квоты" } }), { status: 402 });
  }, () => directGenerate({
    provider: "openrouter",
    model: "stealth/ox-alpha",
    apiKeys: { openrouter: "first-key; second-key" },
    prompt: "Тест fallback.",
  }));

  assert.equal(result, "Ответ после ротации");
  assert.deepEqual(calls, [
    { model: "stealth/ox-alpha", authorization: "Bearer first-key" },
    { model: "openrouter/free", authorization: "Bearer first-key" },
    { model: "stealth/ox-alpha", authorization: "Bearer second-key" },
    { model: "openrouter/free", authorization: "Bearer second-key" },
  ]);
});

test("direct bridge forwards AbortSignal to the provider request", async () => {
  const controller = new AbortController();
  let wasAborted = false;
  const pending = withMockFetch(async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      wasAborted = true;
      reject(new DOMException("Cancelled", "AbortError"));
    }, { once: true });
  }), () => directApi("/api/writer/ai", {
    method: "POST",
    signal: controller.signal,
    body: JSON.stringify({
      action: "continue",
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  controller.abort();
  const response = await pending;
  const payload = await response.json();
  assert.equal(wasAborted, true);
  assert.equal(response.status, 400);
  assert.equal(payload.error, "Cancelled");
});

test("OpenRouter accepts an array-shaped message content and returns its text", async () => {
  const text = await withMockFetch(async () => new Response(JSON.stringify({
    choices: [{
      finish_reason: "stop",
      message: { content: [{ type: "text", text: "Первая часть. " }, { type: "text", text: "Вторая часть." }] },
    }],
  }), { status: 200 }), () => directGenerate({
    provider: "openrouter",
    model: "stealth/ox-alpha",
    apiKeys: { openrouter: "sk-or-test" },
    prompt: "Тест составного content.",
  }));
  assert.equal(text, "Первая часть. Вторая часть.");
});

test("HTTP 200 without a text field becomes a visible local error with zero-output diagnostics", async () => {
  const response = await withMockFetch(async () => new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: null } }],
  }), { status: 200 }), () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "continue",
      llmApiFields: { llmProvider: "openrouter", apiKeys: { openrouter: "sk-or-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 502);
  assert.equal(payload.diagnostics.status, 200);
  assert.equal(payload.diagnostics.outputChars, 0);
  assert.equal(payload.error.includes("не передал текст"), true);
});

test("autonomous writer applies a second humanize pass after drafting prose", async () => {
  const prompts: string[] = [];
  const response = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    prompts.push(body.messages?.[1]?.content || "");
    const text = prompts.length === 1 ? "Черновик с ровным ритмом." : "Живой текст с неровным ритмом и деталью.";
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "continue",
      text: "Начало сцены.",
      humanize: true,
      humanizeDepth: "maximum",
      authorSample: "Авторский образец с конкретной интонацией. ".repeat(20),
      voiceSheet: { summary: "Первое лицо, сухая наблюдательность.", voiceRules: ["Больше предметной конкретики"], avoid: ["Не делать выводов за читателя"] },
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.result, "Живой текст с неровным ритмом и деталью.");
  assert.equal(payload.humanizeApplied, true);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].includes("РЕЖИМ ОЧЕЛОВЕЧИВАНИЯ (MAXIMUM)"), true);
  assert.equal(prompts[1].includes("ЧЕРНОВИК ДЛЯ ФИНАЛЬНОГО ОЧЕЛОВЕЧИВАНИЯ"), true);
  assert.equal(prompts[1].includes("Черновик с ровным ритмом."), true);
});

test("OpenRouter falls back when Ox Alpha returns HTTP 200 without visible content", async () => {
  const calls: string[] = [];
  const text = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push(body.model);
    if (body.model === "stealth/ox-alpha") {
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "length", message: { content: null } }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "Текст от free-router." } }],
    }), { status: 200 });
  }, () => directGenerate({
    provider: "openrouter",
    model: "stealth/ox-alpha",
    apiKeys: { openrouter: "sk-or-test" },
    prompt: "Проверь fallback пустого ответа.",
  }));

  assert.equal(text, "Текст от free-router.");
  assert.deepEqual(calls, ["stealth/ox-alpha", "openrouter/free"]);
});
