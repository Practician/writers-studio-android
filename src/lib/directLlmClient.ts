import { Capacitor } from "@capacitor/core";
import type { AuthorEditAudit, AuthorVoiceSheet } from "../types";

export type DirectProvider = "auto" | "gemini" | "nvidia" | "groq" | "openrouter";

type ApiKeys = Partial<Record<Exclude<DirectProvider, "auto">, string>>;

type DirectRequest = {
  provider?: DirectProvider;
  model?: string;
  apiKeys?: ApiKeys;
  signal?: AbortSignal;
  system?: string;
  prompt: string;
  temperature?: number;
  json?: boolean;
};

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const OX_ALPHA_MODEL = "stealth/ox-alpha";
const OPENROUTER_FREE_ROUTER = "openrouter/free";

function notifyOpenRouterFallback(from: string, to: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("writers-studio-openrouter-fallback", { detail: { from, to } }));
}

export function isAutonomousApk(): boolean {
  return Capacitor.isNativePlatform() || import.meta.env.VITE_AUTONOMOUS === "true";
}

function requestCredentials(body: any): { provider: DirectProvider; model?: string; keys: ApiKeys } {
  const fields = body?.llmApiFields || body || {};
  const raw = fields.apiKeys || body?.apiKeys || {};
  return {
    provider: (fields.llmProvider || body?.llmProvider || "auto") as DirectProvider,
    model: fields.model || body?.model,
    keys: {
      gemini: String(raw.gemini || "").trim(),
      groq: String(raw.groq || "").trim(),
      nvidia: String(raw.nvidia || "").trim(),
      openrouter: String(raw.openrouter || "").trim(),
    },
  };
}

function selectProvider(provider: DirectProvider, keys: ApiKeys, model?: string): Exclude<DirectProvider, "auto"> {
  if (provider !== "auto") {
    if (!keys[provider]) throw new Error(`Добавьте ключ ${providerLabel(provider)} в настройках ИИ.`);
    return provider;
  }
  // В режиме «Автовыбор» не привязываемся к модели другого провайдера:
  // каждый API получает собственный корректный defaultModel().
  if (keys.gemini) return "gemini";
  if (keys.groq) return "groq";
  if (keys.nvidia) return "nvidia";
  if (keys.openrouter) return "openrouter";
  throw new Error("Добавьте API-ключ Gemini, OpenRouter, Groq или NVIDIA в настройках ИИ.");
}

function providerLabel(provider: Exclude<DirectProvider, "auto">): string {
  return ({ gemini: "Gemini", groq: "Groq", nvidia: "NVIDIA", openrouter: "OpenRouter" })[provider];
}

function defaultModel(provider: Exclude<DirectProvider, "auto">): string {
  if (provider === "gemini") return "gemini-3.5-flash";
  if (provider === "groq") return "llama-3.3-70b-versatile";
  if (provider === "nvidia") return "meta/llama-3.3-70b-instruct";
  return "stealth/ox-alpha";
}

function responseText(payload: any): string {
  const text = payload?.choices?.[0]?.message?.content
    || payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("")
    || payload?.output_text
    || "";
  if (!text.trim()) throw new Error("Провайдер вернул пустой ответ.");
  return text.trim();
}

export async function directGenerate(request: DirectRequest): Promise<string> {
  const requestedProvider = request.provider || "auto";
  const provider = selectProvider(requestedProvider, request.apiKeys || {}, request.model);
  // Автовыбор определяет и провайдера, и совместимую с ним модель.
  // Это защищает APK от старого model id, сохранённого для другого API.
  const model = requestedProvider === "auto" ? defaultModel(provider) : request.model || defaultModel(provider);
  const system = request.system || "Ты внимательный литературный помощник. Отвечай по-русски.";

  let response: Response;
  let payload: any;
  if (provider === "gemini") {
    response = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(request.apiKeys?.gemini || "")}`, {
      method: "POST",
      signal: request.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: { temperature: request.temperature ?? 0.75, responseMimeType: request.json ? "application/json" : "text/plain" },
      }),
    });
  } else {
    const endpoint = provider === "openrouter" ? OPENROUTER_URL : provider === "groq" ? GROQ_URL : NVIDIA_URL;
    const key = request.apiKeys?.[provider] || "";
    response = await fetch(endpoint, {
      method: "POST",
      signal: request.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(provider === "openrouter" ? { "HTTP-Referer": "https://github.com/Practician/writers-studio-android", "X-OpenRouter-Title": "Writers Studio Android" } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: request.prompt }],
        temperature: request.temperature ?? 0.75,
        ...(request.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  }

  payload = await response.json().catch(() => ({}));

  // Ox Alpha отмечена OpenRouter как временно бесплатная, но часть ключей может
  // получить общий 402. В этом случае автоматически пробуем официальный free-router.
  if (
    provider === "openrouter"
    && model === OX_ALPHA_MODEL
    && response.status === 402
  ) {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: request.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKeys?.openrouter || ""}`,
        "HTTP-Referer": "https://github.com/Practician/writers-studio-android",
        "X-OpenRouter-Title": "Writers Studio Android",
      },
      body: JSON.stringify({
        model: OPENROUTER_FREE_ROUTER,
        messages: [{ role: "system", content: system }, { role: "user", content: request.prompt }],
        temperature: request.temperature ?? 0.75,
        ...(request.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    payload = await response.json().catch(() => ({}));
    if (response.ok) notifyOpenRouterFallback(OX_ALPHA_MODEL, OPENROUTER_FREE_ROUTER);
  }

  if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `Ошибка ${providerLabel(provider)} (${response.status})`);
  return responseText(payload);
}

