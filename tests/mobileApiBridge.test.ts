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
      model: "deepseek-ai/deepseek-v4-flash-0731",
      messages: [
        { role: "system", content: "Ты внимательный литературный помощник. Отвечай по-русски." },
        { role: "user", content: "Тест." },
      ],
      temperature: 0.75,
      max_tokens: 2048,
    },
  }]);
});

test("explicit NVIDIA literary profile is sent to the NVIDIA endpoint", async () => {
  let requestedModel = "";
  await withMockFetch(async (_url, init) => {
    requestedModel = JSON.parse(String(init?.body || "{}")).model;
    return new Response(JSON.stringify({ choices: [{ message: { content: "Проза." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "nvidia",
    model: "z-ai/glm-5.2",
    apiKeys: { nvidia: "nvapi-test" },
    prompt: "Тест выбора профиля.",
  }));
  assert.equal(requestedModel, "z-ai/glm-5.2");
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
    model: "minimaxai/minimax-m3",
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

test("OpenRouter switches the selected model to free-router and rotates to the next key after quota errors", async () => {
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
    model: "openrouter/example-primary",
    apiKeys: { openrouter: "first-key; second-key" },
    prompt: "Тест fallback.",
  }));

  assert.equal(result, "Ответ после ротации");
  assert.deepEqual(calls, [
    { model: "openrouter/example-primary", authorization: "Bearer first-key" },
    { model: "openrouter/free", authorization: "Bearer first-key" },
    { model: "openrouter/example-primary", authorization: "Bearer second-key" },
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
    model: "openrouter/example-primary",
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
  assert.equal(typeof payload.humanizeReport?.scoreBefore, "number");
  assert.equal(typeof payload.humanizeReport?.scoreAfter, "number");
  assert.equal(payload.humanizeReport?.depth, "maximum");
});

test("humanize local audit runs a corrective ratchet pass when the gate fails, but rejects a too-short correction", async () => {
  const stampyDraft = "Не просто шёл, а словно нехотя. Не просто шёл, а словно нехотя. Не просто шёл, а словно нехотя. Не просто шёл, а словно нехотя.";
  const calls: string[] = [];
  const response = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push(body.messages?.[1]?.content || "");
    // Первый вызов (humanize-проход) и корректирующий ратчет-проход оба
    // возвращают тот же перегруженный штампами текст без улучшения.
    return new Response(JSON.stringify({ choices: [{ message: { content: stampyDraft } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "continue",
      text: "Начало сцены.",
      humanize: true,
      humanizeDepth: "maximum",
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls.length, 3); // черновик + humanize-проход + один корректирующий ратчет-проход
  assert.equal(payload.humanizeReport.gatePassed, false);
  assert.equal(payload.humanizeReport.passesRun, 2); // корректирующий проход принят (не короче, score не хуже), но сам gate так и не пройден
  assert.equal(payload.humanizeReport.unresolvedLabels.length > 0, true);
  assert.equal(calls[2].includes("Локальный аудит нашёл проблемы"), true);
});

test("OpenRouter falls back when the selected model returns HTTP 200 without visible content", async () => {
  const calls: string[] = [];
  const text = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push(body.model);
    if (body.model === "openrouter/example-primary") {
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "length", message: { content: null } }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "Текст от free-router." } }],
    }), { status: 200 });
  }, () => directGenerate({
    provider: "openrouter",
    model: "openrouter/example-primary",
    apiKeys: { openrouter: "sk-or-test" },
    prompt: "Проверь fallback пустого ответа.",
  }));

  assert.equal(text, "Текст от free-router.");
  assert.deepEqual(calls, ["openrouter/example-primary", "openrouter/free"]);
});

test("OpenRouter sends the selected literary profile instead of a hidden default", async () => {
  let requestedModel = "";
  await withMockFetch(async (_url, init) => {
    requestedModel = JSON.parse(String(init?.body || "{}")).model;
    return new Response(JSON.stringify({ choices: [{ message: { content: "Автоматический выбор." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "openrouter",
    model: "deepseek/deepseek-v3.2",
    apiKeys: { openrouter: "sk-or-test" },
    prompt: "Тест автоматической модели.",
  }));
  assert.equal(requestedModel, "deepseek/deepseek-v3.2");
});

test("NVIDIA retries once with a smaller output budget after HTTP 504", async () => {
  const tokenBudgets: number[] = [];
  const text = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    tokenBudgets.push(body.max_tokens);
    if (tokenBudgets.length === 1) {
      return new Response(JSON.stringify({ error: { message: "Gateway timeout" } }), { status: 504 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Ответ после повтора NVIDIA." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "nvidia",
    model: "meta/llama-3.3-70b-instruct",
    apiKeys: { nvidia: "nvapi-test" },
    prompt: "Тест 504.",
    maxTokens: 6_144,
  }));
  assert.equal(text, "Ответ после повтора NVIDIA.");
  assert.deepEqual(tokenBudgets, [6_144, 4_096]);
});

test("full chapter request targets 3300 words", async () => {
  const bodies: any[] = [];
  await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    bodies.push(body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Готовая глава." } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "generate_full_chapter",
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  assert.equal(bodies[0].max_tokens, 6_144);
  assert.equal(bodies.some((body) => body.messages[1].content.includes("около 3 300 слов")), true);
});

test("single OpenRouter key reports that rotation cannot run after quota error", async () => {
  const response = await withMockFetch(async () => new Response(JSON.stringify({
    error: { message: "Недостаточно квоты" },
  }), { status: 402 }), () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "continue",
      llmApiFields: { llmProvider: "openrouter", apiKeys: { openrouter: "only-one-key" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 402);
  assert.equal(payload.error.includes("сохранён только ключ 1/1"), true);
});

test("NVIDIA rotates to a backup model after its retry also times out", async () => {
  const models: string[] = [];
  const text = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    models.push(body.model);
    if (models.length < 3) return new Response(JSON.stringify({ error: { message: "Timeout" } }), { status: 504 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "Ответ резервной NVIDIA-модели." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "nvidia",
    model: "meta/llama-3.3-70b-instruct",
    apiKeys: { nvidia: "nvapi-test" },
    prompt: "Тест ротации NVIDIA.",
    maxTokens: 6_144,
  }));
  assert.equal(text, "Ответ резервной NVIDIA-модели.");
  assert.deepEqual(models, [
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.3-70b-instruct",
    "deepseek-ai/deepseek-v4-flash-0731",
  ]);
});

test("NVIDIA falls through to Groq after all bounded NVIDIA model attempts fail", async () => {
  const calls: Array<{ url: string; model: string }> = [];
  const text = await withMockFetch(async (url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push({ url, model: body.model });
    if (url.includes("integrate.api.nvidia.com")) {
      return new Response(JSON.stringify({ error: { message: "Gateway unavailable" } }), { status: 504 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Ответ Groq после NVIDIA." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "nvidia",
    model: "meta/llama-3.3-70b-instruct",
    apiKeys: { nvidia: "nvapi-test", groq: "gsk-test" },
    prompt: "Тест межпровайдерного fallback.",
    maxTokens: 6_144,
  }));
  assert.equal(text, "Ответ Groq после NVIDIA.");
  assert.deepEqual(calls.map((call) => call.model), [
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.3-70b-instruct",
    "deepseek-ai/deepseek-v4-flash-0731",
    "z-ai/glm-5.2",
    "openai/gpt-oss-120b",
  ]);
  assert.equal(calls.at(-1)?.url, "https://api.groq.com/openai/v1/chat/completions");
});

test("all NVIDIA 504 diagnostics show retry, model rotations, and Groq handoff", async () => {
  const globals = globalThis as any;
  const savedWindow = globals.window;
  const savedCustomEvent = globals.CustomEvent;
  const events: any[] = [];
  class TestCustomEvent extends Event {
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      super(type);
      this.detail = init?.detail;
    }
  }
  const eventTarget = new EventTarget();
  globals.window = eventTarget;
  globals.CustomEvent = TestCustomEvent;
  eventTarget.addEventListener("writers-studio-api-trace", (event: Event) => events.push((event as any).detail));

  try {
    const result = await withMockFetch(async (url) => {
      if (url.includes("integrate.api.nvidia.com")) {
        return new Response(JSON.stringify({ error: { message: "Gateway unavailable" } }), { status: 504 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "Groq завершил запрос." } }] }), { status: 200 });
    }, () => directGenerate({
      provider: "nvidia",
      model: "meta/llama-3.3-70b-instruct",
      apiKeys: { nvidia: "nvapi-test", groq: "gsk-test" },
      prompt: "Тест журнала NVIDIA 504.",
      maxTokens: 6_144,
    }));
    assert.equal(result, "Groq завершил запрос.");
    assert.equal(events.some((trace) => trace.message?.includes("повтор с лимитом 4096")), true);
    assert.equal(events.some((trace) => trace.message?.includes("meta/llama-3.3-70b-instruct → deepseek-ai/deepseek-v4-flash-0731")), true);
    assert.equal(events.some((trace) => trace.message?.includes("deepseek-ai/deepseek-v4-flash-0731 → z-ai/glm-5.2")), true);
    assert.equal(events.some((trace) => trace.message?.includes("переход к Groq")), true);
    assert.equal(events.at(-1)?.provider, "groq");
    assert.equal(events.at(-1)?.status, 200);
  } finally {
    if (savedWindow === undefined) delete globals.window; else globals.window = savedWindow;
    if (savedCustomEvent === undefined) delete globals.CustomEvent; else globals.CustomEvent = savedCustomEvent;
  }
});

test("full chapter is extended in segments until it reaches the 3300-word target", async () => {
  const chunk = Array.from({ length: 600 }, () => "слово").join(" ");
  let calls = 0;
  const response = await withMockFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: chunk } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "generate_full_chapter",
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls, 6);
  assert.equal(payload.chapterTargetWords, 3300);
  assert.equal(payload.chapterWords, 3600);
  assert.equal(payload.chapterSegments, 6);
});

test("full chapter keeps the assembled draft when humanize pass is much shorter", async () => {
  const chunk = Array.from({ length: 700 }, () => "фрагмент").join(" ");
  let calls = 0;
  const response = await withMockFetch(async () => {
    calls += 1;
    const content = calls <= 5 ? chunk : "Слишком короткая редактура.";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "generate_full_chapter",
      humanize: true,
      humanizeDepth: "maximum",
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls, 7);
  assert.equal(payload.chapterWords, 3500);
  assert.equal(payload.result.includes("фрагмент"), true);
  assert.equal(payload.result.includes("Слишком короткая редактура."), false);
});

test("Gemini sends the selected literary profile to its matching endpoint", async () => {
  let requestedUrl = "";
  await withMockFetch(async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Текст Gemini." }] } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    apiKeys: { gemini: "AIza-test" },
    prompt: "Тест профиля Gemini.",
  }));
  assert.equal(requestedUrl.includes("models/gemini-3.1-pro-preview:generateContent"), true);
});

test("Groq sends the selected literary profile to its OpenAI-compatible endpoint", async () => {
  let requestedModel = "";
  await withMockFetch(async (_url, init) => {
    requestedModel = JSON.parse(String(init?.body || "{}")).model;
    return new Response(JSON.stringify({ choices: [{ message: { content: "Текст Groq." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "groq",
    model: "qwen/qwen3.6-27b",
    apiKeys: { groq: "gsk-test" },
    prompt: "Тест профиля Groq.",
  }));
  assert.equal(requestedModel, "qwen/qwen3.6-27b");
});

test("a selected OpenRouter DeepSeek profile falls back to free-router when unavailable", async () => {
  const calls: string[] = [];
  const text = await withMockFetch(async (_url, init) => {
    const model = JSON.parse(String(init?.body || "{}")).model;
    calls.push(model);
    if (model === "deepseek/deepseek-v3.2") {
      return new Response(JSON.stringify({ error: { message: "Model unavailable" } }), { status: 404 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Текст от free-router." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "openrouter",
    model: "deepseek/deepseek-v3.2",
    apiKeys: { openrouter: "sk-or-test" },
    prompt: "Тест fallback профиля.",
  }));
  assert.equal(text, "Текст от free-router.");
  assert.deepEqual(calls, ["deepseek/deepseek-v3.2", "openrouter/free"]);
});

test("a dynamic OpenRouter catalog model is sent and falls back to free-router", async () => {
  const calls: string[] = [];
  const text = await withMockFetch(async (_url, init) => {
    const model = JSON.parse(String(init?.body || "{}")).model;
    calls.push(model);
    if (model === "qwen/qwen3.5-397b-a17b") {
      return new Response(JSON.stringify({ error: { message: "Temporary provider error" } }), { status: 503 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Текст от резервного OpenRouter." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "openrouter",
    model: "qwen/qwen3.5-397b-a17b",
    apiKeys: { openrouter: "sk-or-test" },
    prompt: "Тест модели из каталога.",
  }));
  assert.equal(text, "Текст от резервного OpenRouter.");
  assert.deepEqual(calls, ["qwen/qwen3.5-397b-a17b", "openrouter/free"]);
});
