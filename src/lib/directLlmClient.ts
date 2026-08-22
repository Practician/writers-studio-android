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
  /** Явный лимит ответа: особенно важен для NVIDIA, где серверный default равен 1024. */
  maxTokens?: number;
  json?: boolean;
};

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const OX_ALPHA_MODEL = "stealth/ox-alpha";
const OPENROUTER_FREE_ROUTER = "openrouter/free";

type ApiTrace = {
  provider: Exclude<DirectProvider, "auto">;
  model: string;
  endpoint: string;
  keyPresent: boolean;
  keySuffix?: string;
  keyIndex?: number;
  keyCount?: number;
  status?: number;
  outputChars?: number;
  finishReason?: string;
  message?: string;
};

class DirectProviderError extends Error {
  constructor(message: string, readonly status: number, readonly trace: ApiTrace) {
    super(message);
    this.name = "DirectProviderError";
  }
}

export function splitApiKeyPool(value?: string): string[] {
  // Один ключ в прежних версиях остаётся валидным. Дополнительные ключи вводятся
  // с новой строки; разделители запятая и точка с запятой поддержаны для импорта.
  return [...new Set(String(value || "").split(/[\n,;]/).map((key) => key.trim()).filter(Boolean))];
}

function hasProviderKey(keys: ApiKeys, provider: Exclude<DirectProvider, "auto">): boolean {
  return splitApiKeyPool(keys[provider]).length > 0;
}

function endpointFor(provider: Exclude<DirectProvider, "auto">, model: string, key: string): string {
  if (provider === "gemini") return `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`;
  if (provider === "openrouter") return OPENROUTER_URL;
  if (provider === "groq") return GROQ_URL;
  return NVIDIA_URL;
}

function emitApiTrace(trace: ApiTrace): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("writers-studio-api-trace", { detail: trace }));
}

function traceFor(provider: Exclude<DirectProvider, "auto">, model: string, key: string, keyIndex: number, keyCount: number, status?: number, message?: string, output?: { chars: number; finishReason?: string }): ApiTrace {
  const url = new URL(endpointFor(provider, model, key));
  return {
    provider,
    model,
    endpoint: `${url.host}${url.pathname}`,
    keyPresent: Boolean(key),
    ...(key ? { keySuffix: key.slice(-4) } : {}),
    keyIndex,
    keyCount,
    ...(status !== undefined ? { status } : {}),
    ...(output ? { outputChars: output.chars, ...(output.finishReason ? { finishReason: output.finishReason } : {}) } : {}),
    ...(message ? { message: String(message).slice(0, 300) } : {}),
  };
}

function notifyOpenRouterFallback(from: string, to: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("writers-studio-openrouter-fallback", { detail: { from, to } }));
}

function notifyApiKeyRotation(provider: Exclude<DirectProvider, "auto">, from: number, to: number, total: number, status: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("writers-studio-api-key-rotation", { detail: { provider, from, to, total, status } }));
}

function notifyHumanizePass(depth: string, beforeChars: number, afterChars: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("writers-studio-humanize-pass", { detail: { depth, beforeChars, afterChars } }));
}

function shouldRotateKey(status: number): boolean {
  // Только квота/лимит: неверный ключ, 404 и ошибки сети не должны расходовать остальные ключи.
  return status === 402 || status === 429;
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
    if (!hasProviderKey(keys, provider)) throw new Error(`Добавьте ключ ${providerLabel(provider)} в настройках ИИ.`);
    return provider;
  }
  // В режиме «Автовыбор» не привязываемся к модели другого провайдера:
  // каждый API получает собственный корректный defaultModel().
  if (hasProviderKey(keys, "gemini")) return "gemini";
  if (hasProviderKey(keys, "groq")) return "groq";
  if (hasProviderKey(keys, "nvidia")) return "nvidia";
  if (hasProviderKey(keys, "openrouter")) return "openrouter";
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

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentToText).join("");
  if (content && typeof content === "object") {
    const value = content as { text?: unknown; content?: unknown };
    return contentToText(value.text ?? value.content);
  }
  return "";
}

