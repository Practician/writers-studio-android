// Унифицированный вызов LLM: Gemini, NVIDIA NIM, Groq, OpenRouter.
//
// Ключи: .env И/ИЛИ apiKeys из UI (localStorage → body запроса).
// UI-ключи живут только в браузере; сервер использует их в AsyncLocalStorage на время запроса.
//
// Env:
//   GEMINI_API_KEY[_2|_3], NVIDIA_API_KEY[_2], GROQ_API_KEY, OPENROUTER_API_KEY
//   LLM_PROVIDER = gemini | nvidia | groq | openrouter | auto
//   NVIDIA_*, GROQ_DEFAULT_MODEL, OPENROUTER_DEFAULT_MODEL, *_FALLBACK_MODELS
//
// auto: Groq → Gemini → OpenRouter → NVIDIA (скорость сначала; NVIDIA часто долгий/таймауты).

import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { GoogleGenAI } from "@google/genai";

export type ProviderPreference = "gemini" | "nvidia" | "groq" | "openrouter" | "auto";
export type LlmProviderId = "gemini" | "nvidia" | "groq" | "openrouter";

/** Ключи из UI (перекрывают/дополняют .env в рамках одного HTTP-запроса). */
export interface RequestLlmCredentials {
  geminiApiKeys?: string[];
  nvidiaApiKeys?: string[];
  groqApiKeys?: string[];
  openrouterApiKeys?: string[];
}

const providerOverrideAls = new AsyncLocalStorage<ProviderPreference>();
const credentialsAls = new AsyncLocalStorage<RequestLlmCredentials>();

// ─── LLM Log Bus (SSE-трансляция логов в UI) ──────────────────────────────
export type LlmLogLevel = "info" | "warn" | "error" | "success";
export interface LlmLogEvent {
  level: LlmLogLevel;
  provider?: string;
  message: string;
  ts: number;
}
/** Глобальный EventEmitter. server.ts подписывается и транслирует в SSE. */
export const llmLogBus = new EventEmitter();
llmLogBus.setMaxListeners(50);

export function llmLog(level: LlmLogLevel, message: string, provider?: string): void {
  console.warn(`[LLM] ${message}`);
  const event: LlmLogEvent = { level, provider, message, ts: Date.now() };
  llmLogBus.emit("log", event);
}


export interface LlmGenerateParams {
  model?: string;
  systemInstruction?: string;
  contents: string;
  temperature?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

export interface LlmGenerateResult {
  text: string;
  provider: LlmProviderId;
  model: string;
  finishReason?: string;
  /** Сколько раз сменили модель/провайдер до успеха (0 = с первого раза). */
  failoverCount?: number;
}

export interface LlmStatus {
  providerPreference: ProviderPreference;
  geminiKeys: number;
  nvidiaConfigured: boolean;
  groqConfigured: boolean;
  openrouterConfigured: boolean;
  nvidiaBaseUrl: string;
  nvidiaDefaultModel: string;
  groqDefaultModel: string;
  openrouterDefaultModel: string;
  nvidiaModelChain: string[];
  groqModelChain: string[];
  openrouterModelChain: string[];
  geminiModelChain: string[];
  activeGeminiKeyIndex: number;
  nvidiaRequestTimeoutMs: number;
  nvidiaCooledModels: string[];
  keysFromEnv: {
    gemini: boolean;
    nvidia: boolean;
    groq: boolean;
    openrouter: boolean;
  };
}

const DEFAULT_NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const DEFAULT_GROQ_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";
// DeepSeek v4 flash — лучшая RU-проза по локальному бенчмарку NVIDIA.
const DEFAULT_NVIDIA_MODEL = "deepseek-ai/deepseek-v4-flash-0731";
// Live humanize benchmark 2026-07: 3.5-flash дал лучшее совпадение локальной
// оценки с внешней; 2.0 и 2.5 в этом аккаунте падали в quota/404.
const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
// openrouter/auto часто платный (402 без credits); free-router — openrouter/free
const DEFAULT_OPENROUTER_MODEL = "openrouter/free";
/** Короткий таймаут: 90 с × 15 моделей = вечность; fail-fast → следующий провайдер. */
const DEFAULT_NVIDIA_TIMEOUT_MS = 40_000;
const DEFAULT_NVIDIA_COOLDOWN_MS = 90_000;
/** Сколько живых моделей NVIDIA пробовать за один вызов (остальные — только если все в cooldown). */
const NVIDIA_MAX_MODEL_ATTEMPTS = 3;
/** Подряд 503 ResourceExhausted → сдаём весь NVIDIA-провайдер, не ждём всю цепочку. */
const NVIDIA_MAX_CAPACITY_FAILS = 2;
/**
 * Groq free on_demand: TPM ~6000 на мелких моделях.
 * Requested ≈ prompt_tokens + max_tokens; держим max_tokens низко.
 */
const GROQ_MAX_OUTPUT_TOKENS = 1536;
const GROQ_MAX_SYSTEM_CHARS = 2800;
const GROQ_MAX_USER_CHARS = 5500;

const BUILTIN_GROQ_FALLBACKS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "deepseek-r1-distill-llama-70b",
  "qwen-2.5-72b",
  "qwen-2.5-coder-32b",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
];

/**
 * Актуальные free-модели OpenRouter (live probe).
 * :free список меняется — 404/402 → dead/cooldown, следующая.
 */
const BUILTIN_OPENROUTER_FALLBACKS = [
  "openrouter/free",
  "google/gemma-2-9b-it:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "deepseek/deepseek-r1:free",
  "microsoft/phi-3-medium-128k-instruct:free",
];

/**
 * Встроенная ротация NVIDIA для русской прозы (из live-каталога /v1/models).
 * Порядок: сильный RU/мультиязык → быстрые Mistral → Llama → лёгкий запас.
 * Не включаем модели, которые на probe отвечали по-английски (nemotron-3-*) или часто 404.
 */
const BUILTIN_NVIDIA_FALLBACKS = [
  // Tier A — лучшие для RU (DeepSeek / GLM / MiniMax / StepFun)
  "deepseek-ai/deepseek-v4-flash-0731",
  "z-ai/glm-5.2",
  "minimaxai/minimax-m3",
  "stepfun-ai/step-3.7-flash",
  "qwen/qwen3-235b-a22b-instruct-2507",
  "moonshotai/kimi-k2.6",
  // Tier B — быстрые, стабильно отдают русский (Mistral family)
  "mistralai/mistral-nemotron",
  "mistralai/mistral-large-2-instruct",
  "mistralai/mistral-large",
  // Tier C — Llama / Nemotron-super (RU ок)
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/llama-3.3-nemotron-super-49b-v1",
  "meta/llama-3.1-70b-instruct",
  "google/gemma-4-31b-it",
  "google/gemma-3-12b-it",
];

/** Временный cooldown: model → timestamp до которого не трогаем. */
const nvidiaModelCooldownUntil = new Map<string, number>();
/** Модели с 404/410 — не долбим до перезапуска процесса. */
const nvidiaModelDead = new Set<string>();

/** Кэш заморозки API-ключей: key → timestamp до которого ключ в cooldown. */
const apiKeyCooldownUntil = new Map<string, number>();

export function markKeyCooldown(key: string, ms: number, reason: string): void {
  if (!key) return;
  const until = Date.now() + ms;
  apiKeyCooldownUntil.set(key, until);
  console.warn(
    `[LLM Key Cooldown] Ключ ...${key.slice(-6)} заморожен на ${Math.round(ms / 1000)}s (${reason})`,
  );
}

