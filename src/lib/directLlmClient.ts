import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { AuthorEditAudit, AuthorVoiceSheet, HumanizeReport } from "../types";
import { GEMINI_LITERARY_MODELS } from "./llmSettings";
import {
  AI_TELL_CATALOG,
  AI_TELL_CATALOG_EXTENDED,
  aiTellScore,
  detectAiTellsEnhanced,
  DISCOURSE_FLOW_CHECKLIST,
  HUMAN_POSITIVE_MARKERS_CHECKLIST,
  modelFingerprintGuidance,
  NARRATIVE_ARCHITECTURE_CHECKLIST,
  resolveHumanizeDepth,
  runMultiDetectorGate,
  voicePersonaBlock,
  voicePresetById,
} from "../../server/humanStyle";
import type { GenreContext } from "../../server/humanStyleEnhanced";
import { sanitizeGeneratedText } from "../../server/textHygiene";
import {
  generateHumanizedChapter,
  humanizeProseDraft,
  rewriteDetectorAiSegments,
  type ChapterGenerateInput,
  type GenerateFn,
} from "../../server/chapterGenerate";

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
  /** Внутреннее: провайдеры, уже испробованные в этой цепочке каскада (не для внешних вызовов). */
  triedProviders?: readonly Exclude<DirectProvider, "auto">[];
};

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const OPENROUTER_FREE_ROUTER = "openrouter/free";

// Та же проверенная цепочка, что использует серверная версия. В APK пробуем
// максимум три модели за запрос, чтобы не превращать один сбой в долгий цикл.
// Состав перепроверен живыми вызовами (17.09.2026): `z-ai/glm-5.2`,
// `minimaxai/minimax-m3` и `stepfun-ai/step-3.7-flash` сняты с прода (HTTP 410 Gone),
// а `qwen/qwen3-235b-a22b-instruct-2507`, `moonshotai/kimi-k2.6`,
// `mistralai/mistral-nemotron`, `mistralai/mistral-large-2-instruct` и
// `meta/llama-3.3-70b-instruct` недоступны аккаунту (HTTP 404 «Function not found
// for account»). Мёртвые модели убраны: каждая из них стоила лишнего раунд-трипа
// на ротации. Вместо них — только модели, ответившие 200 с видимым текстом.
// Порядок фолбэков: первым идёт Gemma 4 — на пробе она отдала чистый текст без
// «размышлений»; крупные Nemotron 3 отвечают, но на короткой пробе отдавали
// англоязычный reasoning-префикс, поэтому стоят ниже, как дальний резерв.
const NVIDIA_FALLBACK_MODELS = [
  "deepseek-ai/deepseek-v4-flash-0731",
  "google/gemma-4-31b-it",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "google/diffusiongemma-26b-a4b-it",
  "meta/llama-3.2-11b-vision-instruct",
];
const NVIDIA_MAX_MODEL_ATTEMPTS = 3;

// Groq отклоняет `response_format: json_object` с HTTP 400, если слово «json» ни
// разу не встречается в messages: провайдер выпадал из каскада на каждом
// JSON-вызове (авто-доводка, план битов, редакторская проверка). Серверная рука
// лечит это повтором без response_format (server/llmProvider.ts); в APK добавляем
// к промпту явный контракт формата и оставляем такой же страховочный повтор.
const JSON_FORMAT_HINT = "Формат ответа: JSON.";

function ensureJsonKeyword(system: string, prompt: string): string {
  if (/\bjson\b/i.test(system) || /\bjson\b/i.test(prompt)) return system;
  return system ? `${system}\n${JSON_FORMAT_HINT}` : JSON_FORMAT_HINT;
}

function isJsonKeywordError(payload: any): boolean {
  const message = String(payload?.error?.message || payload?.error || "");
  return /response_format|json_object|word 'json'/i.test(message);
}

// Собственные литературные профили Gemini (та же четвёрка, что в настройках приложения).
// При перегрузке/недоступности основной модели пробуем следующую, прежде чем
// уходить к другому провайдеру — так временный HTTP 503 не выглядит зависанием.
const GEMINI_FALLBACK_MODELS = GEMINI_LITERARY_MODELS.map((profile) => profile.id);
// 5 слотов = четыре живых профиля плюс gemini-2.5-flash в хвосте: она недоступна
// ключам новых проектов (404), но на ключах старых проектов даёт запасную квоту.
const GEMINI_MAX_MODEL_ATTEMPTS = 5;

// --- Адаптивная память моделей Gemini по ключу ---------------------------------
// Переключение моделей полностью автоматическое: приложение само уходит на резервную
// модель, когда основная упирается в лимит или недоступна, и само возвращается на неё,
// когда пауза истекла. Вручную выбирать профиль в настройках не нужно.
// Память ведётся отдельно для каждого ключа (по последним 4 знакам), потому что
// доступность модели у Google привязана к проекту ключа: ключам новых проектов
// gemini-2.5-flash отвечает 404, ключам старых — работает. Сам ключ не хранится.
const GEMINI_HEALTH_LS = "writers_studio_gemini_health_v1";
/** 404/410 — модель недоступна этому ключу: не тратим на неё попытку, но перепроверим через неделю. */
const GEMINI_DEAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 429 — сначала короткая пауза (минутный лимит), при повторе — длинная (дневная квота). */
const GEMINI_QUOTA_COOLDOWN_MS = 3 * 60 * 1000;
const GEMINI_QUOTA_COOLDOWN_HARD_MS = 30 * 60 * 1000;
/** 500/502/503/504 и пустой ответ — перегрузка: пауза на минуту. */
const GEMINI_OVERLOAD_COOLDOWN_MS = 60 * 1000;
/**
 * Дневная квота ключа (RPD) исчерпана — это не минутный лимит: ключ не оживёт
 * через три минуты, а на каждом запросе сжигает всю цепочку из пяти моделей
 * впустую (в живом журнале APK это выглядело как «зацикливание на Gemini»).
 * Первый отказ — час паузы, повторный — до ближайшей полуночи UTC.
 */
const GEMINI_KEY_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
/** 401/403 — ключ отклонён: перепроверять его раньше суток бессмысленно. */
const GEMINI_KEY_AUTH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type GeminiModelMemory = {
  dead: Record<string, number>;
  cooling: Record<string, number>;
  quotaHits: Record<string, number>;
  /** Пауза всего ключа (дневная квота/отказ) — не путать с остыванием модели. */
  keyPauseUntil?: number;
  /** Сколько раз ключ попадался на дневной квоте: решает короткую паузу или длинную. */
  quotaKeyHits?: number;
  pauseReason?: string;
};
type GeminiKeyMemory = Record<string, GeminiModelMemory>;

let geminiMemoryCache: GeminiKeyMemory | null = null;

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function loadGeminiMemory(): GeminiKeyMemory {
  if (geminiMemoryCache) return geminiMemoryCache;
  const storage = storageOrNull();
  try {
    const parsed = JSON.parse(storage?.getItem(GEMINI_HEALTH_LS) || "{}");
    geminiMemoryCache = parsed && typeof parsed === "object" ? parsed as GeminiKeyMemory : {};
  } catch {
    geminiMemoryCache = {};
  }
  return geminiMemoryCache;
}

