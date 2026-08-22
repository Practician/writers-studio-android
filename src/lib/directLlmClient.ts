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

// Та же проверенная цепочка, что использует серверная версия. В APK пробуем
// максимум три модели за запрос, чтобы не превращать один сбой в долгий цикл.
const NVIDIA_FALLBACK_MODELS = [
  "deepseek-ai/deepseek-v4-flash-0731",
  "z-ai/glm-5.2",
  "minimaxai/minimax-m3",
  "stepfun-ai/step-3.7-flash",
  "qwen/qwen3-235b-a22b-instruct-2507",
  "moonshotai/kimi-k2.6",
  "mistralai/mistral-nemotron",
  "mistralai/mistral-large-2-instruct",
  "meta/llama-3.3-70b-instruct",
];
const NVIDIA_MAX_MODEL_ATTEMPTS = 3;

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

function nvidiaModelChain(primary: string): string[] {
  return [...new Set([primary, ...NVIDIA_FALLBACK_MODELS])].slice(0, NVIDIA_MAX_MODEL_ATTEMPTS);
}

function shouldRotateNvidiaModel(status: number): boolean {
  // Для лимитов аккаунта первична ротация личных ключей; модели меняем при
  // недоступности маршрута/модели или тайм-ауте gateway.
  return status === 404 || status === 502 || status === 503 || status === 504;
}