export function isKeyOnCooldown(key: string): boolean {
  if (!key) return false;
  const until = apiKeyCooldownUntil.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    apiKeyCooldownUntil.delete(key);
    return false;
  }
  return true;
}

/** Порядок по актуальной доступности; uniquePreserve уберёт повтор primary. */
const BUILTIN_GEMINI_FALLBACKS = [
  "gemini-flash-latest",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash-lite",
];

const DEFAULT_GEMINI_TIMEOUT_MS = 45_000;

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,;\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function abortError(): Error {
  const error = new Error("Aborted by user");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function combineAbortSignals(externalSignal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!externalSignal) return timeoutSignal;
  return AbortSignal.any([externalSignal, timeoutSignal]);
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function uniquePreserve(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function keysFromEnvList(names: string[]): string[] {
  const raw = names.map((n) => process.env[n]).filter(Boolean).join(",");
  return uniquePreserve(raw.split(",").map((key) => key.trim()).filter(Boolean));
}

function mergeKeys(fromRequest: string[] | undefined, fromEnv: string[]): string[] {
  // UI-ключи первыми — пользователь явно задал в приложении.
  return uniquePreserve([...(fromRequest || []), ...fromEnv]);
}

export function collectGeminiKeys(): string[] {
  const fromEnv = keysFromEnvList(["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3"]);
  return mergeKeys(credentialsAls.getStore()?.geminiApiKeys, fromEnv);
}

export function collectNvidiaKeys(): string[] {
  const fromEnv = keysFromEnvList(["NVIDIA_API_KEY", "NVIDIA_API_KEY_2"]);
  return mergeKeys(credentialsAls.getStore()?.nvidiaApiKeys, fromEnv);
}

export function collectGroqKeys(): string[] {
  const fromEnv = keysFromEnvList(["GROQ_API_KEY", "GROQ_API_KEY_2"]);
  return mergeKeys(credentialsAls.getStore()?.groqApiKeys, fromEnv);
}

export function collectOpenrouterKeys(): string[] {
  return [];
}

/** Разобрать apiKeys из body UI (строка или { gemini, nvidia, groq, openrouter }). */
export function parseRequestCredentials(raw: unknown): RequestLlmCredentials | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const pick = (value: unknown): string[] => {
    if (typeof value === "string") {
      return value.split(/[,;\n]+/u).map((s) => s.trim()).filter(Boolean);
    }
    if (Array.isArray(value)) {
      return value.map((v) => String(v || "").trim()).filter(Boolean);
    }
    return [];
  };
  const creds: RequestLlmCredentials = {
    geminiApiKeys: pick(obj.gemini ?? obj.GEMINI_API_KEY ?? obj.geminiApiKey),
    nvidiaApiKeys: pick(obj.nvidia ?? obj.NVIDIA_API_KEY ?? obj.nvidiaApiKey),
    groqApiKeys: pick(obj.groq ?? obj.GROQ_API_KEY ?? obj.groqApiKey),
    openrouterApiKeys: pick(obj.openrouter ?? obj.OPENROUTER_API_KEY ?? obj.openrouterApiKey),
  };
  const any =
    (creds.geminiApiKeys?.length || 0)
    + (creds.nvidiaApiKeys?.length || 0)
    + (creds.groqApiKeys?.length || 0)
    + (creds.openrouterApiKeys?.length || 0);
  return any > 0 ? creds : null;
}

export function nvidiaBaseUrl(): string {
  return env("NVIDIA_BASE_URL", DEFAULT_NVIDIA_BASE).replace(/\/$/, "");
}

export function nvidiaDefaultModel(): string {
  return env("NVIDIA_DEFAULT_MODEL", DEFAULT_NVIDIA_MODEL);
}

export function groqDefaultModel(): string {
  return env("GROQ_DEFAULT_MODEL", DEFAULT_GROQ_MODEL);
}

export function openrouterDefaultModel(): string {
  return env("OPENROUTER_DEFAULT_MODEL", DEFAULT_OPENROUTER_MODEL);
}

export function groqBaseUrl(): string {
  return env("GROQ_BASE_URL", DEFAULT_GROQ_BASE).replace(/\/$/, "");
}

export function openrouterBaseUrl(): string {
  return env("OPENROUTER_BASE_URL", DEFAULT_OPENROUTER_BASE).replace(/\/$/, "");
}

export function nvidiaRequestTimeoutMs(): number {
  const raw = Number(env("NVIDIA_REQUEST_TIMEOUT_MS", String(DEFAULT_NVIDIA_TIMEOUT_MS)));
  if (!Number.isFinite(raw) || raw < 5_000) return DEFAULT_NVIDIA_TIMEOUT_MS;
  return Math.min(Math.floor(raw), 600_000);
}

export function geminiRequestTimeoutMs(): number {
  const raw = Number(env("GEMINI_REQUEST_TIMEOUT_MS", String(DEFAULT_GEMINI_TIMEOUT_MS)));
  if (!Number.isFinite(raw) || raw < 5_000) return DEFAULT_GEMINI_TIMEOUT_MS;
  return Math.min(Math.floor(raw), 300_000);
}

export function nvidiaCooldownMs(): number {
  const raw = Number(env("NVIDIA_COOLDOWN_MS", String(DEFAULT_NVIDIA_COOLDOWN_MS)));
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_NVIDIA_COOLDOWN_MS;
  return Math.min(Math.floor(raw), 600_000);
}

/** Цепочка NVIDIA-моделей: requested → DEFAULT → FALLBACK_MODELS → встроенный список. */
export function nvidiaModelChain(preferred?: string): string[] {
  const primary = (preferred || "").trim().replace(/^nvidia:/i, "");
  const fromEnv = splitList(env("NVIDIA_FALLBACK_MODELS"));
  const chain = [
    primary && !primary.toLowerCase().startsWith("gemini") && !primary.toLowerCase().startsWith("groq:")
      ? primary
      : "",
    nvidiaDefaultModel(),
    ...fromEnv,
    ...BUILTIN_NVIDIA_FALLBACKS,
  ].filter(Boolean);
  return uniquePreserve(chain);
}

export function groqModelChain(preferred?: string): string[] {
  const primary = (preferred || "").trim().replace(/^groq:/i, "");
  const fromEnv = splitList(env("GROQ_FALLBACK_MODELS"));
  const chain = [
    primary && !primary.toLowerCase().startsWith("gemini") ? primary : "",
    groqDefaultModel(),
    ...fromEnv,
    ...BUILTIN_GROQ_FALLBACKS,
  ].filter(Boolean);
  return uniquePreserve(chain);
}

export function openrouterModelChain(preferred?: string): string[] {
  const primary = (preferred || "").trim().replace(/^openrouter:/i, "");
  const fromEnv = splitList(env("OPENROUTER_FALLBACK_MODELS"));
  const chain = [
    primary && !primary.toLowerCase().startsWith("gemini") ? primary : "",
    openrouterDefaultModel(),
    ...fromEnv,
    ...BUILTIN_OPENROUTER_FALLBACKS,
  ].filter(Boolean);
  return uniquePreserve(chain);
}

export function markNvidiaModelCooldown(model: string, reason: string, ms?: number): void {
  const until = Date.now() + (ms ?? nvidiaCooldownMs());
  nvidiaModelCooldownUntil.set(model, until);
  console.warn(
    `NVIDIA cooldown «${model}» ${Math.round((until - Date.now()) / 1000)}s (${reason})`,
  );
}

export function markNvidiaModelDead(model: string, reason: string): void {
  nvidiaModelDead.add(model);
  nvidiaModelCooldownUntil.delete(model);
  console.warn(`NVIDIA dead «${model}» — skip until restart (${reason})`);
}

export function isNvidiaModelOnCooldown(model: string): boolean {
  if (nvidiaModelDead.has(model)) return true;
  const until = nvidiaModelCooldownUntil.get(model);
  if (!until) return false;
  if (Date.now() >= until) {
    nvidiaModelCooldownUntil.delete(model);
    return false;
  }
  return true;
}

export function cooledNvidiaModels(): string[] {
  const now = Date.now();
  const out: string[] = [];
  for (const model of nvidiaModelDead) out.push(`${model} (dead)`);
  for (const [model, until] of nvidiaModelCooldownUntil) {
    if (until > now) out.push(`${model} (${Math.round((until - now) / 1000)}s)`);
  }
  return out;
}

/** Цепочка Gemini-моделей. */
export function geminiModelChain(preferred?: string): string[] {
  const primary = (preferred || "").trim();
  const fromEnv = splitList(env("GEMINI_FALLBACK_MODELS"));
  const chain = [
    primary && primary.toLowerCase().startsWith("gemini") ? primary : "",
    DEFAULT_GEMINI_MODEL,
    ...fromEnv,
    ...BUILTIN_GEMINI_FALLBACKS,
  ].filter(Boolean);
  return uniquePreserve(chain);
}

export function normalizeProviderPreference(value: unknown): ProviderPreference | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "gemini"
    || normalized === "nvidia"
    || normalized === "groq"
    || normalized === "openrouter"
    || normalized === "auto"
  ) {
    return normalized;
  }
  if (normalized === "both" || normalized === "any" || normalized === "all") return "auto";
  if (normalized === "google" || normalized === "gem") return "gemini";
  if (normalized === "nim" || normalized === "nv") return "nvidia";
  if (normalized === "or" || normalized === "open-router") return "openrouter";
  return null;
}