function compactContext(body: any): string {
  const parts = [
    body?.title && `Книга: ${body.title}`,
    body?.genre && `Жанр: ${body.genre}`,
    body?.description && `Описание: ${body.description}`,
    body?.currentChapterTitle && `Глава: ${body.currentChapterTitle}`,
    body?.currentChapterSummary && `Синопсис: ${body.currentChapterSummary}`,
    body?.worldBible && `Лор: ${String(body.worldBible).slice(0, 8000)}`,
    body?.bookPlan && `План: ${String(body.bookPlan).slice(0, 6000)}`,
    body?.canonDossier && `Канон: ${String(body.canonDossier).slice(0, 6000)}`,
    body?.authorSample && `Образец голоса: ${String(body.authorSample).slice(0, 8000)}`,
    body?.voiceSheet?.summary && `Паспорт голоса: ${body.voiceSheet.summary}`,
  ].filter(Boolean);
  return parts.join("\n\n");
}

function promptForAction(action: string, body: any): { system: string; prompt: string; json?: boolean } {
  const context = compactContext(body);
  const text = body?.text || body?.currentDraft || body?.sourceText || "";
  if (action === "editorial_review") {
    return {
      system: "Ты литературный редактор. Верни только JSON без markdown.",
      prompt: `${context}\n\nПроверь главу. Верни JSON: {"readiness":"...","summary":"...","checks":[{"title":"...","status":"ok|attention|missing","note":"..."}],"risks":[{"level":"high|medium|low","title":"...","explanation":"...","suggestion":"..."}],"nextStep":"..."}.\n\nТекст главы:\n${text}`,
      json: true,
    };
  }
  if (action === "parse_import") {
    return {
      system: "Ты извлекаешь структуру книги. Верни только JSON без markdown.",
      prompt: `Разбери текст на главы, персонажей и правила мира. Верни JSON: {"chapters":[{"title":"","summary":"","content":""}],"characters":[{"name":"","role":"","traits":"","goals":"","description":""}],"worldRules":[{"title":"","content":""}]}.\n\nТекст:\n${text}`,
      json: true,
    };
  }
  if (action === "generate_plan") return { system: "Ты редактор романа.", prompt: `${context}\n\nСоставь подробный план книги с главами, поворотами и финалом.` };
  if (action === "generate_bible") return { system: "Ты редактор романа.", prompt: `${context}\n\nСобери ясную библию мира: правила, места, ограничения и факты, которые нельзя нарушать.` };
  if (action === "evaluate_idea") return { system: "Ты опытный литературный редактор.", prompt: `${context}\n\nДай практическую оценку идеи: сильные стороны, риски, конкретные улучшения.` };
  if (action === "brainstorm") return { system: "Ты творческий соавтор.", prompt: `${context}\n\nПредложи свежие варианты для темы: ${body?.topic || body?.customPrompt || "следующей сцены"}. Дай несколько конкретных идей.` };
  if (action === "muse") return { system: "Ты Муза — бережный соавтор писателя.", prompt: `${context}\n\nОтветь на вопрос автора: ${body?.customPrompt || body?.prompt || "Помоги со следующей сценой."}` };
  if (action === "improve" || action === "rewrite_detector_segments") return { system: "Ты бережный литературный редактор. Сохраняй события, имена и факты.", prompt: `${context}\n\nПерепиши текст по задаче «${body?.stylePreset || body?.customPrompt || "улучшить стиль"}». Верни только готовый текст.\n\nТекст:\n${text}` };
  if (action === "continue" || action === "generate_full_chapter") return { system: "Ты пишешь художественную прозу по канону автора. Не объясняй свои действия.", prompt: `${context}\n\n${action === "continue" ? "Продолжи текущую сцену 2–5 абзацами" : "Напиши полноценную главу"}. Учти пожелание: ${body?.customPrompt || "сохрани тон и канон"}.\n\nТекущий текст:\n${text}` };
  return { system: "Ты литературный помощник.", prompt: `${context}\n\n${body?.customPrompt || "Помоги автору с текстом."}\n\n${text}` };
}

