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
  /** Таймаут одного запроса (мс). Сцены литературного прохода просят 45 с вместо 90:
   *  зависший шлюз дороже быстрой ротации на резервную модель. */
  timeoutMs?: number;
  /** Внутреннее: провайдеры, уже испробованные в этой цепочке каскада (не для внешних вызовов). */
  triedProviders?: readonly Exclude<DirectProvider, "auto">[];
};

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
/**
 * Адрес шлюза Gemini можно подменить — это нужно живому стенду и тестам: полный
 * цикл «парковка ключа → пропуск → добор рабочим ключом → обрезка ответа» надо
 * прогнать на реальном HTTP, а не на подмене fetch. В APK значение всегда
 * остаётся адресом Google, подмена живёт только внутри процесса теста.
 */
let geminiBaseUrl = GEMINI_URL;

export function __setGeminiBaseUrlForTests(value?: string | null): void {
  geminiBaseUrl = value || GEMINI_URL;
}
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
// 8 слотов = четыре живых профиля плюс запасные модели с СОБСТВЕННЫМИ дневными
// бакетами (2.5-flash, 2.5-flash-lite, 3.1-flash-lite, 2.0-flash): у Google квота
// считается по каждой модели отдельно, поэтому исчерпанная квота 3.8 не означает
// исчерпанную квоту проекта. Часть запасных ключам новых проектов отвечает 404 —
// такие модели запоминаются как недоступные и больше не тратят попытку.
const GEMINI_MAX_MODEL_ATTEMPTS = 8;

// --- Адаптивная память моделей Gemini по ключу ---------------------------------
// Переключение моделей полностью автоматическое: приложение само уходит на резервную
// модель, когда основная упирается в лимит или недоступна, и само возвращается на неё,
// когда пауза истекла. Вручную выбирать профиль в настройках не нужно.
// Память ведётся отдельно для каждого ключа (по последним 4 знакам), потому что
// доступность модели у Google привязана к проекту ключа: ключам новых проектов
// gemini-2.5-flash отвечает 404, ключам старых — работает. Сам ключ не хранится.
const GEMINI_HEALTH_LS = "writers_studio_gemini_health_v1";
/**
 * 404/410 — модель недоступна этому ключу: не тратим на неё попытку, но перепроверим.
 * Неделя оказалась слишком долгим сроком: в живом журнале автора (18.09.2026)
 * gemini-3.8-flash, GA с 2 сентября 2026, висела помеченной «недоступна» и автор
 * молча писал лайт-моделями, не видя ни причины, ни срока пометки. Держим шесть часов.
 */
const GEMINI_DEAD_TTL_MS = 6 * 60 * 60 * 1000;
/** 429 — сначала короткая пауза (минутный лимит), при повторе — длинная (дневная квота). */
const GEMINI_QUOTA_COOLDOWN_MS = 3 * 60 * 1000;
const GEMINI_QUOTA_COOLDOWN_HARD_MS = 30 * 60 * 1000;
/** 500/502/503/504 и пустой ответ — перегрузка: пауза на минуту. */
// Перегрузка Google держится минутами. Прежние 60 с отката возвращали сломанную
// модель в работу внутри той же главы: в живом журнале 18.09.2026 gemini-3.7-flash
// отдавала 503 трижды (13:08, 13:10 и 13:12), и каждая дописка главы теряла на ней
// до 50 секунд, пока рабочая модель ждала очереди. Теперь откат растёт с числом
// перегрузок подряд: 1 минута → 5 минут → 15 минут.
const GEMINI_OVERLOAD_COOLDOWN_MS = 60 * 1000;
const GEMINI_OVERLOAD_COOLDOWN_MEDIUM_MS = 5 * 60 * 1000;
const GEMINI_OVERLOAD_COOLDOWN_HARD_MS = 15 * 60 * 1000;
/**
 * Паузы перед повтором ТОЙ ЖЕ модели при транзиентных 5xx. Раньше APK на 503/504
 * сразу менял модель, и в живом журнале это выглядело циклом 3.8 → 3.6 →
 * flash-latest → 3.8, потому что перегруженная секунду назад модель возвращалась
 * в цепочку. Небольшой backoff с разбросом отдаёт перегрузку серверу, а не
 * расходует попытки на всех моделях ключа.
 */
const GEMINI_SERVER_RETRY_DELAYS_MS = [800, 2_000];

function isTransientGeminiStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Потолок ожидания, которое имеет смысл переждать внутри одного запроса (см. retry-after Groq). */
const RETRY_AFTER_MAX_WAIT_MS = 25_000;

/**
 * Точный срок ожидания из ответа провайдера: заголовок retry-after (секунды) или
 * текст вида «Please try again in 18.705s», которым Groq сообщает остаток минутного
 * лимита. 0 — срока нет, ждать нечего.
 */