/** LLM_PROVIDER из env; при запросе из UI — override. */
export function providerPreference(): ProviderPreference {
  const fromRequest = providerOverrideAls.getStore();
  if (fromRequest) return fromRequest;
  const value = env("LLM_PROVIDER", "auto").toLowerCase();
  if (value === "gemini" || value === "nvidia" || value === "groq" || value === "openrouter") {
    return value;
  }
  return "auto";
}

/** @deprecated используйте runWithLlmRequestContext */
export function runWithProviderPreference<T>(
  preference: ProviderPreference | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithLlmRequestContext({ preference }, fn);
}

/** Провайдер + UI-ключи на время HTTP-запроса. */
export function runWithLlmRequestContext<T>(
  options: {
    preference?: ProviderPreference | null;
    credentials?: RequestLlmCredentials | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const runPref = () => {
    if (!options.preference) return fn();
    return providerOverrideAls.run(options.preference, fn);
  };
  if (!options.credentials) return runPref();
  return credentialsAls.run(options.credentials, runPref);
}

export function defaultModelForProvider(preference?: ProviderPreference): string {
  const pref = preference || providerPreference();
  if (pref === "nvidia") return nvidiaDefaultModel();
  if (pref === "groq") return groqDefaultModel();
  if (pref === "openrouter") return openrouterDefaultModel();
  if (pref === "gemini") return DEFAULT_GEMINI_MODEL;
  // auto: тот же приоритет, что resolveProvider
  if (collectGeminiKeys().length > 0) return DEFAULT_GEMINI_MODEL;
  if (collectGroqKeys().length > 0) return groqDefaultModel();
  if (collectOpenrouterKeys().length > 0) return openrouterDefaultModel();
  if (collectNvidiaKeys().length > 0) return nvidiaDefaultModel();
  return DEFAULT_GROQ_MODEL;
}

export function resolveSelectedModel(
  requested: string | undefined,
  preference?: ProviderPreference,
): string {
  const pref = preference || providerPreference();
  const raw = (requested || "").trim();

  if (pref === "nvidia") {
    if (!raw || raw.toLowerCase().startsWith("gemini") || raw.toLowerCase().startsWith("groq:")) {
      return nvidiaDefaultModel();
    }
    return raw.replace(/^nvidia:/i, "");
  }
  if (pref === "groq") {
    if (!raw || raw.toLowerCase().startsWith("gemini") || raw.includes("/")) {
      // openrouter/nvidia style — не для groq
      if (raw && !raw.includes("/") && !raw.toLowerCase().startsWith("gemini")) {
        return raw.replace(/^groq:/i, "");
      }
      return groqDefaultModel();
    }
    return raw.replace(/^groq:/i, "");
  }
  if (pref === "openrouter") {
    if (!raw || raw.toLowerCase().startsWith("gemini")) return openrouterDefaultModel();
    return raw.replace(/^openrouter:/i, "");
  }
  if (pref === "gemini") {
    if (!raw || isNvidiaModelName(raw) || isGroqModelName(raw) || isOpenRouterModelName(raw)) {
      return DEFAULT_GEMINI_MODEL;
    }
    return raw;
  }
  // auto: НЕ цепляемся за deepseek/qwen из старого UI — иначе снова 60 с на NVIDIA.
  // Имя модели учитываем только для быстрых/явных семейств; иначе — приоритет ключей.
  if (!raw) return defaultModelForProvider("auto");
  if (isGroqModelName(raw) && collectGroqKeys().length > 0) {
    return raw.replace(/^groq:/i, "");
  }
  if (raw.toLowerCase().startsWith("gemini") && collectGeminiKeys().length > 0) {
    return raw;
  }
  if (isOpenRouterModelName(raw) && collectOpenrouterKeys().length > 0
    && !isNvidiaModelName(raw)) {
    return raw.replace(/^openrouter:/i, "");
  }
  return defaultModelForProvider("auto");
}

export function getLlmStatus(): LlmStatus {
  return {
    providerPreference: providerPreference(),
    geminiKeys: collectGeminiKeys().length,
    nvidiaConfigured: collectNvidiaKeys().length > 0,
    groqConfigured: collectGroqKeys().length > 0,
    openrouterConfigured: collectOpenrouterKeys().length > 0,
    nvidiaBaseUrl: nvidiaBaseUrl(),
    nvidiaDefaultModel: nvidiaDefaultModel(),
    groqDefaultModel: groqDefaultModel(),
    openrouterDefaultModel: openrouterDefaultModel(),
    nvidiaModelChain: nvidiaModelChain(),
    groqModelChain: groqModelChain(),
    openrouterModelChain: openrouterModelChain(),
    geminiModelChain: geminiModelChain(),
    activeGeminiKeyIndex: activeGeminiKeyIndex,
    nvidiaRequestTimeoutMs: nvidiaRequestTimeoutMs(),
    nvidiaCooledModels: cooledNvidiaModels(),
    keysFromEnv: {
      gemini: keysFromEnvList(["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3"]).length > 0,
      nvidia: keysFromEnvList(["NVIDIA_API_KEY", "NVIDIA_API_KEY_2"]).length > 0,
      groq: keysFromEnvList(["GROQ_API_KEY", "GROQ_API_KEY_2"]).length > 0,
      openrouter: keysFromEnvList(["OPENROUTER_API_KEY", "OPENROUTER_API_KEY_2"]).length > 0,
    },
  };
}

// --- Gemini client (rotation) ---

let geminiClient: GoogleGenAI | null = null;
let activeGeminiKeyIndex = 0;

export function getGeminiClient(): GoogleGenAI {
  const keys = collectGeminiKeys();
  if (!keys.length) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  const apiKey = keys[Math.min(activeGeminiKeyIndex, keys.length - 1)];
  // UI-ключи на запрос — не кэшируем клиент между разными ключами.
  if (credentialsAls.getStore()) {
    return new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "writers-studio" } },
    });
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "writers-studio" } },
    });
  }
  return geminiClient;
}