function safeJson(text: string, fallback: any) {
  try {
    return JSON.parse(text.replace(/^```json\s*|```$/g, "").trim());
  } catch {
    return fallback;
  }
}

function defaultAudit(result: string): AuthorEditAudit {
  return {
    passed: true,
    summary: "Правка подготовлена локальным агентом и ожидает подтверждения автора.",
    factIssues: [],
    protectedTermIssues: [],
    voiceNotes: ["Использован сохранённый паспорт голоса, если он был заполнен."],
    naturalnessNotes: [result.trim() ? "Текст создан и не применён автоматически." : "Пустой результат."],
  };
}

function createVoiceSheet(text: string): AuthorVoiceSheet {
  return {
    summary: text.slice(0, 1200),
    voiceRules: ["Сохранять выбранное лицо повествования и конкретику автора."],
    avoid: ["Не добавлять факты, противоречащие канону."],
    evidence: [],
  };
}

export async function directApi(path: string, init?: RequestInit): Promise<Response> {
  const body = typeof init?.body === "string" ? JSON.parse(init.body || "{}") : init?.body || {};
  const credentials = requestCredentials(body);
  const json = (value: any, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

  try {
    if (path === "/api/llm/status") {
      return json({ geminiKeys: credentials.keys.gemini ? 1 : 0, groqConfigured: Boolean(credentials.keys.groq), nvidiaConfigured: Boolean(credentials.keys.nvidia), openrouterConfigured: Boolean(credentials.keys.openrouter) });
    }
    if (path.startsWith("/api/muse/chat/stream")) {
      const generated = await directGenerate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt: promptForAction("muse", body).prompt, system: promptForAction("muse", body).system });
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: generated })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    }
    if (path.startsWith("/api/writer/author")) {
      if (body.action === "profile") {
        const prompt = `Составь сжатый паспорт голоса автора на русском. Верни JSON: {"summary":"","voiceRules":[""],"avoid":[""],"evidence":[]}.\n\nОбразец:\n${body.sample}\n\nОриентир:${body.styleDescription || ""}`;
        const text = await directGenerate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt, system: "Ты анализируешь только стиль автора. Верни JSON.", json: true });
        return json({ profile: safeJson(text, createVoiceSheet("Паспорт голоса не удалось распознать автоматически.")) });
      }
      const prompt = `Бережно отредактируй текст. Не меняй события и защищённые термины. Верни только новую версию.\n\nКонтекст:${JSON.stringify(body.context || {})}\n\nПаспорт:${JSON.stringify(body.voiceSheet || {})}\n\nТекст:\n${body.sourceText}`;
      const result = await directGenerate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt, system: "Ты литературный редактор, работающий по голосу автора." });
      return json({ result, audit: defaultAudit(result), voiceSheet: body.voiceSheet });
    }
    if (path.startsWith("/api/editor/")) {
      const action = path.split("/").pop() || "rewrite";
      const result = await directGenerate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt: `Перепиши фрагмент художественного текста. Режим: ${action}. Указание: ${body.customPrompt || ""}. Верни только результат.\n\n${body.text}`, system: "Ты точечный литературный редактор." });
      return json({ result });
    }
    if (path.startsWith("/api/writer/ai")) {
      const setup = promptForAction(body.action || "muse", body);
      const text = await directGenerate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt: setup.prompt, system: setup.system, json: setup.json });
      if (body.action === "editorial_review") return json({ review: safeJson(text, { readiness: "Проверка готова", summary: text, checks: [], risks: [], nextStep: "Откройте результат и внесите правки." }) });
      return json({ result: text, humanizeReport: null });
    }
    if (path.startsWith("/api/dev/load-labirint")) return json({ bible: "", plan: "" });
    return json({ error: `Автономный APK не поддерживает маршрут ${path}` }, 404);
  } catch (error: any) {
    return json({ error: error?.message || "Не удалось выполнить прямой запрос к ИИ-провайдеру." }, 400);
  }
}

export function installDirectApiBridge() {
  if (!isAutonomousApk()) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (path.startsWith("/api/")) return directApi(path, init);
    return nativeFetch(input, init);
  }) as typeof window.fetch;
}