function responseText(payload: any): string {
  const choice = payload?.choices?.[0];
  const text = contentToText(choice?.message?.content)
    || contentToText(choice?.text)
    || contentToText(payload?.candidates?.[0]?.content?.parts)
    || contentToText(payload?.output_text);
  if (!text.trim()) throw new Error("Провайдер вернул HTTP 200, но не передал текст ответа.");
  return text.trim();
}

function finishReasonFor(payload: any): string | undefined {
  const reason = payload?.choices?.[0]?.finish_reason || payload?.candidates?.[0]?.finishReason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : undefined;
}

export async function directGenerate(request: DirectRequest): Promise<string> {
  const requestedProvider = request.provider || "auto";
  const provider = selectProvider(requestedProvider, request.apiKeys || {}, request.model);
  // Автовыбор определяет и провайдера, и совместимую с ним модель.
  // Это защищает APK от старого model id, сохранённого для другого API.
  const model = requestedProvider === "auto" ? defaultModel(provider) : request.model || defaultModel(provider);
  const system = request.system || "Ты внимательный литературный помощник. Отвечай по-русски.";
  const maxTokens = Math.max(128, Math.min(request.maxTokens ?? 2_048, 6_144));
  const keyPool = splitApiKeyPool(request.apiKeys?.[provider]);

  for (let index = 0; index < keyPool.length; index += 1) {
    const key = keyPool[index];
    let effectiveModel = model;
    let response: Response;
    let payload: any;

    if (provider === "gemini") {
      response = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        signal: request.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: {
            temperature: request.temperature ?? 0.75,
            maxOutputTokens: maxTokens,
            responseMimeType: request.json ? "application/json" : "text/plain",
          },
        }),
      });
    } else {
      response = await fetch(endpointFor(provider, model, key), {
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
          max_tokens: maxTokens,
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    }

    payload = await response.json().catch(() => ({}));

    // При 402 Ox Alpha пробуем free-router всегда, а не только после успешного ответа:
    // так журнал и UI фиксируют сам факт переключения и его фактический результат.
    if (provider === "openrouter" && model === OX_ALPHA_MODEL && response.status === 402) {
      effectiveModel = OPENROUTER_FREE_ROUTER;
      notifyOpenRouterFallback(OX_ALPHA_MODEL, OPENROUTER_FREE_ROUTER);
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: request.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "https://github.com/Practician/writers-studio-android",
          "X-OpenRouter-Title": "Writers Studio Android",
        },
        body: JSON.stringify({
          model: effectiveModel,
          messages: [{ role: "system", content: system }, { role: "user", content: request.prompt }],
          temperature: request.temperature ?? 0.75,
          max_tokens: maxTokens,
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      payload = await response.json().catch(() => ({}));
    }

    const providerMessage = payload?.error?.message || payload?.error || `Ошибка ${providerLabel(provider)} (${response.status})`;
    if (response.ok) {
      try {
        const text = responseText(payload);
        emitApiTrace(traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, undefined, { chars: text.length, finishReason: finishReasonFor(payload) }));
        return text;
      } catch (error: any) {
        const trace = traceFor(
          provider,
          effectiveModel,
          key,
          index + 1,
          keyPool.length,
          response.status,
          error?.message || "Успешный ответ без текста.",
          { chars: 0, finishReason: finishReasonFor(payload) },
        );
        emitApiTrace(trace);
        // У провайдера HTTP 200, но для UI это должна быть явная ошибка, а не пустой результат.
        throw new DirectProviderError(String(trace.message), 502, trace);
      }
    }
    const trace = traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, providerMessage, { chars: 0, finishReason: finishReasonFor(payload) });
    emitApiTrace(trace);

    if (index + 1 < keyPool.length && shouldRotateKey(response.status)) {
      notifyApiKeyRotation(provider, index + 1, index + 2, keyPool.length, response.status);
      continue;
    }
    throw new DirectProviderError(String(providerMessage), response.status, trace);
  }

  throw new Error(`Добавьте ключ ${providerLabel(provider)} в настройках ИИ.`);
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
    Array.isArray(body?.voiceSheet?.voiceRules) && `Правила голоса: ${body.voiceSheet.voiceRules.join("; ")}`,
    Array.isArray(body?.voiceSheet?.avoid) && `Избегать в голосе: ${body.voiceSheet.avoid.join("; ")}`,
    body?.adaptiveStyleGuidance && `Адаптивные правила стиля: ${String(body.adaptiveStyleGuidance).slice(0, 4000)}`,
  ].filter(Boolean);
  return parts.join("\n\n");
}