export function rotateGeminiKey(): GoogleGenAI | null {
  const keys = collectGeminiKeys();
  if (activeGeminiKeyIndex + 1 >= keys.length) return null;
  activeGeminiKeyIndex += 1;
  geminiClient = null;
  console.warn(
    `Ключ Gemini №${activeGeminiKeyIndex} исчерпал квоту — переключаюсь на резервный №${activeGeminiKeyIndex + 1} из ${keys.length}.`,
  );
  return getGeminiClient();
}

/**
 * Извлекает retryDelay (в секундах) из ответа Google 429.
 * Google возвращает details[].@type=RetryInfo с retryDelay: "43s" или "86400s".
 * Если retryDelay >= 3600s → суточная квота. Если < 3600s → минутный RPM.
 */
export function extractGeminiRetryDelaySeconds(error: unknown): number | null {
  // Поле, которое мы сами проставляем в callGeminiOnce после парсинга тела
  if (typeof (error as any)?.retryDelaySec === "number") {
    return (error as any).retryDelaySec;
  }
  const message = String((error as any)?.message ?? error ?? "");
  // Из текста сообщения: "retry in 43.5s" или "retry in 43s"
  const m = message.match(/retry in ([\d\.]+)s/i);
  if (m) return parseFloat(m[1]);
  // Из тела HTTP-ответа (если error.body присутствует)
  try {
    const body = (error as any)?.body;
    if (typeof body === "string") {
      const parsed = JSON.parse(body);
      for (const d of (parsed?.error?.details ?? [])) {
        if (d?.["@type"]?.includes("RetryInfo") && d?.retryDelay) {
          return parseFloat(String(d.retryDelay).replace(/[^\d.]/g, ""));
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function isDailyQuotaExhausted(error: unknown): boolean {
  const retryDelay = extractGeminiRetryDelaySeconds(error);
  // Если retryDelay присутствует и < 600 секунд → это RPM-лимит, НЕ дневная квота
  if (retryDelay !== null) return retryDelay >= 600;

  const message = String((error as any)?.message ?? error ?? "");
  if (/exceeded.*quota|quota.*exceeded|billing.*details|out of.*credits/i.test(message)) {
    return true;
  }
  
  // Fallback: если retryDelay неизвестен — смотрим только на PerDay без PerMinute
  return message.includes("GenerateRequestsPerDay") && !message.includes("PerMinute");
}

export function isGroqModelName(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("groq:")) return true;
  // Groq id без слэша: llama-3.3-70b-versatile, gemma2-9b-it, mixtral-...
  if (m.startsWith("gemini") || m.includes("/")) return false;
  return /^(llama-|gemma|mixtral|whisper|qwen|deepseek)/i.test(m);
}

export function isOpenRouterModelName(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("openrouter:") || m.startsWith("openrouter/")) return true;
  if (m.includes(":free") || m.includes(":nitro") || m.includes(":floor")) return true;
  // org/model типичный для OpenRouter, но пересекается с NVIDIA — эвристика слабая
  if (/^(meta-llama|google\/gemma|qwen\/|mistralai\/|deepseek\/|microsoft\/|anthropic\/|openai\/)/i.test(m)) {
    return true;
  }
  return false;
}

export function isNvidiaModelName(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("nvidia:")) return true;
  if (m.startsWith("gemini") || m.startsWith("groq:")) return false;
  if (isOpenRouterModelName(model) || isGroqModelName(model)) return false;
  if (m.includes("/")) return true;
  return false;
}

export function normalizeModelName(model: string | undefined, provider: LlmProviderId): string {
  const raw = (model || "").trim();
  if (provider === "nvidia") {
    if (!raw || raw.startsWith("gemini")) return nvidiaDefaultModel();
    return raw.replace(/^nvidia:/i, "");
  }
  if (provider === "groq") {
    if (!raw || raw.startsWith("gemini") || raw.includes("/")) return groqDefaultModel();
    return raw.replace(/^groq:/i, "");
  }
  if (provider === "openrouter") {
    if (!raw || raw.startsWith("gemini")) return openrouterDefaultModel();
    return raw.replace(/^openrouter:/i, "");
  }
  if (!raw || isNvidiaModelName(raw) || isGroqModelName(raw) || isOpenRouterModelName(raw)) {
    return DEFAULT_GEMINI_MODEL;
  }
  return raw;
}

function assertHasKeys(provider: LlmProviderId): void {
  if (provider === "gemini" && !collectGeminiKeys().length) {
    throw new Error("Gemini: нет ключа. Вставьте в Настройки ИИ или GEMINI_API_KEY в .env");
  }
  if (provider === "nvidia" && !collectNvidiaKeys().length) {
    throw new Error("NVIDIA: нет ключа. Вставьте в Настройки ИИ или NVIDIA_API_KEY в .env");
  }
  if (provider === "groq" && !collectGroqKeys().length) {
    throw new Error("Groq: нет ключа. Вставьте в Настройки ИИ (console.groq.com) или GROQ_API_KEY в .env");
  }
  if (provider === "openrouter" && !collectOpenrouterKeys().length) {
    throw new Error("OpenRouter: нет ключа. Вставьте в Настройки ИИ (openrouter.ai) или OPENROUTER_API_KEY в .env");
  }
}

export function resolveProvider(model?: string): LlmProviderId {
  const pref = providerPreference();
  const hasGemini = collectGeminiKeys().length > 0;
  const hasNvidia = collectNvidiaKeys().length > 0;
  const hasGroq = collectGroqKeys().length > 0;
  const hasOr = collectOpenrouterKeys().length > 0;
  const explicit = model?.trim() || "";

  if (pref === "gemini" || pref === "nvidia" || pref === "groq" || pref === "openrouter") {
    assertHasKeys(pref);
    return pref;
  }

  // auto: имя модели НЕ должно перетягивать на NVIDIA (deepseek/*), пока есть Gemini/Groq.
  // Иначе UI/кэш шлёт deepseek-v4-flash и снова жжёт 60 с × N моделей.
  if (explicit) {
    if (isGroqModelName(explicit) && hasGroq) return "groq";
    if (explicit.toLowerCase().startsWith("gemini") && hasGemini) return "gemini";
    if (isOpenRouterModelName(explicit) && hasOr && !isNvidiaModelName(explicit)) return "openrouter";
    // nvidia-имена (org/model) игнорируем, если есть быстрый провайдер
  }

  // auto: качество прозы и согласие двух детекторов важнее минимальной задержки.
  if (hasGemini) return "gemini";
  if (hasGroq) return "groq";
  if (hasOr) return "openrouter";
  if (hasNvidia) return "nvidia";
  throw new Error(
    "Не задан ни один API-ключ. Откройте «Настройки ИИ» в шапке или пропишите ключи в .env "
    + "(GEMINI / NVIDIA / GROQ / OPENROUTER).",
  );
}

/** Ошибки, при которых имеет смысл сменить модель NVIDIA. */
export function isNvidiaModelFailoverError(error: unknown): boolean {
  const status = (error as any)?.status ?? (error as any)?.statusCode;
  const message = String((error as any)?.message ?? error ?? "");
  if (status === 401 || status === 403) return false; // ключ неверный — модели не помогут
  if ([429, 500, 502, 503, 504, 408, 404, 410, 402, 413, 400].includes(Number(status))) return true;
  // fetch failed / network ошибки — тоже failover
  if (/fetch failed|network|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|terminated/i.test(message)) return true;
  return /unavailable|not found|does not exist|capacity|rate.?limit|overloaded|timeout|timed out|abort|RESOURCE_EXHAUSTED|no healthy|model.*(disabled|retired|invalid|decommissioned)|quota|Gone|Insufficient credits|no endpoints|Request too large|too large for model/i.test(message);
}

function schemaHint(schema: unknown): string {
  if (!schema) return "";
  try {
    const json = JSON.stringify(schema, (_key, value) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null) {
        return value;
      }
      if (Array.isArray(value)) return value;
      if (typeof value === "object") return value;
      return String(value);
    });
    if (json && json !== "{}") {
      return `\n\nВерни ТОЛЬКО валидный JSON (без markdown-оградки). Ориентир по структуре:\n${json.slice(0, 6000)}`;
    }
  } catch {
    // ignore
  }
  return "\n\nВерни ТОЛЬКО валидный JSON без markdown-оградки и без пояснений.";
}