function saveGeminiMemory(): void {
  const storage = storageOrNull();
  if (!storage || !geminiMemoryCache) return;
  try {
    storage.setItem(GEMINI_HEALTH_LS, JSON.stringify(geminiMemoryCache));
  } catch {
    // Переполнение хранилища не должно ломать генерацию: память остаётся в модуле.
  }
}

/** Сброс выученного состояния моделей (смена ключа, тесты). */
export function resetGeminiModelMemory(): void {
  geminiMemoryCache = {};
  saveGeminiMemory();
}

function geminiMemoryFor(key: string): GeminiModelMemory {
  const memory = loadGeminiMemory();
  const entry = memory[key.slice(-4)] || (memory[key.slice(-4)] = { dead: {}, cooling: {}, quotaHits: {} });
  entry.dead ||= {};
  entry.cooling ||= {};
  entry.quotaHits ||= {};
  return entry;
}

function timeLabel(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return new Date(timestamp).toISOString().slice(11, 16);
  }
}

/**
 * HTTP 429 у Gemini бывает двух разных природ: минутный лимит запросов (ключ оживёт
 * сам) и исчерпанная дневная квота проекта. Различаем по тексту: во втором случае
 * Google отвечает «You exceeded your current quota … check your plan and billing
 * details» и «Quota exceeded for metric».
 */
function isDailyQuotaMessage(message: unknown): boolean {
  const text = String(message || "").toLowerCase();
  return /exceeded your current quota|quota exceeded|check your plan and billing|billing details|resource_exhausted/.test(text);
}

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 5, 0);
}

/** 0 — ключ рабочий; иначе время, до которого он снят с использования. */
export function geminiKeyPauseUntil(key: string): number {
  return geminiMemoryFor(key).keyPauseUntil ?? 0;
}

function parkGeminiKey(key: string, pauseUntil: number, reason: string): void {
  const memory = geminiMemoryFor(key);
  memory.keyPauseUntil = Math.max(memory.keyPauseUntil ?? 0, pauseUntil);
  memory.pauseReason = reason;
  saveGeminiMemory();
}

function releaseGeminiKey(key: string): void {
  const memory = geminiMemoryFor(key);
  if (!memory.keyPauseUntil && !memory.pauseReason && !memory.quotaKeyHits) return;
  memory.keyPauseUntil = 0;
  delete memory.pauseReason;
  memory.quotaKeyHits = 0;
  saveGeminiMemory();
}

/**
 * Состояние ключа целиком: успех снимает паузу, дневная квота и отказ авторизации
 * паркуют ключ надолго. Минутный 429 здесь не паркуется — его разбирает память
 * моделей (recordGeminiOutcome), потому что такая ошибка привязана к модели.
 */
function noteGeminiKeyOutcome(key: string, status: number, ok: boolean, hasText: boolean, providerMessage?: unknown): void {
  if (ok && hasText) {
    releaseGeminiKey(key);
    return;
  }
  const now = Date.now();
  if (status === 401 || status === 403) {
    parkGeminiKey(key, now + GEMINI_KEY_AUTH_COOLDOWN_MS, `ключ отклонён (${status})`);
    return;
  }
  if (status === 429 && isDailyQuotaMessage(providerMessage)) {
    const memory = geminiMemoryFor(key);
    const hits = (memory.quotaKeyHits ?? 0) + 1;
    memory.quotaKeyHits = hits;
    const pauseUntil = hits > 1
      ? Math.max(nextUtcMidnight(now), now + GEMINI_KEY_QUOTA_COOLDOWN_MS)
      : now + GEMINI_KEY_QUOTA_COOLDOWN_MS;
    parkGeminiKey(key, pauseUntil, "исчерпана дневная квота");
  }
}

/**
 * Цепочка моделей Gemini с учётом выученного состояния ключа: рабочие модели — в
 * настроенном порядке, «остывающие» (429/503) — в хвост, недоступные ключу (404) —
 * пропускаются. Если рабочего не осталось, порядок остаётся штатным: пробуем снова,
 * и уже каскад провайдеров решает, что делать.
 */
function geminiModelChain(primary: string, key: string): string[] {
  const canonical = [...new Set([primary, ...GEMINI_FALLBACK_MODELS])].slice(0, GEMINI_MAX_MODEL_ATTEMPTS);
  const memory = geminiMemoryFor(key);
  const now = Date.now();
  const available = canonical.filter((id) => (memory.dead[id] ?? 0) <= now && (memory.cooling[id] ?? 0) <= now);
  const paused = canonical.filter((id) => (memory.dead[id] ?? 0) <= now && (memory.cooling[id] ?? 0) > now);
  return available.length ? [...available, ...paused] : canonical;
}

/** Запоминает исход вызова, чтобы следующий запрос не тратил попытку на ту же ошибку. */
function recordGeminiOutcome(key: string, model: string, status: number, ok: boolean, hasText: boolean, providerMessage?: unknown): void {
  noteGeminiKeyOutcome(key, status, ok, hasText, providerMessage);
  const memory = geminiMemoryFor(key);
  const now = Date.now();
  if (status === 404 || status === 410) {
    memory.dead[model] = now + GEMINI_DEAD_TTL_MS;
    delete memory.cooling[model];
    delete memory.quotaHits[model];
    saveGeminiMemory();
    return;
  }
  if (status === 429) {
    const hits = (memory.quotaHits[model] ?? 0) + 1;
    memory.quotaHits[model] = hits;
    memory.cooling[model] = now + (hits > 1 ? GEMINI_QUOTA_COOLDOWN_HARD_MS : GEMINI_QUOTA_COOLDOWN_MS);
    delete memory.dead[model];
    saveGeminiMemory();
    return;
  }
  if (status === 500 || status === 502 || status === 503 || status === 504 || (ok && !hasText)) {
    memory.cooling[model] = now + GEMINI_OVERLOAD_COOLDOWN_MS;
    delete memory.dead[model];
    saveGeminiMemory();
    return;
  }
  if (ok && hasText) {
    const changed = model in memory.dead || model in memory.cooling || model in memory.quotaHits;
    delete memory.dead[model];
    delete memory.cooling[model];
    delete memory.quotaHits[model];
    if (changed) saveGeminiMemory();
  }
}

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

function notifyHumanizePass(depth: string, beforeChars: number, afterChars: number, audit?: { scoreBefore: number; scoreAfter: number; gatePassed: boolean; passesRun: number }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("writers-studio-humanize-pass", { detail: { depth, beforeChars, afterChars, ...audit } }));
}

// Полный каталог локального аудита: базовые ~80 паттернов + расширенные ~50
// (те же признаки, что использует human-touch-max.html для очеловечивания).
const COMBINED_AI_TELL_CATALOG = [...AI_TELL_CATALOG, ...AI_TELL_CATALOG_EXTENDED];