function parseRetryAfterMs(payload: any, headers?: Headers | null): number {
  const header = typeof headers?.get === "function" ? headers.get("retry-after") : null;
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  }
  const text = String(payload?.error?.message || payload?.error || "");
  const match = text.match(/try again in\s+([\d.]+)\s*(ms|s|m)?/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = (match[2] || "s").toLowerCase();
  if (unit === "ms") return Math.round(value);
  if (unit === "m") return Math.round(value * 60_000);
  return Math.round(value * 1000);
}
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
  /** Почему модель снята и насколько: «недоступна этому ключу (HTTP 404)», «исчерпана дневная квота модели». */
  deadReason?: Record<string, string>;
  cooling: Record<string, number>;
  quotaHits: Record<string, number>;
  /** Сколько раз подряд модель попадала на 5xx: откат растёт (1 мин → 5 → 15). */
  overloadHits: Record<string, number>;
  /** Модель, последней отдавшая текст: с неё начинается следующая дописка главы. */
  lastGood?: string;
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
  const entry = memory[key.slice(-4)] || (memory[key.slice(-4)] = { dead: {}, cooling: {}, quotaHits: {}, overloadHits: {} });
  entry.dead ||= {};
  entry.deadReason ||= {};
  entry.cooling ||= {};
  entry.quotaHits ||= {};
  entry.overloadHits ||= {};
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
 * HTTP 429 у Gemini бывает двух разных природ: минутный лимит запросов (модель
 * оживёт сама, ключ рабочий) и исчерпанная дневная квота проекта. Различать их по
 * одному тексту НЕЛЬЗЯ: «You exceeded your current quota … check your plan and
 * billing details» Google отдаёт и на минутный лимит — в живом журнале APK
 * 18.09.2026 ключ, отвечавший 200 секундами раньше, был по этой фразе припаркован
 * как «дневная квота» на часы. Надёжный признак — измерение квоты в details:
 * …PerDay… против …PerMinute…
 */
type GeminiQuotaKind = "daily" | "minute";

function geminiQuotaKind(payload: any): GeminiQuotaKind {
  const error = payload?.error ?? payload ?? {};
  const details = Array.isArray(error?.details) ? error.details : [];
  const violations = details.flatMap((detail: any) => (Array.isArray(detail?.violations) ? detail.violations : []));
  const metrics = violations
    .map((violation: any) => `${violation?.quotaMetric ?? ""} ${violation?.quotaId ?? ""}`)
    .join(" ");
  const code = String(error?.status ?? error?.code ?? "").toLowerCase();
  const text = `${code} ${metrics} ${String(error?.message ?? "")}`.toLowerCase();
  if (/perday|per_day|per\s*day|daily|requests_per_day/.test(text)) return "daily";
  // Без явного дневного измерения 429 считаем минутным: ключ не паркуем,
  // остывает только модель (короткая пауза в recordGeminiOutcome).
  return "minute";
}

function pacificParts(ms: number): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour") % 24, minute: read("minute") };
}

/** Смещение America/Los_Angeles относительно UTC в этот момент (учитывает летнее/зимнее время). */
function pacificOffsetMs(ms: number): number {
  const parts = pacificParts(ms);
  const minute = ms - (ms % 60_000);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - minute;
}

/**
 * Ближайшая полночь America/Los_Angeles: квоты Google сбрасываются по тихоокеанскому
 * времени, а не по UTC. Раньше пауза считалась до полуночи UTC — в живом журнале APK
 * это давало «ключ в паузе до 03:05» по Киеву, то есть за семь часов до настоящего
 * сброса, и ключ простаивал весь следующий день автора.
 */
function nextPacificMidnight(now: number): number {
  try {
    const parts = pacificParts(now);
    const targetWall = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0);
    // Смещение ищем по фактическому моменту, а не по «сегодняшнему»: в дни перехода
    // на летнее/зимнее время оно меняется, и одной подстановки мало.
    let guess = targetWall - pacificOffsetMs(now);
    guess = targetWall - pacificOffsetMs(guess);
    guess = targetWall - pacificOffsetMs(guess);
    return guess + 5 * 60 * 1000;
  } catch {
    // Экзотическая среда без Intl: падаем на прежнее поведение (полночь UTC).
    const date = new Date(now);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 5, 0);
  }
}

/** 0 — ключ рабочий; иначе время, до которого он снят с использования. */
export function geminiKeyPauseUntil(key: string): number {
  return geminiMemoryFor(key).keyPauseUntil ?? 0;
}

/**
 * Состояние памяти для окна настроек: какие ключи Gemini на паузе (и почему),
 * какие модели признаны недоступными или остывают. Ключ показывается только
 * последними четырьмя знаками — как и везде в журнале.
 */
export type GeminiHealthSummary = {
  paused: Array<{ suffix: string; until: number; reason: string }>;
  /** Снятые модели с причиной и сроком — автор видит, почему флагман не в работе. */
  dead: Array<{ model: string; reason: string; until: number }>;
  cooling: string[];
};