function humanizeDirective(body: any): string {
  if (!body?.humanize) return "";
  const depth = body?.humanizeDepth === "fast" || body?.humanizeDepth === "balanced" || body?.humanizeDepth === "maximum"
    ? body.humanizeDepth
    : "balanced";
  const preset = body?.voicePreset ? `Ориентир голоса: ${body.voicePreset}.` : "";
  return `\n\nРЕЖИМ ОЧЕЛОВЕЧИВАНИЯ (${depth.toUpperCase()}):
- Пиши живой, неровный человеческий текст: чередуй короткие и длинные фразы, не делай абзацы одинаковыми.
- Показывай эмоции через выбор, жест, предмет, телесное ощущение и действие; не называй эмоцию вместо сцены.
- Убирай канцелярит, универсальные выводы, повторяющиеся зачины и шаблонные связки.
- Сохраняй канон, факты, имена, точку зрения и события. Не объясняй применённые приёмы.
- Образец автора и паспорт голоса выше важнее общих шаблонов. ${preset}`;
}

function needsHumanizePass(action: string, body: any): boolean {
  return Boolean(body?.humanize) && ["continue", "generate_full_chapter", "improve", "rewrite_detector_segments"].includes(action);
}

function promptForAction(action: string, body: any): { system: string; prompt: string; json?: boolean } {
  const context = compactContext(body);
  const text = body?.text || body?.currentDraft || body?.sourceText || "";
  const humanize = humanizeDirective(body);
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
  if (action === "improve" || action === "rewrite_detector_segments") return { system: "Ты бережный литературный редактор. Сохраняй события, имена и факты.", prompt: `${context}${humanize}\n\nПерепиши текст по задаче «${body?.stylePreset || body?.customPrompt || "улучшить стиль"}». Верни только готовый текст.\n\nТекст:\n${text}` };
  if (action === "continue" || action === "generate_full_chapter") return { system: "Ты пишешь художественную прозу по канону автора. Не объясняй свои действия.", prompt: `${context}${humanize}\n\n${action === "continue" ? "Продолжи текущую сцену 4–7 содержательными абзацами, с действием, деталями и завершённым микроповоротом" : "Напиши полноценную художественную главу объёмом 3 000–4 500 слов, с несколькими сценами, диалогами, конкретными деталями и завершённым поворотом. Не обрывай текст до достижения минимального объёма"}. Учти пожелание: ${body?.customPrompt || "сохрани тон и канон"}.\n\nТекущий текст:\n${text}` };
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

function maxTokensForAction(action?: string): number {
  if (action === "generate_full_chapter") return 6_144;
  if (action === "continue") return 2_560;
  if (action === "parse_import") return 3_072;
  return 2_048;
}

export async function directApi(path: string, init?: RequestInit): Promise<Response> {
  const body = typeof init?.body === "string" ? JSON.parse(init.body || "{}") : init?.body || {};
  const credentials = requestCredentials(body);
  const json = (value: any, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  // Даже после перехвата /api/* в APK сигнал должен дойти до нативного запроса провайдера.
  const generate = (request: Omit<DirectRequest, "signal" | "maxTokens">) => directGenerate({
    ...request,
    signal: init?.signal,
    maxTokens: maxTokensForAction(body?.action),
  });

  try {
    if (path === "/api/llm/status") {
      return json({ geminiKeys: credentials.keys.gemini ? 1 : 0, groqConfigured: Boolean(credentials.keys.groq), nvidiaConfigured: Boolean(credentials.keys.nvidia), openrouterConfigured: Boolean(credentials.keys.openrouter) });
    }
    if (path.startsWith("/api/muse/chat/stream")) {
      const generated = await generate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt: promptForAction("muse", body).prompt, system: promptForAction("muse", body).system });
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
        const text = await generate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt, system: "Ты анализируешь только стиль автора. Верни JSON.", json: true });
        return json({ profile: safeJson(text, createVoiceSheet("Паспорт голоса не удалось распознать автоматически.")) });
      }
      const prompt = `Бережно отредактируй текст. Не меняй события и защищённые термины. Верни только новую версию.\n\nКонтекст:${JSON.stringify(body.context || {})}\n\nПаспорт:${JSON.stringify(body.voiceSheet || {})}\n\nТекст:\n${body.sourceText}`;
      const result = await generate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt, system: "Ты литературный редактор, работающий по голосу автора." });
      return json({ result, audit: defaultAudit(result), voiceSheet: body.voiceSheet });
    }
    if (path.startsWith("/api/editor/")) {
      const action = path.split("/").pop() || "rewrite";
      const result = await generate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt: `Перепиши фрагмент художественного текста. Режим: ${action}. Указание: ${body.customPrompt || ""}. Верни только результат.\n\n${body.text}`, system: "Ты точечный литературный редактор." });
      return json({ result });
    }
    if (path.startsWith("/api/writer/ai")) {
      const action = body.action || "muse";
      const setup = promptForAction(action, body);
      let text = await generate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt: setup.prompt, system: setup.system, json: setup.json });
      if (action === "editorial_review") return json({ review: safeJson(text, { readiness: "Проверка готова", summary: text, checks: [], risks: [], nextStep: "Откройте результат и внесите правки." }) });

      const humanizeApplied = needsHumanizePass(action, body);
      if (humanizeApplied) {
        const depth = body?.humanizeDepth === "fast" || body?.humanizeDepth === "balanced" || body?.humanizeDepth === "maximum"
          ? body.humanizeDepth
          : "balanced";
        const minWords = action === "generate_full_chapter" ? "3 000 слов" : "исходный объём";
        const beforeChars = text.length;
        text = await generate({
          provider: credentials.provider,
          model: credentials.model,
          apiKeys: credentials.keys,
          system: "Ты финальный литературный редактор. Верни только готовый русский художественный текст без комментариев.",
          prompt: `${compactContext(body)}${humanizeDirective(body)}\n\nЧЕРНОВИК ДЛЯ ФИНАЛЬНОГО ОЧЕЛОВЕЧИВАНИЯ:\n${text}\n\nПерепиши черновик живо и естественно. Сохрани события, факты, имена, канон, точку зрения и минимум ${minWords}. Не сокращай текст ради гладкости. Верни только готовую версию.`,
        });
        notifyHumanizePass(depth, beforeChars, text.length);
      }
      return json({ result: text, humanizeReport: null, humanizeApplied });
    }
    if (path.startsWith("/api/dev/load-labirint")) return json({ bible: "", plan: "" });
    return json({ error: `Автономный APK не поддерживает маршрут ${path}` }, 404);
  } catch (error: any) {
    const status = error instanceof DirectProviderError ? error.status : 400;
    return json({
      error: error?.message || "Не удалось выполнить прямой запрос к ИИ-провайдеру.",
      ...(error instanceof DirectProviderError ? { diagnostics: error.trace } : {}),
    }, status);
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