function mapGenreContext(genre?: string): GenreContext {
  const value = String(genre || "").toLowerCase();
  if (/фэнтези|фентези|fantasy/.test(value)) return "fantasy";
  if (/фантастик|sci-?fi|космоопер/.test(value)) return "scifi";
  if (/триллер|детектив|thriller/.test(value)) return "thriller";
  if (/любовн|романтик|romance/.test(value)) return "romance";
  if (/ужас|хоррор|horror/.test(value)) return "horror";
  if (/литератур|literary|проза/.test(value)) return "literary";
  return "general";
}

interface LocalAudit {
  score: number;
  burstiness: number;
  openerRepetition: number;
  patternDensity: number;
  labels: string[];
  gatePassed: boolean;
  gateDetails: string[];
}

/** Локальный аудит текста расширенным каталогом human-touch-max — без сетевых вызовов. */
function auditHumanizedText(candidate: string, genre: GenreContext, scoreGate: number): LocalAudit {
  const base = aiTellScore(candidate);
  const gate = runMultiDetectorGate(candidate, COMBINED_AI_TELL_CATALOG, genre, { maxAiTellScore: scoreGate });
  const hits = detectAiTellsEnhanced(candidate, COMBINED_AI_TELL_CATALOG, genre);
  return {
    score: gate.aiTellScore,
    burstiness: base.burstiness,
    openerRepetition: base.openerRepetition,
    patternDensity: base.patternDensity,
    labels: [...new Set(hits.map((hit) => hit.label))].slice(0, 12),
    gatePassed: gate.verdict === "PASS",
    gateDetails: gate.details,
  };
}

function shouldRotateKey(status: number): boolean {
  // Только квота/лимит: неверный ключ, 404 и ошибки сети не должны расходовать остальные ключи.
  return status === 402 || status === 429;
}

// У Gemini перегрузка модели (503) и недоступность шлюза (504) раньше не ротировали
// ключи — крутили только модели внутри одного ключа. Но перегрузка бывает привязана
// к проекту ключа, а у автора их несколько: когда вся цепочка моделей легла на одном
// ключе, честнее перебрать следующие ключи Gemini, прежде чем уходить к Groq.
// 404/410 у Gemini тоже ротируют ключ. Недоступность модели бывает привязана к
// проекту ключа (404 «no longer available to new users»): снятая с провода модель
// отдаёт 404 на одном ключе, но остаётся рабочей на другом. Раньше после исчерпания
// цепочки моделей 404 закрывал всю Gemini-руку, и второй/третий ключ автора не
// опробовался ни разу.
function shouldRotateProviderKey(provider: DirectProvider, status: number): boolean {
  return shouldRotateKey(status)
    || (provider === "gemini" && (status === 404 || status === 410 || status === 503 || status === 504));
}

// Детекторы ловят в первую очередь «пальцы» конкретной модели: переписывать сегмент
// тем же провайдером, которым текст написан, почти бесполезно — модель воспроизводит
// собственный токен-профиль. Если настроен другой провайдер, правку детекторных
// сегментов ведёт он, а основной остаётся для остального каскада.
function pickRewriteProvider(primary: DirectProvider, keys: ApiKeys): DirectProvider {
  const candidates: DirectProvider[] = primary === "gemini"
    ? ["openrouter", "groq", "nvidia"]
    : ["gemini", "groq", "openrouter", "nvidia"];
  return candidates.find((candidate) => candidate !== primary && splitApiKeyPool(keys[candidate]).length > 0) || primary;
}

function nvidiaModelChain(primary: string): string[] {
  return [...new Set([primary, ...NVIDIA_FALLBACK_MODELS])].slice(0, NVIDIA_MAX_MODEL_ATTEMPTS);
}

function shouldRotateNvidiaModel(status: number): boolean {
  // Для лимитов аккаунта первична ротация личных ключей; модели меняем при
  // недоступности маршрута/модели (404/410 — модель снята с прода), перегрузке
  // или тайм-ауте gateway.
  return status === 404 || status === 410 || status === 502 || status === 503 || status === 504;
}

// Порядок цепочки Gemini считается по каждому ключу — см. geminiModelChain() рядом
// с адаптивной памятью моделей в начале файла.

function shouldRotateGeminiModel(status: number): boolean {
  // В отличие от NVIDIA, у Gemini квоты раздельные по каждой модели (у flash и
  // pro разные RPM/RPD-лимиты) — 429 на одной модели не говорит о доступности
  // другой под тем же ключом, поэтому, в отличие от NVIDIA, тоже ротируем модель.
  // Модель также меняем при её недоступности (404/410), внутренней ошибке или перегрузке.
  return status === 404 || status === 410 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}


// Порядок каскада между провайдерами при полном отказе текущего: быстрый Groq →
// Gemini → NVIDIA → OpenRouter (исключая провайдера, который только что отказал).
const PROVIDER_FALLBACK_ORDER: readonly Exclude<DirectProvider, "auto">[] = ["groq", "gemini", "nvidia", "openrouter"];