async function callNvidiaOnce(
  model: string,
  key: string,
  params: LlmGenerateParams,
  withJsonFormat: boolean,
): Promise<LlmGenerateResult> {
  const wantsJson = params.responseMimeType === "application/json" || Boolean(params.responseSchema);
  let userContent = params.contents;
  if (wantsJson) userContent += schemaHint(params.responseSchema);

  // Fail-fast: длинные таймауты (60–90 с) × цепочка моделей = минуты «тупняка».
  const baseTimeout = nvidiaRequestTimeoutMs();
  const maxTok = params.maxOutputTokens ?? 8192;
  const timeoutMs = wantsJson
    ? Math.min(baseTimeout, 25_000)
    : Math.min(baseTimeout, 40_000);

  const body: Record<string, unknown> = {
    model,
    messages: [
      ...(params.systemInstruction
        ? [{ role: "system", content: params.systemInstruction }]
        : []),
      { role: "user", content: userContent },
    ],
    temperature: params.temperature ?? 0.7,
    max_tokens: maxTok,
    stream: false,
  };
  if (wantsJson && withJsonFormat) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestSignal = combineAbortSignals(params.abortSignal, controller.signal);
  let response: Response;
  try {
    response = await fetch(`${nvidiaBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  } catch (error: any) {
    clearTimeout(timer);
    if (params.abortSignal?.aborted) throw abortError();
    if (error?.name === "AbortError" || /aborted|timeout/i.test(String(error?.message || ""))) {
      const err = new Error(`NVIDIA API timeout after ${timeoutMs}ms (${model})`);
      (err as any).status = 408;
      (err as any).body = "timeout";
      throw err;
    }
    const err = new Error(`NVIDIA network: ${String(error?.message || error).slice(0, 200)}`);
    (err as any).status = 503;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  if (!response.ok) {
    const err = new Error(`NVIDIA API ${response.status}: ${raw.slice(0, 500)}`);
    (err as any).status = response.status;
    (err as any).body = raw;
    throw err;
  }

  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> }; finish_reason?: string }>;
  };
  const content = data.choices?.[0]?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content.map((part) => (typeof part === "string" ? part : part.text || "")).join("");
  }
  text = text.trim();
  if (!text) throw new Error("NVIDIA API: пустой ответ");
  text = text.replace(/^```(?:json|JSON)?\s*/u, "").replace(/\s*```$/u, "").trim();
  return {
    text,
    provider: "nvidia",
    model,
    finishReason: data.choices?.[0]?.finish_reason,
  };
}

/**
 * NVIDIA: перебор моделей (DeepSeek → Qwen → Mistral → Llama…) и ключей.
 * 404/410 — модель «мёртвая» до рестарта; 503/timeout — cooldown, чтобы не ждать по кругу.
 */
async function generateViaNvidia(params: LlmGenerateParams): Promise<LlmGenerateResult> {
  const allKeys = collectNvidiaKeys();
  const keys = allKeys.filter((k) => !isKeyOnCooldown(k));
  if (!keys.length) {
    if (allKeys.length > 0) throw new Error("NVIDIA: все API-ключи находятся в cooldown.");
    throw new Error("NVIDIA_API_KEY is not configured.");
  }

  const models = nvidiaModelChain(params.model);
  const wantsJson = params.responseMimeType === "application/json" || Boolean(params.responseSchema);
  let lastError: any = null;
  let attempts = 0;
  let skippedCooldown = 0;
  let liveAttempts = 0;
  let capacityFails = 0;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    if (isNvidiaModelOnCooldown(model)) {
      skippedCooldown += 1;
      continue;
    }
    if (liveAttempts >= NVIDIA_MAX_MODEL_ATTEMPTS) {
      console.warn(
        `NVIDIA: лимит ${NVIDIA_MAX_MODEL_ATTEMPTS} моделей за вызов — сдаём провайдер (дальше auto → Groq/Gemini).`,
      );
      break;
    }
    liveAttempts += 1;

    keyLoop: for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex];
      if (isKeyOnCooldown(key)) continue;

      const jsonModes = wantsJson ? [true, false] : [false];
      for (const withJson of jsonModes) {
        throwIfAborted(params.abortSignal);
        attempts += 1;
        try {
          const result = await callNvidiaOnce(model, key, params, withJson);
          if (modelIndex > 0 || keyIndex > 0 || skippedCooldown > 0) {
            console.warn(`NVIDIA: успех на модели «${model}» (попытка #${attempts}, failover с предыдущих).`);
          }
          return { ...result, failoverCount: Math.max(0, modelIndex + keyIndex + skippedCooldown) };
        } catch (error: any) {
          if (params.abortSignal?.aborted) throw abortError();
          lastError = error;
          const status = error?.status ?? error?.statusCode;
          const body = String(error?.body || error?.message || "");

          // json_object не поддержан — пробуем без него на той же модели
          if (withJson && (status === 400 || /response_format|json_object/i.test(body))) {
            continue;
          }

          // Неверный ключ — замораживаем ключ и переходим к следующему
          if (status === 401 || status === 403) {
            llmLog("error", `NVIDIA key #${keyIndex + 1} отклонён (${status}) → cooldown 24h`, "nvidia");
            markKeyCooldown(key, 86_400_000, "nvidia-invalid-key");
            break; // → следующий ключ
          }

          // Модель недоступна / квота / 5xx / timeout → cooldown + следующая
          if (isNvidiaModelFailoverError(error)) {
            llmLog("warn", `NVIDIA «${model}» недоступна (${status ?? "err"}) → следующая модель`, "nvidia");
            console.warn(
              `NVIDIA модель «${model}» недоступна (${status ?? "err"}): ${String(error?.message || "").slice(0, 120)} → следующая модель…`,
            );
            if (status === 404 || status === 410 || /not found|does not exist|invalid model|Gone/i.test(body)) {
              markNvidiaModelDead(model, String(status || "not-found"));
              break keyLoop; // модель мёртвая → пропускаем все ключи, переходим к следующей модели
            }
            if (status === 429 && keyIndex + 1 < keys.length) {
              llmLog("warn", `NVIDIA key #${keyIndex + 1} rate-limit → cooldown 60s`, "nvidia");
              markKeyCooldown(key, 60_000, "nvidia-rate-limit");
              break; // → следующий ключ
            }
            if (status === 503 || status === 429 || status === 408 || status === 502 || status === 504
              || /ResourceExhausted|capacity|timeout|overloaded/i.test(body + String(error?.message || ""))) {
              markNvidiaModelCooldown(model, String(status || "busy"));
            }
            if (status === 503 || /ResourceExhausted|Worker local total request limit|capacity/i.test(body)) {
              capacityFails += 1;
              if (capacityFails >= NVIDIA_MAX_CAPACITY_FAILS) {
                const err = new Error(
                  `NVIDIA API: capacity exhausted (${capacityFails}×) — переключаемся на другой провайдер`,
                );
                (err as any).status = 503;
                (err as any).nvidiaChainTried = models.slice(0, modelIndex + 1);
                throw err;
              }
            }
            // Сетевая ошибка (fetch failed) — не зависаем, сразу выходим
            if (!status && /fetch failed|network|ECONN|ETIMED|ENOTFOUND|terminated/i.test(String(error?.message || ""))) {
              capacityFails += 1;
              if (capacityFails >= 1) { // при первой же сетевой ошибке — уходим с NVIDIA
                const netErr = new Error(`NVIDIA API: network error — переключаемся на другой провайдер`);
                (netErr as any).status = 503;
                (netErr as any).nvidiaChainTried = models.slice(0, modelIndex + 1);
                throw netErr;
              }
            }
            break keyLoop; // модель перегружена → следующая модель
          }

          // Неизвестная ошибка — cooldown короткий + следующая модель
          console.warn(`NVIDIA «${model}» ошибка, пробуем дальше:`, String(error?.message || error).slice(0, 160));
          markNvidiaModelCooldown(model, "error", Math.min(30_000, nvidiaCooldownMs()));
          break keyLoop; // → следующая модель
        }
      }
    }
  }

  const err = lastError || new Error(
    skippedCooldown > 0 && attempts === 0
      ? "NVIDIA API: все модели в cooldown/dead — подождите или смените NVIDIA_DEFAULT_MODEL"
      : "NVIDIA API: все модели и ключи недоступны",
  );
  (err as any).nvidiaChainTried = models;
  throw err;
}