function providerAfterNvidia(keys: ApiKeys): Exclude<DirectProvider, "auto" | "nvidia"> | undefined {
  // Порядок соответствует автономной политике: быстрый Groq → Gemini → OpenRouter.
  return (["groq", "gemini", "openrouter"] as const).find((provider) => hasProviderKey(keys, provider));
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

function hasVisibleResponseText(payload: any): boolean {
  try {
    return responseText(payload).length > 0;
  } catch {
    return false;
  }
}

export async function directGenerate(request: DirectRequest): Promise<string> {
  const requestedProvider = request.provider || "auto";
  const provider = selectProvider(requestedProvider, request.apiKeys || {}, request.model);
  // Автовыбор определяет и провайдера, и совместимую с ним модель.
  // Это защищает APK от старого model id, сохранённого для другого API.
  // Идентификатор OpenRouter не вводится пользователем: всегда начинаем с Ox Alpha.
  // Старые сохранённые model id намеренно игнорируются, а fallback выполняется внутри моста.
  const model = requestedProvider === "auto" || provider === "openrouter"
    ? defaultModel(provider)
    : request.model || defaultModel(provider);
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

    // 504 означает, что NVIDIA не отдала результат. Повтор безопасен: текста ответа
    // ещё нет. Во второй попытке сокращаем лимит, чтобы снизить нагрузку на gateway.
    if (provider === "nvidia" && response.status === 504) {
      const retryMaxTokens = Math.min(maxTokens, 4_096);
      emitApiTrace(traceFor(
        provider,
        model,
        key,
        index + 1,
        keyPool.length,
        response.status,
        `NVIDIA не ответила вовремя; повтор с лимитом ${retryMaxTokens} токенов.`,
        { chars: 0 },
      ));
      response = await fetch(NVIDIA_URL, {
        method: "POST",
        signal: request.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: request.prompt }],
          temperature: request.temperature ?? 0.75,
          max_tokens: retryMaxTokens,
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      payload = await response.json().catch(() => ({}));
    }

    // После неудачи исходной модели (или повторной попытки при 504) пробуем до
    // двух резервных моделей NVIDIA. Переходы показываются в журнале без ключа и текста.
    if (provider === "nvidia") {
      const candidates = nvidiaModelChain(model).slice(1);
      for (const nextModel of candidates) {
        const needsRotation = (response.ok && !hasVisibleResponseText(payload))
          || (!response.ok && shouldRotateNvidiaModel(response.status));
        if (!needsRotation) break;
        emitApiTrace(traceFor(
          provider,
          effectiveModel,
          key,
          index + 1,
          keyPool.length,
          response.status,
          `Ротация модели NVIDIA: ${effectiveModel} → ${nextModel}.`,
          { chars: 0, finishReason: finishReasonFor(payload) },
        ));
        effectiveModel = nextModel;
        response = await fetch(NVIDIA_URL, {
          method: "POST",
          signal: request.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: effectiveModel,
            messages: [{ role: "system", content: system }, { role: "user", content: request.prompt }],
            temperature: request.temperature ?? 0.75,
            max_tokens: Math.min(maxTokens, 4_096),
            ...(request.json ? { response_format: { type: "json_object" } } : {}),
          }),
        });
        payload = await response.json().catch(() => ({}));
      }
    }

    // Ox Alpha может вернуть HTTP 200, но израсходовать лимит на рассуждение и не
    // отдать видимый content (finish_reason=length). Для автора это такой же неуспех,
    // как 402: пробуем free-router, а исходную диагностику оставляем в журнале.
    const oxAlphaNeedsFallback = provider === "openrouter"
      && model === OX_ALPHA_MODEL
      && (response.status === 402 || (response.ok && !hasVisibleResponseText(payload)));
    if (oxAlphaNeedsFallback) {
      if (response.ok) {
        emitApiTrace(traceFor(
          provider,
          OX_ALPHA_MODEL,
          key,
          index + 1,
          keyPool.length,
          response.status,
          "Ox Alpha не передала видимый текст; переключение на openrouter/free.",
          { chars: 0, finishReason: finishReasonFor(payload) },
        ));
      }
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

    const rawProviderMessage = payload?.error?.message || payload?.error || `Ошибка ${providerLabel(provider)} (${response.status})`;
    const providerMessage = shouldRotateKey(response.status) && index + 1 >= keyPool.length
      ? `${rawProviderMessage}. Ротация ключей недоступна: сохранён только ключ ${index + 1}/${keyPool.length}.`
      : rawProviderMessage;
    if (response.ok) {
      try {
        const text = responseText(payload);
        emitApiTrace(traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, undefined, { chars: text.length, finishReason: finishReasonFor(payload) }));
        return text;
      } catch (error: any) {
        const nextProvider = provider === "nvidia" ? providerAfterNvidia(request.apiKeys || {}) : undefined;
        const message = nextProvider
          ? `${error?.message || "NVIDIA не передала текст."} NVIDIA исчерпала ротацию моделей; переход к ${providerLabel(nextProvider)}.`
          : error?.message || "Успешный ответ без текста.";
        const trace = traceFor(
          provider,
          effectiveModel,
          key,
          index + 1,
          keyPool.length,
          response.status,
          message,
          { chars: 0, finishReason: finishReasonFor(payload) },
        );
        emitApiTrace(trace);
        if (nextProvider) return directGenerate({ ...request, provider: nextProvider, model: undefined });
        // У провайдера HTTP 200, но для UI это должна быть явная ошибка, а не пустой результат.
        throw new DirectProviderError(String(trace.message), 502, trace);
      }
    }
    const nextProvider = provider === "nvidia" ? providerAfterNvidia(request.apiKeys || {}) : undefined;
    const messageWithFallback = nextProvider && provider === "nvidia"
      ? `${providerMessage}. NVIDIA исчерпала ротацию моделей; переход к ${providerLabel(nextProvider)}.`
      : providerMessage;
    const trace = traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, messageWithFallback, { chars: 0, finishReason: finishReasonFor(payload) });
    emitApiTrace(trace);

    if (index + 1 < keyPool.length && shouldRotateKey(response.status)) {
      notifyApiKeyRotation(provider, index + 1, index + 2, keyPool.length, response.status);
      continue;
    }
    if (nextProvider) return directGenerate({ ...request, provider: nextProvider, model: undefined });
    throw new DirectProviderError(String(messageWithFallback), response.status, trace);
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

const CHAPTER_TARGET_WORDS = 3_300;
const MAX_CHAPTER_CONTINUATIONS = 6;

