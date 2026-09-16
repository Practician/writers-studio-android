import assert from "node:assert/strict";
import test from "node:test";
import { directApi, directGenerate } from "../src/lib/directLlmClient";
import { splitApiKeyPool } from "../src/lib/directLlmClient";
import { HUMANIZE_DEPTHS } from "../server/humanStyle";

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
    model: "minimaxai/minimax-m3",
    apiKeys: { nvidia: "nvapi-test" },
    prompt: "Тест выбора профиля.",
  }));
  assert.equal(requestedModel, "minimaxai/minimax-m3");
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
    model: "stepfun-ai/step-3.7-flash",
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

test("continue with humanize returns a pipeline report after the humanize-drafted continuation", async () => {
  const prompts: string[] = [];
  const response = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    prompts.push(body.messages?.[1]?.content || "");
    return new Response(JSON.stringify({ choices: [{ message: { content: "Живой фрагмент продолжения с неровным ритмом и конкретной деталью. ".repeat(8).trim() } }] }), { status: 200 });
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
  assert.equal(payload.humanizeApplied, true, "humanizeApplied");
  assert.equal(payload.humanizeReport?.depth, "maximum", "report depth");
  assert.equal(typeof payload.humanizeReport?.scoreBefore, "number", "scoreBefore");
  assert.equal(prompts[0].includes("РЕЖИМ ОЧЕЛОВЕЧИВАНИЯ (MAXIMUM)"), true, "humanize directive in draft prompt");
  assert.equal(typeof payload.result, "string");
  assert.equal(payload.result.length > 0, true);
});

test("pipeline keeps the stampy segment when the rewrite brings no improvement", async () => {
  const stampyBlock = "Не просто шёл, а словно нехотя. ";
  const stampyDraft = stampyBlock.repeat(30).trim();
  const calls: string[] = [];
  const response = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const promptText = body.messages?.[1]?.content || "";
    calls.push(promptText);
    if (promptText.includes("priority-blocks")) {
      // Пайплайн предлагает тот же текст — локальная приёмка не видит улучшения
      // и не принимает правку; сегмент остаётся в исходном виде.
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [stampyDraft] }) } }] }), { status: 200 });
    }
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
  assert.equal(payload.humanizeReport.gatePassed, false);
  assert.equal(payload.humanizeReport.unresolvedLabels.length > 0, true);
  assert.equal(payload.result.includes("словно"), true);
  assert.equal(calls.length >= 2, true);
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
    "minimaxai/minimax-m3",
    "openai/gpt-oss-120b",
  ]);
  assert.equal(calls.at(-1)?.url, "https://api.groq.com/openai/v1/chat/completions");
});

test("Gemini HTTP 503 (high demand) rotates its own models before falling back to Groq", async () => {
  const calls: Array<{ url: string }> = [];
  const text = await withMockFetch(async (url) => {
    calls.push({ url });
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 503 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Ответ Groq после перегрузки Gemini." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "gemini",
    model: "gemini-3.7-flash",
    apiKeys: { gemini: "AIza-test", groq: "gsk-test" },
    prompt: "Тест fallback при перегрузке Gemini.",
    maxTokens: 2_048,
  }));
  assert.equal(text, "Ответ Groq после перегрузки Gemini.");
  // Все 4 литературных профиля Gemini перегружены (503), затем переход к Groq.
  assert.equal(calls.length, 5);
  assert.equal(calls.slice(0, 4).every((call) => call.url.includes("generativelanguage.googleapis.com")), true);
  assert.equal(calls[0].url.includes("models/gemini-3.7-flash:generateContent"), true);
  assert.equal(calls[1].url.includes("models/gemini-3.8-flash:generateContent"), true);
  assert.equal(calls[2].url.includes("models/gemini-3.6-flash:generateContent"), true);
  assert.equal(calls[3].url.includes("models/gemini-2.5-flash:generateContent"), true);
  assert.equal(calls[4].url, "https://api.groq.com/openai/v1/chat/completions");
});