/** OpenAI-compatible: Groq / OpenRouter (и при желании другие). */
async function callOpenAiCompatOnce(
  provider: "groq" | "openrouter",
  baseUrl: string,
  model: string,
  key: string,
  params: LlmGenerateParams,
  withJsonFormat: boolean,
  extraHeaders?: Record<string, string>,
): Promise<LlmGenerateResult> {
  const wantsJson = params.responseMimeType === "application/json" || Boolean(params.responseSchema);
  let userContent = params.contents;
  if (wantsJson) userContent += schemaHint(params.responseSchema);

  const baseTimeout = nvidiaRequestTimeoutMs();
  let maxTok = params.maxOutputTokens ?? 8192;
  if (provider === "groq") {
    maxTok = Math.min(maxTok, GROQ_MAX_OUTPUT_TOKENS);
  }
  // Groq free TPM: prompt + max_tokens ≤ ~6000
  let systemContent = params.systemInstruction || "";
  if (provider === "groq") {
    if (systemContent.length > GROQ_MAX_SYSTEM_CHARS) {
      systemContent = systemContent.slice(0, GROQ_MAX_SYSTEM_CHARS) + "\n…";
    }
    if (userContent.length > GROQ_MAX_USER_CHARS) {
      userContent = userContent.slice(0, GROQ_MAX_USER_CHARS)
        + "\n…\n[укорочено под лимит Groq free TPM; пиши полную сцену на русском ≥350 слов]";
    }
  }
  // Groq: 25s (rate-limit частый, быстро переходим); OpenRouter: 30s (:free модели медленные но не 60s); остальные: 60s+
  const timeoutMs = provider === "groq"
    ? Math.min(baseTimeout, 25_000)
    : provider === "openrouter"
      ? Math.min(baseTimeout, 30_000)
      : wantsJson
        ? Math.min(baseTimeout, 45_000)
        : Math.min(Math.max(baseTimeout, 60_000), 60_000 + Math.floor(maxTok / 8));

  const body: Record<string, unknown> = {
    model,
    messages: [
      ...(systemContent
        ? [{ role: "system", content: systemContent }]
        : []),
      { role: "user", content: userContent },
    ],
    temperature: params.temperature ?? 0.7,
    max_tokens: maxTok,
    stream: false,
  };
  if (wantsJson && withJsonFormat) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestSignal = combineAbortSignals(params.abortSignal, controller.signal);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(extraHeaders || {}),
      },
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  } catch (error: any) {
    clearTimeout(timer);
    if (params.abortSignal?.aborted) throw abortError();
    if (error?.name === "AbortError" || /aborted|timeout/i.test(String(error?.message || ""))) {
      const err = new Error(`${provider} timeout after ${timeoutMs}ms (${model})`);
      (err as any).status = 408;
      throw err;
    }
    const err = new Error(`${provider} network: ${String(error?.message || error).slice(0, 200)}`);
    (err as any).status = 503;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  if (!response.ok) {
    const err = new Error(`${provider} API ${response.status}: ${raw.slice(0, 500)}`);
    (err as any).status = response.status;
    (err as any).body = raw;
    throw err;
  }

  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> }; finish_reason?: string }>;
  };
  const content = data.choices?.[0]?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content.map((part) => (typeof part === "string" ? part : part.text || "")).join("");
  }
  text = text.trim();
  if (!text) throw new Error(`${provider} API: пустой ответ`);
  text = text.replace(/^```(?:json|JSON)?\s*/u, "").replace(/\s*```$/u, "").trim();
  return {
    text,
    provider,
    model,
    finishReason: data.choices?.[0]?.finish_reason,
  };
}