export function geminiHealthSummary(): GeminiHealthSummary {
  const now = Date.now();
  const memory = loadGeminiMemory();
  const paused: Array<{ suffix: string; until: number; reason: string }> = [];
  const dead = new Map<string, { model: string; reason: string; until: number }>();
  const cooling = new Set<string>();
  for (const [suffix, entry] of Object.entries(memory || {})) {
    if (!entry) continue;
    if ((entry.keyPauseUntil ?? 0) > now) paused.push({ suffix, until: entry.keyPauseUntil as number, reason: entry.pauseReason || "ключ отклонён" });
    for (const [model, until] of Object.entries(entry.dead || {})) {
      if (until <= now) continue;
      const previous = dead.get(model);
      // Показываем ближайший срок: пометки живут по ключам отдельно.
      if (!previous || until < previous.until) dead.set(model, { model, reason: entry.deadReason?.[model] || "недоступна этому ключу", until });
    }
    for (const [model, until] of Object.entries(entry.cooling || {})) if (until > now) cooling.add(model);
  }
  paused.sort((a, b) => a.until - b.until);
  return { paused, dead: [...dead.values()].sort((a, b) => a.until - b.until), cooling: [...cooling] };
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
 * Состояние КЛЮЧА целиком: пауза ставится только за отказ авторизации (401/403),
 * её снимает первый же успешный ответ. Дневная квота ключ больше не паркует: у Google
 * RPD считается на модель в проекте, поэтому такой отказ снимает модель
 * (recordGeminiOutcome), а ключ остаётся рабочим для остальных моделей.
 *
 * Живой журнал автора 18.09.2026 показал, почему прежняя логика не работала: запрос
 * с 429 PerDay парковал ключ до полуночи, но следующий же успешный HTTP 200 соседней
 * модели в том же запросе вызывал releaseGeminiKey и снимал паузу — в журнале это
 * выглядело сплошными «ключ 1/3» без единой строки о пропуске.
 */
function noteGeminiKeyOutcome(key: string, status: number, ok: boolean, hasText: boolean): void {
  if (ok && hasText) {
    releaseGeminiKey(key);
    return;
  }
  const now = Date.now();
  if (status === 401 || status === 403) {
    parkGeminiKey(key, now + GEMINI_KEY_AUTH_COOLDOWN_MS, `ключ отклонён (${status})`);
  }
}

/**
 * Цепочка моделей Gemini с учётом выученного состояния ключа: рабочие модели — в
 * настроенном порядке, «остывающие» (429/503) — в хвост, недоступные ключу (404) —
 * пропускаются. Если рабочего не осталось, порядок остаётся штатным: пробуем снова,
 * и уже каскад провайдеров решает, что делать.
 */
type GeminiChainPlan = {
  /** Порядок моделей для этого ключа (пусто — ключ пропускается целиком). */
  order: string[];
  /** Снятые модели с причиной и сроком: журнал обязан объяснять автовыбор. */
  skipped: Array<{ model: string; reason: string; until: number }>;
  /** Остывающие после лимита модели — с готовым сроком для журнала. */
  cooling: Array<{ model: string; until: number }>;
  /** Все модели цепочки сняты: к ключу в этом запросе не ходим вовсе. */
  exhausted: boolean;
};

function geminiModelChain(primary: string, key: string): GeminiChainPlan {
  const canonical = [...new Set([primary, ...GEMINI_FALLBACK_MODELS])].slice(0, GEMINI_MAX_MODEL_ATTEMPTS);
  const memory = geminiMemoryFor(key);
  const now = Date.now();
  const available: string[] = [];
  const cooling: Array<{ model: string; until: number }> = [];
  const skipped: Array<{ model: string; reason: string; until: number }> = [];
  for (const id of canonical) {
    const deadUntil = memory.dead[id] ?? 0;
    if (deadUntil > now) {
      skipped.push({ model: id, reason: memory.deadReason[id] || "недоступна этому ключу", until: deadUntil });
      continue;
    }
    const coolingUntil = memory.cooling[id] ?? 0;
    if (coolingUntil > now) cooling.push({ model: id, until: coolingUntil });
    else available.push(id);
  }
  // Если сняты ВСЕ модели цепочки, ключ пропускается целиком: иначе каждый запрос
  // снова сжигал бы восемь вызовов впустую — именно это выглядело «зацикливанием».
  // Остывающие модели не повод пропускать ключ: их пауза короткая, и повтор нужен.
  const exhausted = available.length === 0 && cooling.length === 0 && skipped.length > 0;
  // Липкость к последней успешной модели: она встаёт в голову цепочки. Иначе после
  // каждой дописки главы выбор возвращался к первому профилю списка, и перегруженная
  // модель опробовалась заново каждую минуту, хотя рабочая была проверена секунду назад
  // (живой журнал 18.09.2026: 2.5-flash отдала 3841 символ, а следующая дописка снова
  // ушла на 3.7-flash и сожгла на её 503 почти минуту).
  const preferred = memory.lastGood && available.includes(memory.lastGood) ? memory.lastGood : null;
  const availableOrder = preferred ? [preferred, ...available.filter((id) => id !== preferred)] : available;
  return {
    order: exhausted ? [] : [...availableOrder, ...cooling.map((entry) => entry.model)],
    skipped,
    cooling,
    exhausted,
  };
}

/** Запоминает исход вызова, чтобы следующий запрос не тратил попытку на ту же ошибку. */
function recordGeminiOutcome(key: string, model: string, status: number, ok: boolean, hasText: boolean, providerMessage?: unknown): void {
  noteGeminiKeyOutcome(key, status, ok, hasText);
  const memory = geminiMemoryFor(key);
  const now = Date.now();
  if (status === 404 || status === 410) {
    memory.dead[model] = now + GEMINI_DEAD_TTL_MS;
    memory.deadReason[model] = `недоступна этому ключу (HTTP ${status})`;
    delete memory.cooling[model];
    delete memory.quotaHits[model];
    saveGeminiMemory();
    return;
  }
  if (status === 429) {
    const hits = (memory.quotaHits[model] ?? 0) + 1;
    memory.quotaHits[model] = hits;
    if (geminiQuotaKind(providerMessage) === "daily") {
      // Дневная квота привязана к модели в проекте ключа: снимаем МОДЕЛЬ до сброса
      // квот Google (полночь America/Los_Angeles), ключ целиком не паркуем —
      // остальные модели того же ключа продолжают работать.
      memory.dead[model] = Math.max(nextPacificMidnight(now), now + GEMINI_QUOTA_COOLDOWN_MS);
      memory.deadReason[model] = "исчерпана дневная квота модели";
      delete memory.cooling[model];
    } else {
      memory.cooling[model] = now + (hits > 1 ? GEMINI_QUOTA_COOLDOWN_HARD_MS : GEMINI_QUOTA_COOLDOWN_MS);
      delete memory.dead[model];
      delete memory.deadReason[model];
    }
    saveGeminiMemory();
    return;
  }
  if (status === 500 || status === 502 || status === 503 || status === 504 || (ok && !hasText)) {
    const hits = (memory.overloadHits[model] ?? 0) + 1;
    memory.overloadHits[model] = hits;
    memory.cooling[model] = now + (hits >= 3
      ? GEMINI_OVERLOAD_COOLDOWN_HARD_MS
      : hits === 2
        ? GEMINI_OVERLOAD_COOLDOWN_MEDIUM_MS
        : GEMINI_OVERLOAD_COOLDOWN_MS);
    delete memory.dead[model];
    delete memory.deadReason[model];
    saveGeminiMemory();
    return;
  }
  if (ok && hasText) {
    const changed = model in memory.dead || model in memory.cooling || model in memory.quotaHits
      || model in memory.overloadHits || memory.lastGood !== model;
    delete memory.dead[model];
    delete memory.deadReason[model];
    delete memory.cooling[model];
    delete memory.quotaHits[model];
    delete memory.overloadHits[model];
    // Запоминаем модель, которая реально отдала текст: следующая дописка главы идёт
    // прямо на неё, а не на модель, чей минутный откат только что истёк. Без этого
    // каждая дописка начиналась с перегруженной модели и теряла на 503 до минуты.
    memory.lastGood = model;
    if (changed) saveGeminiMemory();
  }
}

// --- Бюджет вывода и «размышления» модели ------------------------------------
// У моделей Gemini с размышлениями thinking-токены тратят тот же maxOutputTokens,
// что и текст. В живом журнале APK это выглядело так: HTTP 200, но глава приходит
// фрагментом 478-2 470 символов с finishReason MAX_TOKENS — лимит съедали
// размышления, а не проза, и дописывание главы крутилось лишние проходы.
// Отключаем размышления там, где модель это принимает: весь бюджет уходит в текст.
const geminiThinkingUnsupported = new Set<string>();

function geminiSendsThinkingConfig(model: string): boolean {
  const id = String(model || "").toLowerCase();
  if (!id.includes("gemini")) return false;
  if (geminiThinkingUnsupported.has(id)) return false;
  // 2.5+ и любые thinking-профили понимают thinkingConfig. Если конкретный ключ
  // или модель поле не принимает (400 Invalid JSON payload), модель попадёт в
  // этот набор после первой ошибки и больше его не получит.
  return /gemini-(2\.5|[3-9])/.test(id) || id.includes("thinking") || id.includes("-latest");
}

function isThinkingConfigError(status: number, payload: any): boolean {
  if (status !== 400) return false;
  const text = String(payload?.error?.message || payload?.error || "").toLowerCase();
  return text.includes("thinking");
}

function hasTruncatedFinishReason(payload: any): boolean {
  return /MAX_TOKENS|LENGTH/i.test(String(finishReasonFor(payload) || ""));
}

// --- «Размышления» reasoning-моделей (NVIDIA / Groq / OpenRouter) -------------
// Симптом тот же, что у Gemini до thinkingBudget=0: HTTP 200, finish_reason=length,
// а content пустой — весь max_tokens ушёл в скрытые рассуждения, и раунд доводки
// пропадал целиком (живая приёмка 2026-09). Три ступени: гасим размышления там, где
// провайдер это документирует; снимаем поле после 400; повторяем с удвоенным
// бюджетом, если рассуждения всё равно съели вывод.
const reasoningDisableUnsupported = new Set<string>();
const REASONING_RETRY_MAX_TOKENS = 32_768;

function reasoningModelLikely(model: string): boolean {
  return /(deepseek|gpt-oss|qwq|qwen3|reasoner|thinking|magistral|glm-?4|kimi|r1)/i.test(String(model || ""));
}

/** Поля запроса, гасящие размышления (пусто — модель не reasoning или поле снято). */
function reasoningDisableFields(provider: Exclude<DirectProvider, "auto">, model: string): Record<string, unknown> {
  const id = `${provider}:${String(model || "").toLowerCase()}`;
  if (!reasoningModelLikely(model) || reasoningDisableUnsupported.has(id)) return {};
  // OpenRouter: унифицированный reasoning{enabled:false}. NVIDIA NIM и Groq: reasoning_effort=none.
  if (provider === "openrouter") return { reasoning: { enabled: false } };
  return { reasoning_effort: "none" };
}

function isReasoningDisableError(status: number, payload: any): boolean {
  if (status !== 400) return false;
  return /reasoning_effort|reasoning|chat_template_kwargs|enable_thinking|thinking/i.test(String(payload?.error?.message || payload?.error || ""));
}

/** Бюджет повтора после пустого ответа: удвоение; у Groq сверху TPM-потолок. */
function reasoningRetryBudget(provider: Exclude<DirectProvider, "auto">, current: number): number {
  const base = Number.isFinite(current) && current > 0 ? Math.floor(current) : 8192;
  const doubled = Math.min(base * 2, REASONING_RETRY_MAX_TOKENS);
  return provider === "groq" ? Math.min(doubled, 8_192) : doubled;
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
  if (provider === "gemini") return `${geminiBaseUrl}/${encodeURIComponent(model)}:generateContent`;
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

function notifyHumanizePass(
  depth: string,
  beforeChars: number,
  afterChars: number,
  audit?: {
    scoreBefore: number;
    scoreAfter: number;
    gatePassed: boolean;
    passesRun: number;
    /** Взят ли вариант прохода; false + growthNote — текст остался черновиком. */
    variantTaken?: boolean;
    /** Честное объяснение, почему вариант не взят. */
    growthNote?: string;
    /** Готовая строка итога прохода — вместо тавтологического «N → N символов». */
    summary?: string;
  },
): void {
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

// Ключ меняем только там, где смена ключа действительно помогает: исчерпанная квота
// проекта (429) и отклонённый ключ (401/403). 404/410 — свойство МОДЕЛИ для этого
// проекта (её разбирает память моделей, см. recordGeminiOutcome), а 503/504 — вообще
// перегрузка сервера Google: раньше на них уходил весь пул ключей, и транзиентный сбой
// выжигал три ключа подряд (в живом журнале — «ротация ключей» без единого 429).
function shouldRotateProviderKey(provider: DirectProvider, status: number): boolean {
  return shouldRotateKey(status) || (provider === "gemini" && (status === 401 || status === 403));
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
  // Ключ может быть снят не целиком, а по памяти моделей: дневная квота Google
  // считается на модель в проекте ключа, и когда сняты все модели цепочки, запрос
  // к такому ключу сожжёт попытки впустую. Пропускаем его как припаркованный.
  const modelExhaustedKeys = new Set(provider === "gemini"
    ? keyPool.filter((key) => geminiModelChain(model, key).exhausted)
    : []);
  const blockedKeys = new Set([...pausedKeys, ...modelExhaustedKeys]);
  if (provider === "gemini" && keyPool.length > 0 && blockedKeys.size === keyPool.length) {
    // Все ключи Gemini сняты: минутный перебор моделей ничего не даст,
    // поэтому честно уходим к следующему провайдеру вместо «зацикливания».
    const resumeAt = Math.min(...[...blockedKeys].map((key) => Math.max(
      geminiKeyPauseUntil(key),
      geminiModelChain(model, key).skipped.reduce((min, item) => Math.min(min, item.until), Number.POSITIVE_INFINITY),
    )));
    const nextProvider = nextFallbackProvider(triedSoFar, request.apiKeys || {});
    const pauseNote = `Все ключи Gemini сняты до ${timeLabel(resumeAt)} (исчерпана дневная квота моделей или ключ отклонён).`;
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
  const CLIENT_TIMEOUT_MS = request.timeoutMs ?? 90_000;
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
      // Ключ отклонён по авторизации: запрос к нему вернёт тот же 401 — пропускаем,
      // объяснив это в журнале.
      emitApiTrace(traceFor(provider, model, key, index + 1, keyPool.length, 429, `Ключ в паузе до ${timeLabel(geminiKeyPauseUntil(key))} (${geminiMemoryFor(key).pauseReason || "ключ отклонён"}): пропуск.`, { chars: 0 }));
      continue;
    }
    if (modelExhaustedKeys.has(key)) {
      // Дневная квота сняла все модели этого ключа: восемь вызовов впустую не нужны,
      // а автор должен видеть причину и срок, а не молчаливый пропуск.
      const plan = geminiModelChain(model, key);
      const example = plan.skipped[0];
      const resumeAt = plan.skipped.reduce((min, item) => Math.min(min, item.until), Number.POSITIVE_INFINITY);
      emitApiTrace(traceFor(provider, model, key, index + 1, keyPool.length, 429, `Все модели Gemini сняты для этого ключа: ${example.model} — ${example.reason} до ${timeLabel(resumeAt)}. Ключ пропущен.`, { chars: 0 }));
      continue;
    }
    let effectiveModel = model;
    let response: Response;
    let payload: any;
    // Для JSON-режима гарантируем слово «json» в messages (требование Groq),
    // не переписывая исходный промпт пайплайна.
    const systemForCall = request.json ? ensureJsonKeyword(system, request.prompt) : system;

    // OpenAI-совместимый запрос вынесен в одну функцию: он нужен и на первом шаге,
    // и при повторе без поля отключения размышлений, и при повторе с большим бюджетом.
    const callOpenAiCompat = (budget: number, extraFields: Record<string, unknown>) => fetchWithTimeout(endpointFor(provider, effectiveModel, key), {
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
        max_tokens: budget,
        ...(request.json ? { response_format: { type: "json_object" } } : {}),
        ...extraFields,
      }),
    });
    // Модели Gemini вызываются одинаково и на первом шаге, и при ротации,
    // поэтому запрос вынесен в одну функцию.
    const callGemini = (targetModel: string) => fetchWithTimeout(`${geminiBaseUrl}/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          temperature: request.temperature ?? 0.75,
          maxOutputTokens: maxTokens,
          responseMimeType: request.json ? "application/json" : "text/plain",
          ...(geminiSendsThinkingConfig(targetModel) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    });
    // Автовыбор без участия автора: порядок цепочки для этого ключа учитывает
    // прошлые 404/429/503, поэтому выбранный в настройках профиль задаёт лишь
    // приоритет, а не жёсткую привязку.
    const geminiChain = provider === "gemini" ? geminiModelChain(model, key) : null;
    const geminiOrder = geminiChain?.order ?? [];
    const learnedModel = geminiOrder[0] ?? model;
    effectiveModel = learnedModel;
    if (provider === "gemini" && learnedModel !== model) {
      // Причина и срок автовыбора выводятся в журнал: раньше строка «Автовыбор модели»
      // не объясняла, почему выбранная автором модель пропущена, и флагман мог неделю
      // не появляться в работе без единого слова (живой журнал 18.09.2026).
      const skippedSelf = geminiChain?.skipped.find((item) => item.model === model);
      const coolingSelf = geminiChain?.cooling.find((item) => item.model === model);
      const why = skippedSelf
        ? `${skippedSelf.reason} до ${timeLabel(skippedSelf.until)}`
        : coolingSelf
          ? `остывает после лимита до ${timeLabel(coolingSelf.until)}`
          : "по памяти ключа";
      emitApiTrace(traceFor(provider, model, key, index + 1, keyPool.length, undefined, `Автовыбор модели Gemini по памяти ключа: ${model} → ${learnedModel} (${why}).`, { chars: 0 }));
    }

    if (provider === "gemini") {
      response = await callGemini(effectiveModel);
    } else {
      response = await callOpenAiCompat(maxTokens, reasoningDisableFields(provider, model));
    }

    payload = await response.json().catch(() => ({}));

    // Поле отключения размышлений не поддержано (400) — снимаем его и повторяем один
    // раз, иначе лечение «пустого раунда» само стало бы причиной отказа.
    if (provider !== "gemini" && isReasoningDisableError(response.status, payload)) {
      reasoningDisableUnsupported.add(`${provider}:${String(effectiveModel).toLowerCase()}`);
      emitApiTrace(traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, `${providerLabel(provider)} «${effectiveModel}» не принимает поле отключения размышлений: повтор без него.`, { chars: 0 }));
      response = await callOpenAiCompat(maxTokens, {});
      payload = await response.json().catch(() => ({}));
    }

    // HTTP 200 и пустая проза: у reasoning-моделей весь бюджет ушёл в скрытые
    // рассуждения (finish_reason=length). Один повтор с удвоенным бюджетом —
    // вместо потерянного раунда доводки.
    if (provider !== "gemini" && response.ok && !hasVisibleResponseText(payload)) {
      const emptyFinish = finishReasonFor(payload) || "?";
      const bigger = reasoningRetryBudget(provider, maxTokens);
      if (bigger > maxTokens) {
        emitApiTrace(traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, `Пустой ответ (${emptyFinish}): размышления съели бюджет вывода — повтор с ${bigger} токенами.`, { chars: 0, finishReason: String(emptyFinish) }));
        response = await callOpenAiCompat(bigger, reasoningDisableFields(provider, effectiveModel));
        payload = await response.json().catch(() => ({}));
      }
    }

    // Ключ/модель не понимают thinkingConfig (400 Invalid JSON payload) — помечаем
    // модель и повторяем ровно один раз без поля. Иначе лечение обрезки само стало
    // бы причиной отказа, и автор получил бы ошибку вместо главы.
    if (provider === "gemini" && isThinkingConfigError(response.status, payload)) {
      geminiThinkingUnsupported.add(effectiveModel.toLowerCase());
      emitApiTrace(traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, `${effectiveModel} не принимает thinkingConfig: повтор без отключения размышлений.`, { chars: 0 }));
      response = await callGemini(effectiveModel);
      payload = await response.json().catch(() => ({}));
    }

    // Вся цепочка литературных профилей Gemini на том же ключе — управляемая
    // деградация вместо зависания на временной перегрузке (HTTP 503), лимите (429)
    // или модели, недоступной ключу (404). Состав и порядок цепочки учитывают
    // выученное состояние ключа: недоступные пропускаются, остывающие уходят в хвост
    // (сюда попадает и gemini-2.5-flash с её отдельной дневной квотой), а каждый
    // исход запоминается — следующий запрос не повторит ту же ошибку.
    if (provider === "gemini") {
      recordGeminiOutcome(key, effectiveModel, response.status, response.ok, response.ok && hasVisibleResponseText(payload), payload);
      if (response.status === 429) {
        // В журнал выводим ИЗМЕРЕНИЕ квоты: иначе автор не понимает, почему один
        // 429 снимает ключ с использования на часы, а второй — только модель.
        const quotaKind = geminiQuotaKind(payload);
        emitApiTrace(traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, quotaKind === "daily"
          ? `429: исчерпана дневная квота модели «${effectiveModel}» на этом ключе — модель снята до полуночи Pacific (${timeLabel(nextPacificMidnight(Date.now()))}), ключ рабочий.`
          : "429: исчерпан минутный лимит модели — ключ рабочий, остывает только модель.", { chars: 0 }));
      }
      // Транзиентные 5xx у Google — перегрузка сервера, а не свойство модели или
      // проекта ключа. Сначала короткий backoff и повтор ТОЙ ЖЕ модели, и только
      // потом ротация: иначе один 503 выглядит циклом по всем моделям ключа.
      let overloadRetries = 0;
      // Повторы 5xx стоят до трёх round-trip'ов, поэтому модель, уже дважды
      // перегруженная на этом ключе, не повторяется — сразу ротация.
      const overloadHistory = geminiMemoryFor(key).overloadHits?.[effectiveModel] ?? 0;
      while (!response.ok && isTransientGeminiStatus(response.status) && overloadHistory < 2 && overloadRetries < GEMINI_SERVER_RETRY_DELAYS_MS.length) {
        const delay = GEMINI_SERVER_RETRY_DELAYS_MS[overloadRetries];
        overloadRetries += 1;
        emitApiTrace(traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, `Перегрузка Gemini (HTTP ${response.status}): повтор модели «${effectiveModel}» через ${(delay / 1000).toFixed(1)} с.`, { chars: 0 }));
        await sleep(delay + Math.floor(Math.random() * 500));
        response = await callGemini(effectiveModel);
        payload = await response.json().catch(() => ({}));
        recordGeminiOutcome(key, effectiveModel, response.status, response.ok, response.ok && hasVisibleResponseText(payload), payload);
      }
      // Модель, уже опробованную в ЭТОМ запросе, второй раз не пробуем: возврат к
      // ней и давал в журнале видимый цикл 3.8 → 3.6 → flash-latest → 3.8.
      const triedModels = new Set<string>([effectiveModel]);
      const candidates = geminiOrder.slice(1).filter((id) => !triedModels.has(id));
      for (const nextModel of candidates) {
        const needsRotation = (response.ok && !hasVisibleResponseText(payload))
          || (!response.ok && shouldRotateGeminiModel(response.status));
        if (!needsRotation) break;
        triedModels.add(nextModel);
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
        recordGeminiOutcome(key, effectiveModel, response.status, response.ok, response.ok && hasVisibleResponseText(payload), payload);
      }
    }

    // Groq сообщает точный срок ожидания минутного лимита («Please try again in
    // 18.705s») в тексте ошибки и заголовком retry-after. Раньше APK этот срок не
    // читал и уходил на NVIDIA — быстрый провайдер терялся на весь запрос, хотя
    // переждать нужно было меньше двадцати секунд. Ждём только когда ключ один:
    // при нескольких ключах дешевле сразу перейти к следующему.
    if (provider !== "gemini" && response.status === 429 && index + 1 >= keyPool.length) {
      const retryAfterMs = parseRetryAfterMs(payload, response.headers);
      if (retryAfterMs > 0 && retryAfterMs <= RETRY_AFTER_MAX_WAIT_MS) {
        emitApiTrace(traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, `Лимит ${providerLabel(provider)}: ожидание ${(retryAfterMs / 1000).toFixed(1)} с и повтор той же модели.`, { chars: 0 }));
        await sleep(retryAfterMs + 250);
        response = await callOpenAiCompat(maxTokens, reasoningDisableFields(provider, effectiveModel));
        payload = await response.json().catch(() => ({}));
      }
    }

    // Автор должен видеть причину короткой главы прямо в журнале: ответ дошёл,
    // но модель упёрлась в лимит вывода. Это не ошибка ротации — дописывание
    // продолжит главу, а строка объясняет, почему фрагмент короткий.
    if (provider === "gemini" && response.ok && hasTruncatedFinishReason(payload)) {
      let chars = 0;
      try { chars = responseText(payload).length; } catch { chars = 0; }
      emitApiTrace(traceFor(provider, effectiveModel, key, index + 1, keyPool.length, response.status, `Ответ обрезан по лимиту вывода (${finishReasonFor(payload)}): ${chars} символов; продолжение допишется следующим проходом.`, { chars, finishReason: finishReasonFor(payload) }));
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
    // Смена ключа: квота и отклонённый ключ — сразу (shouldRotateProviderKey).
    // 404/410 и транзиентные 5xx — только как ПОСЛЕДНЯЯ ступень: после повторов с
    // backoff и всей цепочки моделей этого ключа. Так временный 503 больше не
    // выжигает пул ключей (раньше он расходовал их сразу, и один транзиентный сбой
    // съедал три ключа), но и не отнимает у автора рабочий второй ключ, когда
    // первый стабильно перегружен или не видит модель по всем профилям.
    const rotateKey = index + 1 < keyPool.length
      && (shouldRotateProviderKey(provider, response.status)
        || (provider === "gemini"
          && (isTransientGeminiStatus(response.status) || response.status === 404 || response.status === 410)));
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

function notifyChapterVolume(words: number, segments: number, target: number, complete: boolean, stopReason?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("writers-studio-chapter-volume", { detail: { words, segments, target, complete, ...(stopReason ? { stopReason } : {}) } }));
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
    timeoutMs: params.timeoutMs,
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
        const humanizedSegments = generated.humanizeReport.scenesGenerated || 1;
        const topupScenes = generated.humanizeReport.topupScenes || 0;
        const narrationPerson = generated.humanizeReport.narrationPerson;
        // Почему глава короче цели — в журнал: этот путь вообще не называл причину,
        // и автор видел только «2693/3300 слов после 6 фрагментов» (живой журнал 18.09.2026).
        notifyChapterVolume(
          words,
          humanizedSegments,
          CHAPTER_TARGET_WORDS,
          words >= CHAPTER_TARGET_WORDS,
          words >= CHAPTER_TARGET_WORDS
            ? undefined
            : `литературный проход собрал ${humanizedSegments} сцен${topupScenes ? ` (включая ${topupScenes} доборных)` : ""} и остановился — до цели главы не хватило ${CHAPTER_TARGET_WORDS - words} слов`,
        );
        notifyHumanizePass(generated.humanizeReport.depth, generated.text.length, generated.text.length, {
          scoreBefore: generated.humanizeReport.scoreBefore,
          scoreAfter: generated.humanizeReport.scoreAfter,
          gatePassed: generated.humanizeReport.gatePassed,
          passesRun: generated.humanizeReport.passesRun,
          variantTaken: generated.humanizeReport.gatePassed,
          // Раньше сюда дважды передавалась одна и та же длина, и журнал писал
          // «17924 → 17924 символов» — тавтологию, по которой нельзя понять результат
          // прохода (живой журнал 18.09.2026). Теперь итог честный.
          summary: `литературный проход завершён: текст ${generated.text.length} символов, сцен: ${humanizedSegments}${topupScenes ? ` (доборных ${topupScenes})` : ""}${narrationPerson && narrationPerson !== "unknown" ? `, лицо повествования: ${narrationPerson === "first" ? "первое" : "третье"}` : ""}`,
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
      // Почему цикл встал — в журнал: раньше автор видел только «Глава короче цели»
      // и не мог понять, упёрлось ли дело в провайдера, правило застоя или лимит
      // фрагментов (живой журнал 18.09.2026: остановка на 6/10 при 2482/3300 словах).
      let stopReason = "";
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
          if (gained <= 0) {
            stopReason = `модель вернула пустой фрагмент (провайдер ответил, но текста нет) — фрагментов получено: ${chapterSegments}`;
            break;
          }
          text = `${text.trim()}\n\n${next.trim()}`;
          chapterSegments += 1;
          stalls = gained < MIN_CONTINUATION_WORDS ? stalls + 1 : 0;
          if (stalls >= 2) {
            stopReason = `два фрагмента подряд короче ${MIN_CONTINUATION_WORDS} слов — модель отвечает, но сцену не разворачивает`;
            break;
          }
        }
        {
          const finalWords = countGeneratedWords(text);
          if (finalWords < CHAPTER_TARGET_WORDS && !stopReason) {
            stopReason = `исчерпан лимит дописывания (${MAX_CHAPTER_CONTINUATIONS} фрагментов)`;
          }
          notifyChapterVolume(finalWords, chapterSegments, CHAPTER_TARGET_WORDS, finalWords >= CHAPTER_TARGET_WORDS, stopReason || undefined);
        }
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
        // На максимальной глубине принимаем прошедший гейт вариант при росте до 35 %:
        // этот проход добавляет сцены и ритм, и потолок 25 % отбрасывал готовую работу
        // (живой журнал 18.09.2026: «16442 → 16442 символов», проходов 2, gate не пройден).
        // На остальных глубинах потолок прежний — там рост это обвес, а не правка.
        const growthCap = depthConfig.id === "maximum" ? 1.35 : 1.25;
        // Честный отчёт: раньше журнал писал «проход выполнен» и тогда, когда вариант
        // отбрасывался и текст оставался черновиком. Теперь эти случаи различаются.
        let variantTaken = false;
        let growthNote = "";
        // Черновик до прохода: если после всех шагов текст не изменился, журнал должен
        // сказать об этом прямо, а не рапортовать «проход выполнен» (в живом журнале
        // автора 18.09.2026 строка «16442 → 16442 символов» стояла рядом с «gate не пройден»).
        const draftText = text;
        try {
          const polished = await humanizeProseDraft(text, pipelineGenerate, {
            model: credentials.model || "",
            personaBlock: pipelinePersonaBlock,
            humanizeDepth: depth,
          });
          const polishedWords = countGeneratedWords(polished.text);
          // Постпроход иногда разгоняет текст (лишние сравнения/описания — обвес,
          // коррелирующий с ухудшением у внешних детекторов): такой вариант не берём.
          if (polished.text.trim() && polishedWords <= maxAllowedGrowth(beforeWords, growthCap)) {
            text = polished.text;
            variantTaken = true;
          } else if (polished.text.trim()) {
            const percent = Math.round(((polishedWords - beforeWords) / Math.max(1, beforeWords)) * 100);
            growthNote = `вариант на +${percent} % длиннее черновика (${polishedWords} против ${beforeWords} слов при потолке +${Math.round((growthCap - 1) * 100)} %) — не взят, текст остался черновиком`;
          }
          humanizeReport = polished.humanizeReport;
        } catch (touchupError) {
          console.warn("Авто-доводка continue не удалась:", touchupError);
          growthNote = "литературный проход не удался — текст остался черновиком";
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
        if (!growthNote && text === draftText) {
          growthNote = humanizeReport?.gatePassed
            ? "проход вернул текст без изменений — правок не потребовалось"
            : "вариант прохода не принят — текст остался черновиком";
        }
        notifyHumanizePass(depth, beforeChars, text.length, {
          scoreBefore: humanizeReport?.scoreBefore ?? 0,
          scoreAfter: humanizeReport?.scoreAfter ?? 0,
          gatePassed: humanizeReport?.gatePassed ?? false,
          passesRun: humanizeReport?.passesRun ?? 0,
          variantTaken,
          growthNote: growthNote || undefined,
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