// Порядок каскада между провайдерами при полном отказе текущего: быстрый Groq →
// Gemini → NVIDIA → OpenRouter. Исключает не только текущего провайдера, но и всех
// уже испробованных в этой цепочке — иначе NVIDIA↔Gemini могут бесконечно
// перебрасывать друг на друга (у обоих есть ключ) и OpenRouter так и не будет
// вызван, хотя он последний в списке и тоже настроен.
function nextFallbackProvider(
  tried: readonly Exclude<DirectProvider, "auto">[],
  keys: ApiKeys,
): Exclude<DirectProvider, "auto"> | undefined {
  return PROVIDER_FALLBACK_ORDER.find((candidate) => !tried.includes(candidate) && hasProviderKey(keys, candidate));
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
  if (provider === "gemini") return "gemini-3.8-flash";
  if (provider === "groq") return "openai/gpt-oss-120b";
  if (provider === "nvidia") return "deepseek-ai/deepseek-v4-flash-0731";
  return "deepseek/deepseek-v3.2";
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
  // Копим провайдеров, уже опробованных в этой цепочке каскада (включая текущий),
  // чтобы дальнейшие фолбэки не возвращались к уже отказавшему.
  const triedSoFar = [...(request.triedProviders || []), provider];
  // Автовыбор определяет и провайдера, и совместимую с ним модель.
  // Явно выбранный провайдер получает только один из встроенных литературных профилей.
  const model = requestedProvider === "auto"
    ? defaultModel(provider)
    : request.model || defaultModel(provider);
  const system = request.system || "Ты внимательный литературный помощник. Отвечай по-русски.";
  // Общий потолок поднят с 6 144 до 16 000: очеловечивание целой главы (а не
  // одного фрагмента) кириллицей нуждается в заметно большем бюджете вывода.
  const maxTokens = Math.max(128, Math.min(request.maxTokens ?? 2_048, 16_000));
  const keyPool = splitApiKeyPool(request.apiKeys?.[provider]);
  // Ключи, про которые уже известно, что они на паузе (дневная квота/отказ), не
  // пробуем заново. Снимок делается один раз до цикла: внутри одного запроса
  // порядок ключей не меняется, а следующий запрос начнёт с рабочих ключей.
  const pausedKeys = new Set(provider === "gemini" ? keyPool.filter((key) => geminiKeyPauseUntil(key) > Date.now()) : []);
  if (provider === "gemini" && keyPool.length > 0 && pausedKeys.size === keyPool.length) {
    // Все ключи Gemini сняты по квоте: минутный перебор моделей ничего не даст,
    // поэтому честно уходим к следующему провайдеру вместо «зацикливания».
    const resumeAt = Math.min(...keyPool.map((key) => geminiKeyPauseUntil(key)));
    const nextProvider = nextFallbackProvider(triedSoFar, request.apiKeys || {});
    const pauseNote = `Все ключи Gemini на паузе до ${timeLabel(resumeAt)} (исчерпана дневная квота или ключ отклонён).`;
    const message = nextProvider
      ? `${pauseNote} переход к ${providerLabel(nextProvider)}.`
      : `${pauseNote} Добавьте рабочий ключ Gemini или ключ другого провайдера.`;
    const trace = traceFor(provider, model, keyPool[0], 1, keyPool.length, 429, message, { chars: 0 });
    emitApiTrace(trace);
    if (nextProvider) return directGenerate({ ...request, provider: nextProvider, model: undefined, triedProviders: triedSoFar });
    throw new DirectProviderError(message, 429, trace);
  }
  // Шлюз NVIDIA при перегрузке может держать соединение открытым по 4-5 минут,
  // прежде чем сам вернёт 504 — это удваивает простой при повторе на том же ключе.
  // Обрываем раньше и обрабатываем как штатный таймаут шлюза (тот же код 504),
  // чтобы вся существующая логика ретраев/ротации/фолбэка сработала без изменений.
  const CLIENT_TIMEOUT_MS = 90_000;
  async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    if (request.signal?.aborted) throw request.signal.reason ?? new DOMException("Aborted", "AbortError");
    if (Capacitor.isNativePlatform()) {
      // capacitor.config патчит window.fetch через нативный мост (CapacitorHttp),
      // чтобы обходить CORS у внешних AI API — но этот мост не читает AbortSignal:
      // обычный fetch() с AbortController здесь никогда не сработает и молча ждёт
      // ответа шлюза столько, сколько он сам решит (замечено — до 5 минут).
      // Настоящий таймаут на нативной платформе — только через прямой вызов
      // CapacitorHttp.request() с readTimeout/connectTimeout.
      try {
        const httpResponse = await CapacitorHttp.request({
          url,
          method: init.method || "GET",
          headers: (init.headers as Record<string, string>) || {},
          data: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
          readTimeout: CLIENT_TIMEOUT_MS,
          connectTimeout: CLIENT_TIMEOUT_MS,
        });
        const status = httpResponse.status;
        return { status, ok: status >= 200 && status < 300, json: async () => httpResponse.data } as Response;
      } catch (err) {
        // Таймаут и любая сетевая ошибка нативного моста трактуются как временный
        // сбой шлюза (эквивалент 504) — дальше срабатывает уже существующая
        // логика ретраев/ротации/фолбэка без каких-либо изменений.
        const message = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: { message: `Клиентский таймаут или сетевая ошибка: ${message}` } }), { status: 504 });
      }
    }
    // Веб/дев-сборка (без нативного моста) — обычный fetch с AbortController-таймаутом.
    const controller = new AbortController();
    const onUserAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", onUserAbort);
    const timeoutId = setTimeout(() => controller.abort(new DOMException("client-timeout", "TimeoutError")), CLIENT_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      const isOurTimeout = err instanceof Error && err.name === "TimeoutError" && !request.signal?.aborted;
      if (isOurTimeout) {
        return new Response(JSON.stringify({ error: { message: "Клиентский таймаут: провайдер не ответил вовремя." } }), { status: 504 });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      request.signal?.removeEventListener("abort", onUserAbort);
    }
  }

  for (let index = 0; index < keyPool.length; index += 1) {
    const key = keyPool[index];
    if (pausedKeys.has(key)) {
      // Ключ с исчерпанной дневной квотой: запрос к нему сожжёт всю цепочку
      // моделей и вернёт тот же 429 — пропускаем, объяснив это в журнале.
      emitApiTrace(traceFor(provider, model, key, index + 1, keyPool.length, 429, `Ключ в паузе до ${timeLabel(geminiKeyPauseUntil(key))} (${geminiMemoryFor(key).pauseReason || "квота"}): пропуск.`, { chars: 0 }));
      continue;
    }
    let effectiveModel = model;
    let response: Response;
    let payload: any;
    // Для JSON-режима гарантируем слово «json» в messages (требование Groq),
    // не переписывая исходный промпт пайплайна.
    const systemForCall = request.json ? ensureJsonKeyword(system, request.prompt) : system;
    // Модели Gemini вызываются одинаково и на первом шаге, и при ротации,
    // поэтому запрос вынесен в одну функцию.
    const callGemini = (targetModel: string) => fetchWithTimeout(`${GEMINI_URL}/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
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
    // Автовыбор без участия автора: порядок цепочки для этого ключа учитывает
    // прошлые 404/429/503, поэтому выбранный в настройках профиль задаёт лишь
    // приоритет, а не жёсткую привязку.
    const geminiOrder = provider === "gemini" ? geminiModelChain(model, key) : [];
    const learnedModel = geminiOrder[0] ?? model;
    effectiveModel = learnedModel;
    if (provider === "gemini" && learnedModel !== model) {
      emitApiTrace(traceFor(provider, model, key, index + 1, keyPool.length, undefined, `Автовыбор модели Gemini по памяти ключа: ${model} → ${learnedModel}.`, { chars: 0 }));
    }

    if (provider === "gemini") {
      response = await callGemini(effectiveModel);
    } else {
      response = await fetchWithTimeout(endpointFor(provider, model, key), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...(provider === "openrouter" ? { "HTTP-Referer": "https://github.com/Practician/writers-studio-android", "X-OpenRouter-Title": "Writers Studio Android" } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemForCall }, { role: "user", content: request.prompt }],
          temperature: request.temperature ?? 0.75,
          max_tokens: maxTokens,
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    }

    payload = await response.json().catch(() => ({}));

    // Вся цепочка литературных профилей Gemini на том же ключе — управляемая
    // деградация вместо зависания на временной перегрузке (HTTP 503), лимите (429)
    // или модели, недоступной ключу (404). Состав и порядок цепочки учитывают
    // выученное состояние ключа: недоступные пропускаются, остывающие уходят в хвост
    // (сюда попадает и gemini-2.5-flash с её отдельной дневной квотой), а каждый
    // исход запоминается — следующий запрос не повторит ту же ошибку.
    if (provider === "gemini") {
      recordGeminiOutcome(key, effectiveModel, response.status, response.ok, response.ok && hasVisibleResponseText(payload), payload?.error?.message || payload?.error);
      const candidates = geminiOrder.slice(1);
      for (const nextModel of candidates) {
        const needsRotation = (response.ok && !hasVisibleResponseText(payload))
          || (!response.ok && shouldRotateGeminiModel(response.status));
        if (!needsRotation) break;
        emitApiTrace(traceFor(
          provider,
          effectiveModel,
          key,
          index + 1,
          keyPool.length,
          response.status,
          `Ротация модели Gemini: ${effectiveModel} → ${nextModel}.`,
          { chars: 0, finishReason: finishReasonFor(payload) },
        ));
        effectiveModel = nextModel;
        response = await callGemini(effectiveModel);
        payload = await response.json().catch(() => ({}));
        recordGeminiOutcome(key, effectiveModel, response.status, response.ok, response.ok && hasVisibleResponseText(payload), payload?.error?.message || payload?.error);
      }
    }

    // NVIDIA: повтор на том же ключе при 504 убран. Шлюз держит соединение до 90 с
    // и отдаёт тот же 504 — в живом APK это давало ~180 с простоя на один вызов,
    // прежде чем начиналась ротация моделей. Теперь сразу идём к следующей модели
    // цепочки, а если легла вся цепочка — каскад переходит к следующему провайдеру.
    //
    // Вместо него — страховка для JSON-режима: Groq (и любой OpenAI-совместимый
    // провайдер) отвечает 400, если response_format: json_object запрошен без слова
    // «json» в messages. Промпт выше уже дополнен контрактом формата; здесь повтор
    // без response_format, симметрично серверной руке (server/llmProvider.ts).
    if (response.status === 400 && request.json && isJsonKeywordError(payload)) {
      emitApiTrace(traceFor(
        provider,
        effectiveModel,
        key,
        index + 1,
        keyPool.length,
        response.status,
        `Повтор ${providerLabel(provider)} без response_format: json_object.`,
        { chars: 0 },
      ));
      response = await fetchWithTimeout(endpointFor(provider, effectiveModel, key), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...(provider === "openrouter" ? { "HTTP-Referer": "https://github.com/Practician/writers-studio-android", "X-OpenRouter-Title": "Writers Studio Android" } : {}),
        },
        body: JSON.stringify({
          model: effectiveModel,
          messages: [{ role: "system", content: systemForCall }, { role: "user", content: request.prompt }],
          temperature: request.temperature ?? 0.75,
          max_tokens: maxTokens,
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
        response = await fetchWithTimeout(NVIDIA_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: effectiveModel,
            messages: [{ role: "system", content: systemForCall }, { role: "user", content: request.prompt }],
            temperature: request.temperature ?? 0.75,
            max_tokens: Math.min(maxTokens, 4_096),
            ...(request.json ? { response_format: { type: "json_object" } } : {}),
          }),
        });
        payload = await response.json().catch(() => ({}));
      }
    }

    // Выбранный профиль OpenRouter может вернуть 200 без видимого content или быть
    // временно недоступным. Для автора это неуспех: пробуем free-router и оставляем
    // исходную диагностику в журнале. Сам free-router повторно не переключаем.
    const openrouterNeedsFallback = provider === "openrouter"
      && model !== OPENROUTER_FREE_ROUTER
      && (response.status === 402 || response.status === 404 || response.status === 410 || response.status === 502 || response.status === 503 || response.status === 504 || (response.ok && !hasVisibleResponseText(payload)));
    if (openrouterNeedsFallback) {
      const reason = response.ok
        ? `${model} не передала видимый текст; переключение на openrouter/free.`
        : `${model} недоступна (HTTP ${response.status}); переключение на openrouter/free.`;
      emitApiTrace(traceFor(
        provider,
        model,
        key,
        index + 1,
        keyPool.length,
        response.status,
        reason,
        { chars: 0, finishReason: finishReasonFor(payload) },
      ));
      effectiveModel = OPENROUTER_FREE_ROUTER;
      notifyOpenRouterFallback(model, OPENROUTER_FREE_ROUTER);
      response = await fetchWithTimeout(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "https://github.com/Practician/writers-studio-android",
          "X-OpenRouter-Title": "Writers Studio Android",
        },
        body: JSON.stringify({
          model: effectiveModel,
          messages: [{ role: "system", content: systemForCall }, { role: "user", content: request.prompt }],
          temperature: request.temperature ?? 0.75,
          max_tokens: maxTokens,
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      payload = await response.json().catch(() => ({}));
    }

    const rawProviderMessage = payload?.error?.message || payload?.error || `Ошибка ${providerLabel(provider)} (${response.status})`;
    const providerMessage = shouldRotateProviderKey(provider, response.status) && index + 1 >= keyPool.length
      ? `${rawProviderMessage}. Ротация ключей недоступна: сохранён только ключ ${index + 1}/${keyPool.length}.`
      : rawProviderMessage;
    if (response.ok) {
      try {
        const text = responseText(payload);
        emitApiTrace(traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, undefined, { chars: text.length, finishReason: finishReasonFor(payload) }));
        return text;
      } catch (error: any) {
        const nextProvider = nextFallbackProvider(triedSoFar, request.apiKeys || {});
        const exhaustedNote = provider === "nvidia" || provider === "gemini" ? ` ${providerLabel(provider)} исчерпала ротацию моделей;` : "";
        const message = nextProvider
          ? `${error?.message || `${providerLabel(provider)} не передала текст.`}${exhaustedNote} переход к ${providerLabel(nextProvider)}.`
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
        if (nextProvider) return directGenerate({ ...request, provider: nextProvider, model: undefined, triedProviders: triedSoFar });
        // У провайдера HTTP 200, но для UI это должна быть явная ошибка, а не пустой результат.
        throw new DirectProviderError(String(trace.message), 502, trace);
      }
    }
    const nextProvider = nextFallbackProvider(triedSoFar, request.apiKeys || {});
    // Ключ меняем только если он действительно есть и статус того требует.
    // Сообщение журнала обязано совпадать с действием: раньше на 503 в много-
    // ключевой конфигурации APK писал «переход к Groq», а сам переходил к
    // следующему ключу Gemini — журнал выглядел зацикленным на Gemini.
    const rotateKey = index + 1 < keyPool.length && shouldRotateProviderKey(provider, response.status);
    const exhaustedNote = provider === "nvidia" || provider === "gemini" ? ` ${providerLabel(provider)} исчерпала ротацию моделей;` : "";
    const messageWithFallback = rotateKey || !nextProvider
      ? providerMessage
      : `${providerMessage}.${exhaustedNote} переход к ${providerLabel(nextProvider)}.`;
    const trace = traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, messageWithFallback, { chars: 0, finishReason: finishReasonFor(payload) });
    emitApiTrace(trace);

    if (rotateKey) {
      notifyApiKeyRotation(provider, index + 1, index + 2, keyPool.length, response.status);
      continue;
    }
    if (nextProvider) return directGenerate({ ...request, provider: nextProvider, model: undefined, triedProviders: triedSoFar });
    throw new DirectProviderError(String(messageWithFallback), response.status, trace);
  }

  // Цикл мог закончиться на пропущенных припаркованных ключах — тогда честнее
  // отдать запрос следующему провайдеру, чем показать автору ошибку настройки.
  const finalFallback = nextFallbackProvider(triedSoFar, request.apiKeys || {});
  if (finalFallback) {
    emitApiTrace(traceFor(provider, model, keyPool[0] || "", 1, keyPool.length, 429, `Ключи ${providerLabel(provider)} недоступны (пауза/квота); переход к ${providerLabel(finalFallback)}.`, { chars: 0 }));
    return directGenerate({ ...request, provider: finalFallback, model: undefined, triedProviders: triedSoFar });
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
- Пиши живой, неровный человеческий текст: чередуй короткие и длинные фразы — каждые 3–4 предложения делай одно очень коротким (3–6 слов); два соседних предложения не начинай одинаково.
- Показывай эмоции через выбор, жест, предмет, телесное ощущение и действие; не называй эмоцию вместо сцены.
- Убирай канцелярит, универсальные выводы, повторяющиеся зачины и шаблонные связки.
- Проверь каждый абзац на «рефлексивный хвост» (обобщение/вывод в конце: «она поняла, что…», «это значило, что…») — если он есть, убери его или замени действием либо предметом, меняющим смысл.
- Для каждого абзаца ответь, на какой вопрос он отвечает; если два абзаца подряд отвечают на один и тот же вопрос, второй переделай — противоречием, отступлением или конкретной деталью.
- Не используй синтаксические шаблоны: перечисление из трёх и более однородных членов дважды в абзаце, причастный/деепричастный оборот после каждой второй запятой, готовые абстрактные пары («надежда и страх», «свет и тень»), двойные сравнения («словно… будто…», «не только… но и…»).
- Сохраняй канон, факты, имена, точку зрения и события. Не объясняй применённые приёмы.
- Образец автора и паспорт голоса выше важнее общих шаблонов. ${preset}`;
}

function needsHumanizePass(action: string, body: any): boolean {
  return Boolean(body?.humanize) && ["continue", "generate_full_chapter", "improve", "rewrite_detector_segments"].includes(action);
}

function normalizeHumanizeDepth(value: unknown, fallback: "fast" | "balanced" | "maximum" = "balanced"): "fast" | "balanced" | "maximum" {
  return value === "fast" || value === "balanced" || value === "maximum" ? value : fallback;
}

const CHAPTER_TARGET_WORDS = 3_300;
// Модели отвечают короткими фрагментами (в живом журнале глава вставала на 2326 словах
// из 3300), поэтому попыток дописывания больше, а фрагмент короче 120 слов считается
// застоем и повторяется с жёстким требованием объёма.
const MAX_CHAPTER_CONTINUATIONS = 10;
const MIN_CONTINUATION_WORDS = 120;

function countGeneratedWords(text: string): number {
  return (text.match(/[A-Za-zА-Яа-яЁё0-9]+(?:[-'][A-Za-zА-Яа-яЁё0-9]+)*/gu) || []).length;
}

// Процентный потолок роста ненадёжен на коротких текстах (единицы слов дают
// огромный процентный разброс) — берём более мягкую из двух границ: процент
// ИЛИ фиксированный запас слов.
function maxAllowedGrowth(baseWords: number, ratio: number, wordBuffer = 80): number {
  return Math.max(Math.ceil(baseWords * ratio), baseWords + wordBuffer);
}

function notifyChapterVolume(words: number, segments: number, target: number, complete: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("writers-studio-chapter-volume", { detail: { words, segments, target, complete } }));
}

export function promptForAction(action: string, body: any): { system: string; prompt: string; json?: boolean } {
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
  if (action === "generate_chapters") {
    return {
      system: "Ты литературный планировщик. Верни только JSON без markdown.",
      prompt: `Составь поглавный план книги «${body?.title || "Без названия"}».
Жанр: ${body?.genre || "не указан"}. Описание: ${body?.description || "нет"}.

БИБЛИЯ МИРА И ПАСПОРТА ГЕРОЕВ:
"""
${body?.worldBible || "не заполнены"}
"""

ПЛАН КНИГИ / СЮЖЕТНЫЕ АРКИ:
"""
${body?.bookPlan || "не заполнен"}
"""

Нужны 6–12 глав, покрывающих сюжет от завязки до развязки. Для каждой главы: короткий title (БЕЗ слова «Глава N» — номер добавит приложение) и summary из 2–4 предложений: событие главы, решение героя, поворот. Не раскрывай в синопсисе развязки из более поздних глав. Соблюдай лор из Библии мира и психологию героев из их паспортов.
Верни строго JSON: {"chapters":[{"title":"...","summary":"..."}]} — без markdown и без пояснений.`,
      json: true,
    };
  }

  if (action === "generate_plan") return { system: "Ты редактор романа.", prompt: `${context}\n\nСоставь подробный план книги с главами, поворотами и финалом.` };
  if (action === "generate_bible") return { system: "Ты редактор романа.", prompt: `${context}\n\nСобери ясную библию мира: правила, места, ограничения и факты, которые нельзя нарушать.` };
  if (action === "evaluate_idea") return { system: "Ты опытный литературный редактор.", prompt: `${context}\n\nДай практическую оценку идеи: сильные стороны, риски, конкретные улучшения.` };
  if (action === "brainstorm") return { system: "Ты творческий соавтор.", prompt: `${context}\n\nПредложи свежие варианты для темы: ${body?.topic || body?.customPrompt || "следующей сцены"}. Дай несколько конкретных идей.` };
  if (action === "muse") return { system: "Ты Муза — бережный соавтор писателя.", prompt: `${context}\n\nОтветь на вопрос автора: ${body?.customPrompt || body?.prompt || "Помоги со следующей сценой."}` };
  if (action === "improve") return { system: "Ты бережный литературный редактор. Сохраняй события, имена и факты.", prompt: `${context}${humanize}\n\nПерепиши текст по задаче «${body?.stylePreset || body?.customPrompt || "улучшить стиль"}». Верни только готовый текст.\n\nТекст:\n${text}` };
  if (action === "continue" || action === "generate_full_chapter") return { system: "Ты пишешь художественную прозу по канону автора. Не объясняй свои действия.", prompt: `${context}${humanize}\n\n${action === "continue" ? "Продолжи текущую сцену 4–7 содержательными абзацами, с действием, деталями и завершённым микроповоротом. Не начинай абзац с рефлексии героя и не подводи итог в конце — двигай сцену действием." : "Напиши полноценную художественную главу объёмом около 3 300 слов (допустимо ±10%), с несколькими сценами, диалогами, конкретными деталями и завершённым поворотом. Не обрывай текст до достижения 3 000 слов.\n\nПЕРЕД НАПИСАНИЕМ зафиксируй архитектуру главы (в тексте её не называй):\n- Тема главы — скрытая: нигде не называй её словами, выведи через конфликт и выборы героя.\n- Герой вводится через действие, диалог или предмет, а не портретом и биографией.\n- Одна под-линия, пересекающаяся с главной не позже середины главы.\n- Развязка — не «герой принял и повзрослел»: вместо вывода поставь действие или предмет, который меняет смысл сцены.\n- Минимум один конкретный якорь (место, книга, марка, блюдо, запах) с точной деталью.\n- Ровно один структурный ход, нетипичный для этого сюжета (флэшбэк, сменивший порядок; сцена глазами второго персонажа; ложная цель, сорвавшаяся к концу).\n- Последний абзац оборви на один такт раньше, чем кажется «полным»: без итоговой рефлексии героя."}. Учти пожелание: ${body?.customPrompt || "сохрани тон и канон"}.\n\nТекущий текст:\n${text}` };
  return { system: "Ты литературный помощник.", prompt: `${context}\n\n${body?.customPrompt || "Помоги автору с текстом."}\n\n${text}` };
}

/** Парсит JSON из ответа модели: срезает ```-фенсы, пояснения до/после JSON. */
export function safeJson(text: string, fallback: any) {
  const raw = String(text || "").trim();
  const attempts = [
    raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/g, "").trim(),
    raw.slice(Math.max(raw.indexOf("{"), 0), raw.lastIndexOf("}") + 1),
  ];
  for (const attempt of attempts) {
    if (!attempt || (!attempt.startsWith("{") && !attempt.startsWith("["))) continue;
    try {
      return JSON.parse(attempt);
    } catch {
      // пробуем следующий вариант
    }
  }
  return fallback;
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

export function maxTokensForAction(action?: string): number {
  if (action === "generate_full_chapter") return 6_144;
  if (action === "continue") return 2_560;
  // Поглавный план на 20 глав с синопсисами и разбор Библии мира на кириллице
  // не влезают в 3 072 токена — ответ обрезался по length и терял главы.
  if (action === "generate_chapters") return 8_192;
  if (action === "parse_import") return 6_144;
  return 2_048;
}

// Лимит для чанка главы (6 144) рассчитан на один фрагмент ~700-1000 слов, а не
// на переписывание всей уже собранной главы целиком — на кириллице это давало
// стабильную обрезку (`завершение length`) и проваленный локальный аудит.
// Оцениваем нужный бюджет от фактической длины текста, консервативно (~2 симв./токен).
function humanizeMaxTokens(charLength: number): number {
  return Math.max(6_144, Math.min(16_000, Math.ceil(charLength / 2) + 1_024));
}

export async function directApi(path: string, init?: RequestInit): Promise<Response> {
  const body = typeof init?.body === "string" ? JSON.parse(init.body || "{}") : init?.body || {};
  const credentials = requestCredentials(body);
  const json = (value: any, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  // Даже после перехвата /api/* в APK сигнал должен дойти до нативного запроса провайдера.
  const generate = (request: Omit<DirectRequest, "signal">) => directGenerate({
    ...request,
    signal: init?.signal,
    maxTokens: request.maxTokens ?? maxTokensForAction(body?.action),
  });

  // Адаптер sepia-pipeline (server/chapterGenerate.ts) к прямому API-клиенту APK:
  // те же сигнал и дефолтные лимиты токенов, что у обычного generate-вызова.
  const pipelineGenerate: GenerateFn = (params) => directGenerate({
    provider: credentials.provider,
    model: params.model,
    apiKeys: credentials.keys,
    signal: init?.signal,
    system: params.systemInstruction,
    prompt: params.contents,
    temperature: params.temperature,
    maxTokens: params.maxOutputTokens ?? maxTokensForAction(body?.action),
    json: params.responseMimeType === "application/json",
  });

  // Персона повествования для пайплайна: паспорт голоса автора или выбранный
  // пресет голоса + адаптивные правила стиля — как в серверной версии.
  const pipelinePersonaBlock = (() => {
    const preset = voicePresetById(body?.voicePreset);
    const persona = body?.voiceSheet
      ? voicePersonaBlock(body.voiceSheet)
      : preset
        ? `ПЕРСОНА РАССКАЗЧИКА:\n${preset.directives}`
        : "";
    const adaptive = typeof body?.adaptiveStyleGuidance === "string"
      ? String(body.adaptiveStyleGuidance).slice(0, 4_000)
      : "";
    return [persona, adaptive].filter(Boolean).join("\n\n");
  })();

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

      // Точенчая правка только AI-сегментов отчёта нейродетектора теперь идёт через
      // общий sepia-пайплайн (server/chapterGenerate.ts) — тот же маршрут, что и в
      // серверной версии: батчами по 4 сегмента, приёмка по локальному аудиту,
      // лёгкий touchup и финальная гигиена. Раньше здесь был отдельный ручной поток
      // с «чужой моделью» и вторым проходом — он дублировал пайплайн и расходился
      // с серверным поведением.
      if (action === "rewrite_detector_segments") {
        const segments: Array<{ text?: string; label?: string }> = Array.isArray(body.detectorSegments) ? body.detectorSegments : [];
        if (!segments.length) return json({ error: "Нет сегментов детектора для переписывания." }, 400);
        const rewritten = await rewriteDetectorAiSegments(
          segments.map((segment) => ({
            text: String(segment?.text || ""),
            label: String(segment?.label || "UNKNOWN"),
          })),
          pipelineGenerate,
          {
            model: credentials.model || "",
            personaBlock: pipelinePersonaBlock,
            humanizeDepth: normalizeHumanizeDepth(body?.humanizeDepth, "maximum"),
          },
        );
        return json({
          result: rewritten.text,
          blocks: rewritten.blocks,
          humanizeReport: rewritten.humanizeReport,
          rewrittenCount: rewritten.rewrittenCount,
          model: credentials.model,
        });
      }

      // Полная глава с humanize: единый sepia-pipeline (сцены/кандидаты → best-of-N
      // → multi-pass touchup → гигиена), идентичный серверному. Раньше глава сначала
      // собиралась продолжениями вручную, а потом целиком переписывалась отдельным
      // «человеческим» проходом — теперь это один вызов пайплайна.
      if (action === "generate_full_chapter" && Boolean(body?.humanize)) {
        const input: ChapterGenerateInput = {
          title: String(body?.title || ""),
          genre: String(body?.genre || ""),
          description: String(body?.description || ""),
          currentChapterTitle: String(body?.currentChapterTitle || ""),
          currentChapterSummary: String(body?.currentChapterSummary || ""),
          previousChapter: String(body?.previousChapter || ""),
          worldBible: String(body?.worldBible || ""),
          bookPlan: String(body?.bookPlan || ""),
          canonDossier: String(body?.canonDossier || ""),
          customPrompt: String(body?.customPrompt || ""),
          authorSample: typeof body?.authorSample === "string" ? body.authorSample : undefined,
          voiceSheet: body?.voiceSheet,
          voicePreset: typeof body?.voicePreset === "string" ? body.voicePreset : undefined,
          humanizeDepth: normalizeHumanizeDepth(body?.humanizeDepth),
          adaptiveStyleGuidance: typeof body?.adaptiveStyleGuidance === "string" ? String(body.adaptiveStyleGuidance).slice(0, 4_000) : undefined,
          chapterCandidates: typeof body?.chapterCandidates === "number" ? body.chapterCandidates : undefined,
          model: credentials.model || "",
        };
        const generated = await generateHumanizedChapter(input, pipelineGenerate);
        const words = countGeneratedWords(generated.text);
        notifyChapterVolume(words, generated.humanizeReport.scenesGenerated || 1, CHAPTER_TARGET_WORDS, words >= CHAPTER_TARGET_WORDS);
        notifyHumanizePass(generated.humanizeReport.depth, generated.text.length, generated.text.length, {
          scoreBefore: generated.humanizeReport.scoreBefore,
          scoreAfter: generated.humanizeReport.scoreAfter,
          gatePassed: generated.humanizeReport.gatePassed,
          passesRun: generated.humanizeReport.passesRun,
        });
        return json({
          result: generated.text,
          humanizeReport: generated.humanizeReport,
          humanizeApplied: true,
          chapterWords: words,
          chapterTargetWords: CHAPTER_TARGET_WORDS,
          chapterSegments: generated.humanizeReport.scenesGenerated || 1,
          model: credentials.model,
        });
      }

      const setup = promptForAction(action, body);
      let text = await generate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, prompt: setup.prompt, system: setup.system, json: setup.json });
      if (action === "editorial_review") return json({ review: safeJson(text, { readiness: "Проверка готова", summary: text, checks: [], risks: [], nextStep: "Откройте результат и внесите правки." }) });

      // Модели могут поставить finish_reason=stop после короткого фрагмента, игнорируя
      // указанный объём. Для полной главы измеряем фактические слова и дописываем сцены.
      let chapterSegments = 1;
      if (action === "generate_full_chapter") {
        let stalls = 0;
        for (let continuation = 0; continuation < MAX_CHAPTER_CONTINUATIONS && countGeneratedWords(text) < CHAPTER_TARGET_WORDS; continuation += 1) {
          const currentWords = countGeneratedWords(text);
          const remaining = Math.max(1, CHAPTER_TARGET_WORDS - currentWords);
          const askWords = Math.min(900, remaining);
          const system = `Ты продолжаешь уже начатую художественную главу. Верни только новый фрагмент прозы на русском, без заголовка, повтора и комментариев.${humanizeDirective(body)}`;
          const promptFor = (firm: boolean) => [
            compactContext(body),
            `НАПИСАНО УЖЕ: около ${currentWords} слов. ЦЕЛЬ ГЛАВЫ: около ${CHAPTER_TARGET_WORDS} слов.`,
            `Хвост текущей главы:\n${text.slice(-6500)}`,
            "Продолжи строго с этого места. Не пересказывай и не повторяй написанное.",
            firm
              ? `Прошлый фрагмент вышел слишком коротким. Напиши одну законченную сцену не менее ${askWords} слов: диалог или действие, новая деталь обстановки, поворот. Не завершай главу, пока не наберёшь объём.`
              : `Напиши следующую законченную сцену или развитие сцены объёмом не менее ${askWords} слов; двигай сюжет к завершённому повороту главы.`,
          ].join("\n\n");
          let next = await generate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, system, prompt: promptFor(false) });
          let gained = countGeneratedWords(next);
          if (gained < MIN_CONTINUATION_WORDS && continuation < MAX_CHAPTER_CONTINUATIONS - 1) {
            const firmer = await generate({ provider: credentials.provider, model: credentials.model, apiKeys: credentials.keys, system, prompt: promptFor(true) });
            if (countGeneratedWords(firmer) > gained) {
              next = firmer;
              gained = countGeneratedWords(next);
            }
          }
          if (gained <= 0) break;
          text = `${text.trim()}\n\n${next.trim()}`;
          chapterSegments += 1;
          stalls = gained < MIN_CONTINUATION_WORDS ? stalls + 1 : 0;
          if (stalls >= 2) break;
        }
        notifyChapterVolume(countGeneratedWords(text), chapterSegments, CHAPTER_TARGET_WORDS, countGeneratedWords(text) >= CHAPTER_TARGET_WORDS);
      }

      const humanizeApplied = needsHumanizePass(action, body);
      let humanizeReport: HumanizeReport | null = null;
      if (humanizeApplied && text.length > 200) {
        // continue/improve: черновик уже сгенерирован общим promptForAction —
        // доводка одной точкой через общий sepia-пайплайн (аудит → точечная правка
        // блоков → ритм-проход → гигиена). Раньше вместо этого весь черновик
        // переписывался одним длинным промптом с ручным ратчет-проходом.
        const depth = normalizeHumanizeDepth(body?.humanizeDepth);
        const depthConfig = resolveHumanizeDepth(depth);
        const beforeChars = text.length;
        const beforeWords = countGeneratedWords(text);
        try {
          const polished = await humanizeProseDraft(text, pipelineGenerate, {
            model: credentials.model || "",
            personaBlock: pipelinePersonaBlock,
            humanizeDepth: depth,
          });
          const polishedWords = countGeneratedWords(polished.text);
          // Постпроход иногда разгоняет текст (лишние сравнения/описания — обвес,
          // коррелирующий с ухудшением у внешних детекторов): такой вариант не берём.
          if (polished.text.trim() && polishedWords <= maxAllowedGrowth(beforeWords, 1.25)) {
            text = polished.text;
          }
          humanizeReport = polished.humanizeReport;
        } catch (touchupError) {
          console.warn("Авто-доводка continue не удалась:", touchupError);
          const score = aiTellScore(text);
          const hygiene = sanitizeGeneratedText(text);
          text = hygiene.text;
          humanizeReport = {
            scoreBefore: score.score,
            scoreAfter: score.score,
            refinedBlocks: 0,
            flaggedLabels: [...new Set(score.hits.map((hit) => hit.label))].slice(0, 10),
            unresolvedLabels: [],
            burstiness: score.burstiness,
            openerRepetition: score.openerRepetition,
            patternDensity: score.patternDensity,
            gatePassed: false,
            passesRun: 0,
            scenesGenerated: 0,
            depth: depthConfig.id,
            mode: "single",
            textHygiene: hygiene.report,
          };
        }
        notifyHumanizePass(depth, beforeChars, text.length, {
          scoreBefore: humanizeReport?.scoreBefore ?? 0,
          scoreAfter: humanizeReport?.scoreAfter ?? 0,
          gatePassed: humanizeReport?.gatePassed ?? false,
          passesRun: humanizeReport?.passesRun ?? 0,
        });
      }

      const chapterWords = action === "generate_full_chapter" ? countGeneratedWords(text) : undefined;
      return json({ result: text, humanizeReport, humanizeApplied, ...(chapterWords !== undefined ? { chapterWords, chapterTargetWords: CHAPTER_TARGET_WORDS, chapterSegments } : {}) });
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