async function generateViaOpenAiChain(
  provider: "groq" | "openrouter",
  params: LlmGenerateParams,
): Promise<LlmGenerateResult> {
  const allKeys = provider === "groq" ? collectGroqKeys() : collectOpenrouterKeys();
  const keys = allKeys.filter((k) => !isKeyOnCooldown(k));
  if (!keys.length) {
    if (allKeys.length > 0) throw new Error(`${provider}: все API-ключи находятся в cooldown.`);
    throw new Error(
      provider === "groq"
        ? "GROQ_API_KEY is not configured."
        : "OPENROUTER_API_KEY is not configured.",
    );
  }

  const models = provider === "groq" ? groqModelChain(params.model) : openrouterModelChain(params.model);
  const baseUrl = provider === "groq" ? groqBaseUrl() : openrouterBaseUrl();
  const extraHeaders = provider === "openrouter"
    ? {
      "HTTP-Referer": env("APP_URL", "http://localhost:3000"),
      "X-Title": "Writer's Studio",
    }
    : undefined;

  const wantsJson = params.responseMimeType === "application/json" || Boolean(params.responseSchema);
  let lastError: any = null;
  let attempts = 0;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    if (isNvidiaModelOnCooldown(`${provider}:${model}`)) continue;

    keyLoop: for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex];
      if (isKeyOnCooldown(key)) continue;

      const jsonModes = wantsJson ? [true, false] : [false];
      for (const withJson of jsonModes) {
        throwIfAborted(params.abortSignal);
        attempts += 1;
        try {
          const result = await callOpenAiCompatOnce(
            provider,
            baseUrl,
            model,
            key,
            params,
            withJson,
            extraHeaders,
          );
          if (modelIndex > 0 || keyIndex > 0) {
            console.warn(`${provider}: успех на «${model}» (попытка #${attempts}).`);
          }
          if (provider === "groq") {
            await delay(500, params.abortSignal);
          }
          return { ...result, failoverCount: Math.max(0, modelIndex + keyIndex) };
        } catch (error: any) {
          if (params.abortSignal?.aborted) throw abortError();
          lastError = error;
          const status = error?.status ?? error?.statusCode;
          const body = String(error?.body || error?.message || "");

          if (withJson && status === 400 && /response_format|json_object/i.test(body)) {
            continue;
          }

          // Неверный ключ → следующий ключ
          if (status === 401 || status === 403) {
            llmLog("error", `${provider} key #${keyIndex + 1} отклонён (${status}) → cooldown 24h`, provider);
            markKeyCooldown(key, 86_400_000, `${provider}-invalid-key`);
            if (keys.every((candidate) => isKeyOnCooldown(candidate))) throw lastError;
            break; // → следующий ключ
          }

          // Нет кредитов → следующий ключ
          if (status === 402 || /Insufficient credits/i.test(body)) {
            llmLog("error", `${provider} key #${keyIndex + 1} нет кредитов (${status}) → cooldown 12h`, provider);
            markKeyCooldown(key, 43_200_000, `${provider}-no-credits`);
            if (keys.every((candidate) => isKeyOnCooldown(candidate))) throw lastError;
            break; // → следующий ключ
          }

          // Модель не найдена → следующая модель (пропускаем все оставшиеся ключи)
          if (status === 404 || status === 410 || /not found|does not exist|no endpoints|decommissioned/i.test(body)) {
            llmLog("warn", `${provider} «${model}» не найдена (${status}) → следующая модель`, provider);
            markNvidiaModelDead(`${provider}:${model}`, String(status || "not-found"));
            break keyLoop; // → следующая модель
          }

          // TPM limit на ключе → следующий ключ
          if (status === 413 || /tokens per minute|TPM|Rate limit/i.test(body)) {
            llmLog("warn", `${provider} key #${keyIndex + 1} TPM limit → cooldown 20s`, provider);
            markKeyCooldown(key, 20_000, `${provider}-tpm-limit`);
            if (keys.every((candidate) => isKeyOnCooldown(candidate))) throw lastError;
            break; // → следующий ключ
          }

          // Модель перегружена/недоступна → следующая модель
          if (status === 503 || status === 429 || status === 408 || status === 502 || status === 504) {
            llmLog("warn", `${provider} «${model}» недоступна (${status}) → cooldown 45s`, provider);
            markNvidiaModelCooldown(`${provider}:${model}`, String(status || "busy"), 45_000);
            break keyLoop; // → следующая модель
          }

          // Неизвестная ошибка → следующая модель
          llmLog("warn", `${provider} «${model}» ошибка: ${String(error?.message || error).slice(0, 80)}`, provider);
          markNvidiaModelCooldown(`${provider}:${model}`, "error", 30_000);
          break keyLoop; // → следующая модель
        }
      }
    }
  }

  throw lastError || new Error(`${provider}: все модели недоступны`);
}

async function generateViaGroq(params: LlmGenerateParams): Promise<LlmGenerateResult> {
  return generateViaOpenAiChain("groq", params);
}

async function generateViaOpenrouter(params: LlmGenerateParams): Promise<LlmGenerateResult> {
  return generateViaOpenAiChain("openrouter", params);
}

async function callGeminiOnce(
  client: GoogleGenAI,
  modelName: string,
  params: LlmGenerateParams,
): Promise<LlmGenerateResult> {
  const timeoutMs = geminiRequestTimeoutMs();
  const config: Record<string, unknown> = {
    systemInstruction: params.systemInstruction,
    temperature: params.temperature ?? 0.7,
    responseMimeType: params.responseMimeType,
    responseSchema: params.responseSchema as any,
    maxOutputTokens: params.maxOutputTokens,
  };
  if (/thinking|2\.5/i.test(modelName)) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  throwIfAborted(params.abortSignal);
  const generatePromise = client.models.generateContent({
    model: modelName,
    contents: params.contents,
    config: config as any,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortPromise = params.abortSignal
    ? new Promise<never>((_resolve, reject) => {
      if (params.abortSignal?.aborted) reject(abortError());
      else params.abortSignal?.addEventListener("abort", () => reject(abortError()), { once: true });
    })
    : null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Gemini timeout after ${timeoutMs}ms (${modelName})`);
      (err as any).status = 408;
      reject(err);
    }, timeoutMs);
  });

  let response: Awaited<ReturnType<typeof client.models.generateContent>>;
  try {
    response = await Promise.race(
      abortPromise ? [generatePromise, timeoutPromise, abortPromise] : [generatePromise, timeoutPromise],
    );
  } catch (error: any) {
    // Обогащаем ошибку SDK данными о retryDelay чтобы isDailyQuotaExhausted работал корректно
    if (!error.body && error.message) {
      // SDK иногда кладёт JSON прямо в message
      const jsonMatch = error.message.match(/\{[\s\S]*"error"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          error.body = jsonMatch[0];
          error.status = error.status || parsed?.error?.code;
          for (const d of (parsed?.error?.details ?? [])) {
            if (d?.["@type"]?.includes("RetryInfo") && d?.retryDelay) {
              (error as any).retryDelaySec = parseFloat(String(d.retryDelay).replace(/[^\d.]/g, ""));
            }
          }
        } catch { /* ignore */ }
      }
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const finishReason = String((response as any)?.candidates?.[0]?.finishReason || "");
  if (/MAX_TOKENS|LENGTH/i.test(finishReason)) {
    throw new Error("Ответ модели был обрезан по лимиту токенов");
  }
  const text = response.text?.trim();
  if (!text) throw new Error("Модель вернула пустой ответ");
  return { text, provider: "gemini", model: modelName, finishReason };
}

async function generateViaGemini(params: LlmGenerateParams): Promise<LlmGenerateResult> {
  const allKeys = collectGeminiKeys();
  const keys = allKeys.filter((k) => !isKeyOnCooldown(k));
  if (!keys.length) {
    if (allKeys.length > 0) throw new Error("Gemini: все API-ключи находятся в cooldown (квота/ошибки).");
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const models = geminiModelChain(params.model);
  let lastError: any = null;
  let attempts = 0;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    if (isNvidiaModelOnCooldown(`gemini:${model}`)) continue;

    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex];
      if (isKeyOnCooldown(key)) continue;

      const ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: { headers: { "User-Agent": "writers-studio" } },
      });

      if (params.abortSignal?.aborted) throw new Error("Aborted by user");
      attempts += 1;
      try {
        const result = await callGeminiOnce(ai, model, params);
        if (modelIndex > 0 || keyIndex > 0) {
          console.warn(`Gemini: успех на «${model}» (попытка #${attempts}, failover).`);
        }
        return { ...result, failoverCount: modelIndex + keyIndex };
      } catch (error: any) {
        if (params.abortSignal?.aborted) throw abortError();
        lastError = error;
        const status = error?.status ?? error?.statusCode;
        const message = String(error?.message ?? "");

        if (status === 429) {
          if (isDailyQuotaExhausted(error)) {
            console.warn(`Gemini key #${keyIndex + 1} daily quota exhausted → key cooldown 1h`);
            markKeyCooldown(key, 3_600_000, "gemini-daily-quota");
            if (keys.every((candidate) => isKeyOnCooldown(candidate))) throw lastError;
            continue;
          } else {
            let delayMs = 20000;
            const parsedDelay = extractGeminiRetryDelaySeconds(error);
            if (parsedDelay !== null) {
              delayMs = parsedDelay * 1000 + 1000;
            } else {
              const match = message.match(/retry in ([\d\.]+)s/i);
              if (match && match[1]) {
                delayMs = Math.ceil(parseFloat(match[1]) * 1000) + 1000;
              }
            }
            console.warn(`Gemini key #${keyIndex + 1} RPM limit. Охлаждаем ключ на ${Math.round(delayMs/1000)}с и идём дальше...`);
            markKeyCooldown(key, delayMs, "gemini-rpm-limit");
            if (keys.every((candidate) => isKeyOnCooldown(candidate))) throw lastError;
            continue;
          }
        }

        if (status === 401 || status === 403) {
          console.warn(`Gemini key #${keyIndex + 1} invalid (${status}) → key cooldown 24h`);
          markKeyCooldown(key, 86_400_000, "gemini-invalid-key");
          if (keys.every((candidate) => isKeyOnCooldown(candidate))) throw lastError;
          continue;
        }

        if (status === 404 || status === 400) {
          console.warn(`Gemini модель «${model}» недоступна (${status}) → next model`);
          markNvidiaModelDead(`gemini:${model}`, String(status));
          break;
        }

        if (status === 408 || /timeout/i.test(message)) {
          console.warn(`Gemini «${model}» timeout → next model`);
          markNvidiaModelCooldown(`gemini:${model}`, "timeout", 45_000);
          break;
        }

        console.warn(`Gemini «${model}» ошибка (${status ?? "net"}), пробуем дальше:`, message.slice(0, 120));
      }
    }
  }

  throw lastError || new Error("Gemini: все модели и ключи недоступны");
}