test("Gemini recovers on its second literary model after the first returns HTTP 503", async () => {
  const calls: string[] = [];
  const text = await withMockFetch(async (url) => {
    calls.push(url);
    if (url.includes("models/gemini-3.7-flash:generateContent")) {
      return new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 503 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Ответ от резервной модели Gemini." }] } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "gemini",
    model: "gemini-3.7-flash",
    apiKeys: { gemini: "AIza-test" },
    prompt: "Тест ротации моделей внутри Gemini.",
    maxTokens: 2_048,
  }));
  assert.equal(text, "Ответ от резервной модели Gemini.");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].includes("models/gemini-3.8-flash:generateContent"), true);
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
    assert.equal(events.some((trace) => trace.message?.includes("deepseek-ai/deepseek-v4-flash-0731 → minimaxai/minimax-m3")), true);
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

test("generate_full_chapter + humanize runs the sepia pipeline through the bridge", async () => {
  // Выбираем глубину без сценового планирования — детерминированный путь:
  // один черновик + пайплайн touchup, без бит-плана с JSON-парсингом.
  const depthId = (["fast", "balanced", "maximum"] as const).find((d) => !HUMANIZE_DEPTHS[d].sceneGeneration) ?? "fast";
  const chunk = Array.from({ length: 300 }, () => "фрагмент").join(" ");
  let calls = 0;
  const response = await withMockFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: chunk } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "generate_full_chapter",
      title: "Тестовая книга",
      genre: "боевик",
      description: "Одна глава для проверки моста.",
      currentChapterTitle: "Глава 1",
      humanize: true,
      humanizeDepth: depthId,
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.humanizeApplied, true);
  assert.equal(payload.humanizeReport?.depth, depthId);
  assert.equal(typeof payload.chapterWords, "number");
  assert.equal(payload.result.includes("фрагмент"), true);
  assert.equal(calls >= 1, true);
});

test("Gemini sends the selected literary profile to its matching endpoint", async () => {
  let requestedUrl = "";
  await withMockFetch(async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Текст Gemini." }] } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "gemini",
    model: "gemini-3.8-flash",
    apiKeys: { gemini: "AIza-test" },
    prompt: "Тест профиля Gemini.",
  }));
  assert.equal(requestedUrl.includes("models/gemini-3.8-flash:generateContent"), true);
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