function countGeneratedWords(text: string): number {
  return (text.match(/[A-Za-zА-Яа-яЁё0-9]+(?:[-'][A-Za-zА-Яа-яЁё0-9]+)*/gu) || []).length;
}

function notifyChapterVolume(words: number, segments: number, target: number, complete: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("writers-studio-chapter-volume", { detail: { words, segments, target, complete } }));
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
  if (action === "continue" || action === "generate_full_chapter") return { system: "Ты пишешь художественную прозу по канону автора. Не объясняй свои действия.", prompt: `${context}${humanize}\n\n${action === "continue" ? "Продолжи текущую сцену 4–7 содержательными абзацами, с действием, деталями и завершённым микроповоротом" : "Напиши полноценную художественную главу объёмом около 3 300 слов (допустимо ±10%), с несколькими сценами, диалогами, конкретными деталями и завершённым поворотом. Не обрывай текст до достижения 3 000 слов"}. Учти пожелание: ${body?.customPrompt || "сохрани тон и канон"}.\n\nТекущий текст:\n${text}` };
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

      // Модели могут поставить finish_reason=stop после короткого фрагмента, игнорируя
      // указанный объём. Для полной главы измеряем фактические слова и дописываем сцены.
      let chapterSegments = 1;
      if (action === "generate_full_chapter") {
        for (let continuation = 0; continuation < MAX_CHAPTER_CONTINUATIONS && countGeneratedWords(text) < CHAPTER_TARGET_WORDS; continuation += 1) {
          const currentWords = countGeneratedWords(text);
          const remaining = Math.max(1, CHAPTER_TARGET_WORDS - currentWords);
          const next = await generate({
            provider: credentials.provider,
            model: credentials.model,
            apiKeys: credentials.keys,
            system: "Ты продолжаешь уже начатую художественную главу. Верни только новый фрагмент прозы на русском, без заголовка, повтора и комментариев.",
            prompt: `${compactContext(body)}\n\nНАПИСАНО УЖЕ: около ${currentWords} слов. ЦЕЛЬ ГЛАВЫ: около ${CHAPTER_TARGET_WORDS} слов.\n\nХвост текущей главы:\n${text.slice(-6500)}\n\nПродолжи строго с этого места. Не пересказывай и не повторяй написанное. Напиши следующую законченную сцену или развитие сцены объёмом не менее ${Math.min(900, remaining)} слов; двигай сюжет к завершённому повороту главы.`,
          });
          const beforeWords = currentWords;
          text = `${text.trim()}\n\n${next.trim()}`;
          chapterSegments += 1;
          if (countGeneratedWords(text) <= beforeWords) break;
        }
        notifyChapterVolume(countGeneratedWords(text), chapterSegments, CHAPTER_TARGET_WORDS, countGeneratedWords(text) >= CHAPTER_TARGET_WORDS);
      }

      const humanizeApplied = needsHumanizePass(action, body);
      if (humanizeApplied) {
        const depth = body?.humanizeDepth === "fast" || body?.humanizeDepth === "balanced" || body?.humanizeDepth === "maximum"
          ? body.humanizeDepth
          : "balanced";
        const minWords = action === "generate_full_chapter" ? "3 000 слов и ориентир около 3 300 слов" : "исходный объём";
        const beforeChars = text.length;
        const beforeWords = countGeneratedWords(text);
        const humanizedText = await generate({
          provider: credentials.provider,
          model: credentials.model,
          apiKeys: credentials.keys,
          system: "Ты финальный литературный редактор. Верни только готовый русский художественный текст без комментариев.",
          prompt: `${compactContext(body)}${humanizeDirective(body)}\n\nЧЕРНОВИК ДЛЯ ФИНАЛЬНОГО ОЧЕЛОВЕЧИВАНИЯ:\n${text}\n\nПерепиши черновик живо и естественно. Сохрани события, факты, имена, канон, точку зрения и минимум ${minWords}. Не сокращай текст ради гладкости. Верни только готовую версию.`,
        });
        // Полный постпроход иногда самовольно сокращает длинный черновик. В таком
        // случае сохраняем объёмную версию, а не выдаём пользователю короткий текст.
        const humanizedWords = countGeneratedWords(humanizedText);
        const acceptHumanized = action !== "generate_full_chapter" || humanizedWords >= Math.floor(beforeWords * 0.9);
        if (acceptHumanized) text = humanizedText;
        notifyHumanizePass(depth, beforeChars, humanizedText.length);
      }
      const chapterWords = action === "generate_full_chapter" ? countGeneratedWords(text) : undefined;
      return json({ result: text, humanizeReport: null, humanizeApplied, ...(chapterWords !== undefined ? { chapterWords, chapterTargetWords: CHAPTER_TARGET_WORDS, chapterSegments } : {}) });
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