/**
 * Главная точка входа.
 * auto: цепочка Gemini → Groq → OpenRouter → NVIDIA.
 * Иначе только выбранный провайдер (свои модели внутри).
 */
export async function llmGenerate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
  throwIfAborted(params.abortSignal);
  const pref = providerPreference();
  const preferred = resolveProvider(params.model);

  const has: Record<LlmProviderId, boolean> = {
    gemini: collectGeminiKeys().length > 0,
    nvidia: collectNvidiaKeys().length > 0,
    groq: collectGroqKeys().length > 0,
    openrouter: collectOpenrouterKeys().length > 0,
  };

  const runOne = async (id: LlmProviderId, label?: string): Promise<LlmGenerateResult> => {
    if (label) console.warn(label);
    if (id === "gemini") {
      return generateViaGemini({
        ...params,
        model: (params.model || "").toLowerCase().startsWith("gemini")
          ? params.model
          : DEFAULT_GEMINI_MODEL,
      });
    }
    if (id === "nvidia") {
      return generateViaNvidia({
        ...params,
        model: isNvidiaModelName(params.model || "") ? params.model : nvidiaDefaultModel(),
      });
    }
    if (id === "groq") {
      return generateViaGroq({
        ...params,
        model: isGroqModelName(params.model || "") ? params.model : groqDefaultModel(),
      });
    }
    return generateViaOpenrouter({
      ...params,
      model: isOpenRouterModelName(params.model || "") ? params.model : openrouterDefaultModel(),
    });
  };

  // Жёсткий выбор: сначала пробуем его, но если упал — fallback на другие доступные.
  if (pref !== "auto") {
    try {
      console.warn(`LLM → ${preferred} (pref=${pref}, model=${params.model || "default"})`);
      return await runOne(preferred);
      } catch (error: any) {
        if (params.abortSignal?.aborted) throw abortError();
        const status = error?.status ?? error?.statusCode;
        if (status === 401 || status === 403) {
         throw error; // If auth fails on explicitly chosen provider, don't silently fallback, let them know.
      }
      
      console.warn(`[Fallback] Провайдер ${preferred} недоступен. Пробуем резервные...`);
      const soft: LlmProviderId[] = ["gemini", "groq", "nvidia"].filter(x => x !== preferred) as LlmProviderId[];
      let lastSoftError: any = error;
      
      for (const id of soft) {
        if (!has[id]) continue;
        try {
          return await runOne(
            id,
            `Fallback: ${preferred} недоступен → переключаемся на ${id}`
          );
        } catch (softErr: any) {
          lastSoftError = softErr;
          console.warn(`Fallback ${id} тоже упал: ${String(softErr?.message || softErr).slice(0, 100)}`);
        }
      }
      throw lastSoftError;
    }
  }

  // auto: Gemini первым по результату live-бенчмарка; NVIDIA — только в хвосте
  const order = uniquePreserve([
    preferred === "nvidia" ? "gemini" : preferred,
    "gemini",
    "groq",
    "nvidia",
  ]) as LlmProviderId[];

  const activeOrder = order.filter((id) => has[id]);
  llmLog("info", `Авто: ${activeOrder.join(" → ")} (model=${params.model || "—"})`);
  console.warn(`LLM auto order: ${activeOrder.join(" → ")} (model=${params.model || "—"})`);

  let lastError: any = null;
  let networkFailCount = 0; // счётчик сетевых сбоев подряд
  for (const id of order) {
    if (!has[id]) continue;
    try {
      if (id !== order.find((x) => has[x])) {
        llmLog("warn", `Фейловер → ${id}…`, id);
        return await runOne(id, `auto-failover → ${id}…`);
      }
      return await runOne(id);
    } catch (error: any) {
      if (params.abortSignal?.aborted) throw abortError();
      lastError = error;
      const msg = String(error?.message || error);
      // Детектор тотального сетевого сбоя: если провайдер говорит fetch failed — считаем
      if (/fetch failed|network error|ECONN|ETIMED|ENOTFOUND/i.test(msg) || /network/i.test(msg)) {
        networkFailCount += 1;
        if (networkFailCount >= 2) {
          llmLog("error", `Сетевой сбой (${networkFailCount} провайдера не отвечают) — прерываем`, id);
          throw new Error(`Нет соединения с LLM-серверами. Проверьте подключение к интернету.`);
        }
      } else {
        networkFailCount = 0; // сбрасываем если это не сетевая ошибка
      }
      llmLog("error", `${id} не сработал: ${msg.slice(0, 100)}`, id);
      console.warn(`Провайдер ${id} не сработал: ${msg.slice(0, 120)}`);
    }
  }

  throw lastError || new Error("Все LLM-провайдеры недоступны. Проверьте ключи в Настройках ИИ или .env");
}

/** Совместимость со старым ensureCompleteResponse-style callers. */
export function llmTextOrThrow(result: LlmGenerateResult, label: string): string {
  if (!result.text?.trim()) throw new Error(`${label}: модель вернула пустой ответ`);
  if (result.finishReason && /MAX_TOKENS|LENGTH|length/i.test(result.finishReason)) {
    throw new Error(`${label}: ответ модели был обрезан по лимиту токенов`);
  }
  return result.text;
}