test("NVIDIA HTTP 410 (retired model) continues rotating to the next model instead of giving up", async () => {
  const models: string[] = [];
  const text = await withMockFetch(async (_url, init) => {
    const model = JSON.parse(String(init?.body || "{}")).model;
    models.push(model);
    if (model === "deepseek-ai/deepseek-v4-flash-0731") {
      return new Response(JSON.stringify({ error: { message: "Model not found" } }), { status: 410 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Ответ от следующей модели после 410." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "nvidia",
    model: "deepseek-ai/deepseek-v4-flash-0731",
    apiKeys: { nvidia: "nvapi-test" },
    prompt: "Тест ротации после 410.",
  }));
  assert.equal(text, "Ответ от следующей модели после 410.");
  assert.deepEqual(models, ["deepseek-ai/deepseek-v4-flash-0731", "minimaxai/minimax-m3"]);
});

test("a hanging NVIDIA request is aborted client-side and rotates instead of waiting for the real gateway", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: string[] = [];
  const resultPromise = withMockFetch(async (url, init) => {
    calls.push(url);
    if (calls.length === 1) {
      // Первый запрос "виснет" бесконечно — как реальный шлюз NVIDIA при перегрузке,
      // который может не отвечать по 4-5 минут. Разрешается только по abort-сигналу.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Ответ после клиентского таймаута." } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "nvidia",
    model: "deepseek-ai/deepseek-v4-flash-0731",
    apiKeys: { nvidia: "nvapi-test" },
    prompt: "Тест клиентского таймаута.",
  }));
  t.mock.timers.tick(90_000);
  const text = await resultPromise;
  assert.equal(text, "Ответ после клиентского таймаута.");
  assert.equal(calls.length, 2);
});

test("long-draft improve uses the action token budget for the draft and returns a pipeline report", async () => {
  const requestedMaxTokens: number[] = [];
  const longDraft = "Слово ".repeat(4_100).trim(); // ~26 000 символов, как собранная глава.
  const response = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    requestedMaxTokens.push(body.max_tokens);
    return new Response(JSON.stringify({ choices: [{ message: { content: longDraft } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "improve",
      text: longDraft,
      humanize: true,
      humanizeDepth: "balanced",
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(requestedMaxTokens[0], 2_048, "draft uses action budget");
  assert.equal(payload.humanizeApplied, true, "humanizeApplied");
  assert.equal(payload.humanizeReport?.depth, "balanced", "report depth");
  assert.equal(typeof payload.humanizeReport?.scoreBefore, "number", "scoreBefore");
});

test("maximum depth without an author style sample is rejected in the bridge pipeline", async () => {
  const response = await withMockFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Глава." } }] }), { status: 200 }), () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "generate_full_chapter",
      humanize: true,
      humanizeDepth: "maximum",
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error.includes("образец стиля"), true);
});

test("rewrite_detector_segments batches AI segments through the pipeline and keeps HUMAN verbatim", async () => {
  const rewriteCalls: string[] = [];
  const requestedModels: string[] = [];
  const response = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    requestedModels.push(body.model);
    const promptText = body.messages?.[1]?.content || "";
    rewriteCalls.push(promptText);
    if (promptText.includes("ai-segments")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: ["Он свернул к воротам.", "Голос стих за дверью."] }) } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Иной ответ." } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "rewrite_detector_segments",
      humanizeDepth: "maximum",
      detectorSegments: [
        { text: "Человеческий фрагмент, который детектор не тронул.", label: "HUMAN" },
        { text: "Не просто шёл, а словно нехотя, при этом следил за коридором.", label: "AI" },
        { text: "Ещё один человеческий кусок диалога.", label: "HUMAN" },
        { text: "Кроме того, данная ситуация в целом была достаточно сложной.", label: "LIKELY_AI" },
      ],
      llmApiFields: { llmProvider: "nvidia", model: "deepseek-ai/deepseek-v4-flash-0731", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  // Два AI-сегмента уходят одним батч-вызовом пайплайна (не по одному на сегмент).
  assert.equal(rewriteCalls.length, 1);
  assert.equal(rewriteCalls[0].includes("ai-segments"), true);
  assert.equal(rewriteCalls[0].includes("ФРАГМЕНТ:"), false);
  // Пайплайн получает выбранную модель провайдера.
  assert.equal(requestedModels[0], "deepseek-ai/deepseek-v4-flash-0731");
  // HUMAN-сегменты сохраняются дословно и не отправлялись на переписывание.
  assert.equal(payload.blocks[0], "Человеческий фрагмент, который детектор не тронул.");
  assert.equal(payload.blocks[2], "Ещё один человеческий кусок диалога.");
  assert.equal(payload.rewrittenCount, 2);
  assert.equal(payload.humanizeReport.detectorSegmentsRewritten, 2);
  assert.equal(payload.result.includes("Он свернул к воротам."), true);
  assert.equal(payload.result.includes("Не просто шёл, а словно нехотя"), false);
});

test("rewrite_detector_segments keeps the original segment when the rewrite is truncated too short", async () => {
  const originalSegment = "Слово ".repeat(200).trim(); // длинный ИИ-фрагмент
  const response = await withMockFetch(async () => {
    return new Response(JSON.stringify({ choices: [{ message: { content: "Слишком короткая правка." } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "rewrite_detector_segments",
      humanizeDepth: "maximum",
      detectorSegments: [{ text: originalSegment, label: "AI" }],
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(payload.rewrittenCount, 0);
  assert.equal(payload.result, originalSegment);
});

test("improve drafts by task and never falls back to the legacy manual humanize prompt", async () => {
  const prompts: string[] = [];
  const response = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const promptText = body.messages?.[1]?.content || "";
    prompts.push(promptText);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Живой отредактированный текст с неровным ритмом и конкретной деталью. ".repeat(8).trim() } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "improve",
      text: "Короткий черновик для проверки.",
      humanize: true,
      humanizeDepth: "balanced",
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(prompts[0].includes("Перепиши текст по задаче"), true, "task directive");
  assert.equal(prompts.every((prompt) => !prompt.includes("ЧЕРНОВИК ДЛЯ ФИНАЛЬНОГО ОЧЕЛОВЕЧИВАНИЯ")), true, "legacy manual pass removed");
  assert.equal(prompts.every((prompt) => !prompt.includes("Локальный аудит нашёл проблемы")), true, "legacy ratchet removed");
  assert.equal(payload.result.includes("неровным ритмом"), true);
  assert.equal(payload.humanizeReport?.depth, "balanced", "report depth");
});

test("bridge forwards the selected provider model into pipeline calls", async () => {
  const requestedModels: string[] = [];
  const response = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    requestedModels.push(body.model);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Текст. ".repeat(120).trim() } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "improve",
      text: "Короткий черновик для проверки.",
      humanize: true,
      humanizeDepth: "balanced",
      llmApiFields: { llmProvider: "nvidia", model: "deepseek-ai/deepseek-v4-flash-0731", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(requestedModels[0], "deepseek-ai/deepseek-v4-flash-0731", "selected model reaches provider");
  assert.equal(payload.humanizeReport?.depth, "balanced", "report depth");
});

test("rewrite_detector_segments keeps the segment when the pipeline finds no tell reduction", async () => {
  const originalSegment = "Не просто шёл, а словно нехотя. Не просто шёл, а словно нехотя.";
  const response = await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const promptText = body.messages?.[1]?.content || "";
    if (promptText.includes("ai-segments")) {
      // Модель вернула тот же текст — приёмка по локальному аудиту не засчитывает
      // правку, оригинал остаётся в результате.
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [originalSegment] }) } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: originalSegment } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "rewrite_detector_segments",
      humanizeDepth: "maximum",
      detectorSegments: [{ text: originalSegment, label: "AI" }],
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.rewrittenCount, 0);
  assert.equal(payload.result, originalSegment);
  assert.equal(payload.humanizeReport.detectorSegmentsRewritten, 0);
});

test("provider cascade never bounces back to an already-failed provider and reaches OpenRouter", async () => {
  // Раньше NVIDIA и Gemini могли бесконечно перебрасывать друг на друга (у обоих
  // есть ключ), и OpenRouter, будучи последним в списке, так и не вызывался.
  const providersHit: string[] = [];
  const text = await withMockFetch(async (url) => {
    if (url.includes("integrate.api.nvidia.com")) { providersHit.push("nvidia"); return new Response(JSON.stringify({ error: {} }), { status: 504 }); }
    if (url.includes("generativelanguage.googleapis.com")) { providersHit.push("gemini"); return new Response(JSON.stringify({ error: {} }), { status: 503 }); }
    if (url.includes("openrouter.ai")) { providersHit.push("openrouter"); return new Response(JSON.stringify({ choices: [{ message: { content: "Ответ OpenRouter после полного каскада." } }] }), { status: 200 }); }
    return new Response(JSON.stringify({ error: {} }), { status: 500 });
  }, () => directGenerate({
    provider: "nvidia",
    model: "meta/llama-3.3-70b-instruct", // модель вне встроенной цепочки NVIDIA — рвётся сразу на провайдерный каскад
    apiKeys: { nvidia: "nvapi-test", gemini: "AIza-test", openrouter: "sk-or-test" },
    prompt: "Тест полного каскада без пинг-понга.",
  }));
  assert.equal(text, "Ответ OpenRouter после полного каскада.");
  assert.equal(providersHit.includes("openrouter"), true);
  // Каждый провайдер встречается в каскаде, но набор различных провайдеров —
  // ровно nvidia/gemini/openrouter, без повторного возврата к уже отказавшему.
  assert.deepEqual([...new Set(providersHit)].sort(), ["gemini", "nvidia", "openrouter"].sort());
});

test("Gemini HTTP 429 on one model still rotates to the next model (per-model quotas, unlike NVIDIA)", async () => {
  const models: string[] = [];
  const text = await withMockFetch(async (url) => {
    const model = url.match(/models\/([^:]+):generateContent/)?.[1] || "";
    models.push(model);
    if (model === "gemini-3.7-flash") {
      return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
    }
    if (model === "gemini-3.6-flash") {
      return new Response(JSON.stringify({ error: { message: "Quota exceeded for metric" } }), { status: 429 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Ответ от третьей модели Gemini." }] } }] }), { status: 200 });
  }, () => directGenerate({
    provider: "gemini",
    model: "gemini-3.7-flash",
    apiKeys: { gemini: "AIza-test" },
    prompt: "Тест ротации после 429 у отдельной модели.",
  }));
  assert.equal(text, "Ответ от третьей модели Gemini.");
  assert.deepEqual(models, ["gemini-3.7-flash", "gemini-3.8-flash"]);
});

test("humanize pass rejects a result inflated ~40% beyond the draft (padding, not polish) and keeps the original", async () => {
  const originalDraft = "Слово ".repeat(1_000).trim(); // 1000 слов — реалистичный объём главы
  const inflatedResult = "Обзор ".repeat(1_400).trim(); // +40% — как в реальном логе, где текст раздулся
  let calls = 0;
  const response = await withMockFetch(async () => {
    calls += 1;
    // 1-й вызов — это "improve"-переписывание (ещё не сам проход очеловечивания);
    // возвращаем его без раздутия, чтобы raздутие проверялось именно на проходе humanize.
    const content = calls === 1 ? originalDraft : inflatedResult;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }, () => directApi("/api/writer/ai", {
    method: "POST",
    body: JSON.stringify({
      action: "improve",
      text: originalDraft,
      humanize: true,
      humanizeDepth: "fast",
      llmApiFields: { llmProvider: "nvidia", apiKeys: { nvidia: "nvapi-test" } },
    }),
  }));
  const payload = await response.json();
  assert.equal(payload.result, originalDraft);
});

test("splitApiKeyPool: пусто/один/N ключей, дедупликация и обрезка пробелов", () => {
  assert.deepEqual(splitApiKeyPool(""), []);
  assert.deepEqual(splitApiKeyPool("   "), []);
  assert.deepEqual(splitApiKeyPool("AIza-one"), ["AIza-one"]);
  assert.deepEqual(splitApiKeyPool("AIza-one\nAIza-two;AIza-three, AIza-one ,,AIza-two "), ["AIza-one", "AIza-two", "AIza-three"]);
});

test("Gemini: при квоте на первых двух ключах переходит на третий (ротация нескольких ключей APK)", async () => {
  const keysUsed: string[] = [];
  const orig = globalThis.fetch;
  (globalThis as any).fetch = async (url: any) => {
    const u = String(url);
    const key = u.match(/[?&]key=([^&]+)/)?.[1] || "";
    keysUsed.push(key);
    if (key === "AIza-key1" || key === "AIza-key2") {
      return new Response(JSON.stringify({ error: { message: "Quota exceeded for metric" } }), { status: 429 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Ответ третьим ключом Gemini." }] } }] }), { status: 200 });
  };
  try {
    const text = await directGenerate({
      provider: "gemini",
      model: "gemini-3.8-flash",
      apiKeys: { gemini: "AIza-key1\nAIza-key2\nAIza-key3" },
      prompt: "Тест ротации нескольких ключей Gemini.",
      maxTokens: 512,
    });
    console.log("KEYS_USED=" + JSON.stringify(keysUsed));
    assert.equal(text, "Ответ третьим ключом Gemini.");
    // На каждом ключе сначала перебирается вся цепочка моделей 3.8→3.7→3.6→2.5,
    // затем идёт переход к следующему ключу.
    assert.equal(keysUsed.filter((k) => k === "AIza-key1").length, 4);
    assert.equal(keysUsed.filter((k) => k === "AIza-key2").length, 4);
    assert.equal(keysUsed.filter((k) => k === "AIza-key3").length, 1);
    assert.deepEqual([...new Set(keysUsed)], ["AIza-key1", "AIza-key2", "AIza-key3"]);
  } finally {
    (globalThis as any).fetch = orig;
  }
});

