import { Capacitor } from "@capacitor/core";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";

/** Клиентские настройки LLM. В APK ключи хранятся в Android secure storage. */

export type LlmProviderChoice = "auto" | "gemini" | "nvidia" | "groq" | "openrouter";

export interface StoredLlmKeys {
  gemini: string;
  nvidia: string;
  groq: string;
  openrouter: string;
}

const PROVIDER_LS = "writers_studio_llm_provider";
const KEYS_LS = "writers_studio_llm_keys_v1";
const OPENROUTER_MODEL_LS = "writers_studio_openrouter_model_v1";
const NVIDIA_MODEL_LS = "writers_studio_nvidia_model_v1";
const GEMINI_MODEL_LS = "writers_studio_gemini_model_v1";
const GROQ_MODEL_LS = "writers_studio_groq_model_v1";
export const DEFAULT_OPENROUTER_MODEL = "stealth/ox-alpha";
export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
/** Литературный профиль: первый в цепочке локального RU-бенчмарка основного приложения. */
export const DEFAULT_NVIDIA_MODEL = "deepseek-ai/deepseek-v4-flash-0731";
export type LiteraryModelProfile = { id: string; label: string; description: string };

export const GEMINI_LITERARY_MODELS: readonly LiteraryModelProfile[] = [
  { id: DEFAULT_GEMINI_MODEL, label: "Литературный авто — Gemini 3.7 Flash", description: "Рекомендуемый быстрый профиль для русской прозы и продолжения сцен." },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro — глубокая редактура", description: "Вариант для сложной композиции; preview-модель может иметь отдельные лимиты." },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash — баланс", description: "Стабильный баланс между темпом, связностью и стоимостью." },
];

export const GROQ_LITERARY_MODELS: readonly LiteraryModelProfile[] = [
  { id: DEFAULT_GROQ_MODEL, label: "Литературный авто — GPT-OSS 120B", description: "Рекомендуемый мощный текстовый профиль Groq для русской прозы." },
  { id: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B — диалоги и стиль", description: "Альтернатива для вариативных диалогов; preview-модель может иметь отдельные лимиты." },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B — быстрые правки", description: "Быстрый вариант для продолжений, редакторских и коротких задач." },
];

export const OPENROUTER_LITERARY_MODELS: readonly LiteraryModelProfile[] = [
  { id: DEFAULT_OPENROUTER_MODEL, label: "Авто — Ox Alpha", description: "Текущий профиль OpenRouter; при пустом ответе или квоте APK сам перейдёт на бесплатный router." },
  { id: "mistralai/mistral-small-creative", label: "Mistral Small Creative — художественный", description: "Специализированный вариант для повествования, диалогов и ролевого текста." },
  { id: "openrouter/free", label: "Бесплатный router — OpenRouter", description: "OpenRouter сам выбирает доступную бесплатную текстовую модель; состав пула меняется." },
];

export const NVIDIA_LITERARY_MODELS = [
  {
    id: DEFAULT_NVIDIA_MODEL,
    label: "Литературный авто — DeepSeek V4 Flash",
    description: "Рекомендуется для русской прозы; первый в автоматической цепочке NVIDIA.",
  },
  {
    id: "z-ai/glm-5.2",
    label: "GLM 5.2 — сложная проза",
    description: "Альтернатива для более обстоятельных сцен и диалогов.",
  },
  {
    id: "minimaxai/minimax-m3",
    label: "MiniMax M3 — вариативный стиль",
    description: "Резервный литературный вариант при недоступности предыдущих.",
  },
  {
    id: "meta/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B — совместимый запасной",
    description: "Универсальная модель; прежний стартовый вариант APK.",
  },
] as const;
/** Одноразовая миграция: старый default NVIDIA → auto (Groq-first). */
const PROVIDER_MIGRATE_V3 = "writers_studio_llm_provider_v3_groq_first";

export const EMPTY_LLM_KEYS: StoredLlmKeys = {
  gemini: "",
  nvidia: "",
  groq: "",
  openrouter: "",
};

export function loadLlmProvider(): LlmProviderChoice {
  const saved = localStorage.getItem(PROVIDER_LS);

  // Раньше UI/env часто оставляли «nvidia» — запросы шли в deepseek 60с×N, игнорируя Groq.
  if (!localStorage.getItem(PROVIDER_MIGRATE_V3)) {
    localStorage.setItem(PROVIDER_MIGRATE_V3, "1");
    if (!saved || saved === "nvidia") {
      localStorage.setItem(PROVIDER_LS, "auto");
      return "auto";
    }
  }

  if (
    saved === "gemini"
    || saved === "nvidia"
    || saved === "auto"
    || saved === "groq"
    || saved === "openrouter"
  ) {
    return saved;
  }
  return "auto";
}

export function saveLlmProvider(provider: LlmProviderChoice): void {
  localStorage.setItem(PROVIDER_LS, provider);
}

/** Идентификатор модели OpenRouter хранится отдельно от ключа и не является секретом. */
export function loadOpenrouterModel(): string {
  return localStorage.getItem(OPENROUTER_MODEL_LS)?.trim() || DEFAULT_OPENROUTER_MODEL;
}

export function saveOpenrouterModel(model: string): void {
  const normalized = model.trim();
  localStorage.setItem(OPENROUTER_MODEL_LS, normalized || DEFAULT_OPENROUTER_MODEL);
}

/** Идентификатор NVIDIA-модели не секретен; ключи по-прежнему находятся в Keystore. */
function loadProfile(storageKey: string, profiles: readonly LiteraryModelProfile[], fallback: string): string {
  const saved = localStorage.getItem(storageKey)?.trim();
  return profiles.some((profile) => profile.id === saved) ? saved! : fallback;
}

function saveProfile(storageKey: string, profiles: readonly LiteraryModelProfile[], fallback: string, model: string): void {
  const normalized = model.trim();
  localStorage.setItem(storageKey, profiles.some((profile) => profile.id === normalized) ? normalized : fallback);
}

export function loadNvidiaModel(): string {
  return loadProfile(NVIDIA_MODEL_LS, NVIDIA_LITERARY_MODELS, DEFAULT_NVIDIA_MODEL);
}

export function saveNvidiaModel(model: string): void {
  saveProfile(NVIDIA_MODEL_LS, NVIDIA_LITERARY_MODELS, DEFAULT_NVIDIA_MODEL, model);
}

export function loadGeminiModel(): string {
  return loadProfile(GEMINI_MODEL_LS, GEMINI_LITERARY_MODELS, DEFAULT_GEMINI_MODEL);
}

export function saveGeminiModel(model: string): void {
  saveProfile(GEMINI_MODEL_LS, GEMINI_LITERARY_MODELS, DEFAULT_GEMINI_MODEL, model);
}

export function loadGroqModel(): string {
  return loadProfile(GROQ_MODEL_LS, GROQ_LITERARY_MODELS, DEFAULT_GROQ_MODEL);
}

export function saveGroqModel(model: string): void {
  saveProfile(GROQ_MODEL_LS, GROQ_LITERARY_MODELS, DEFAULT_GROQ_MODEL, model);
}

export function loadOpenrouterLiteraryModel(): string {
  return loadProfile(OPENROUTER_MODEL_LS, OPENROUTER_LITERARY_MODELS, DEFAULT_OPENROUTER_MODEL);
}

export function saveOpenrouterLiteraryModel(model: string): void {
  saveProfile(OPENROUTER_MODEL_LS, OPENROUTER_LITERARY_MODELS, DEFAULT_OPENROUTER_MODEL, model);
}

function normalizeKeys(value: Partial<StoredLlmKeys> | null | undefined): StoredLlmKeys {
  return {
    gemini: String(value?.gemini || ""),
    nvidia: String(value?.nvidia || ""),
    groq: String(value?.groq || ""),
    openrouter: String(value?.openrouter || ""),
  };
}

function serializedKeys(keys: StoredLlmKeys): string {
  return JSON.stringify({
    gemini: keys.gemini.trim(),
    nvidia: keys.nvidia.trim(),
    groq: keys.groq.trim(),
    openrouter: keys.openrouter.trim(),
  });
}

export function loadLlmKeys(): StoredLlmKeys {
  try {
    return normalizeKeys(JSON.parse(localStorage.getItem(KEYS_LS) || "{}"));
  } catch {
    return { ...EMPTY_LLM_KEYS };
  }
}

/** Загружает ключи из Android Keystore; в браузере сохраняет привычный localStorage. */
export async function loadStoredLlmKeys(): Promise<StoredLlmKeys> {
  if (!Capacitor.isNativePlatform()) return loadLlmKeys();
  try {
    const stored = await SecureStoragePlugin.get({ key: KEYS_LS });
    return normalizeKeys(JSON.parse(stored.value || "{}"));
  } catch {
    return { ...EMPTY_LLM_KEYS };
  }
}

export function saveLlmKeys(keys: StoredLlmKeys): void {
  const serialized = serializedKeys(keys);
  if (Capacitor.isNativePlatform()) {
    // Не оставляем копию ключа в WebView localStorage Android-приложения.
    localStorage.removeItem(KEYS_LS);
    void SecureStoragePlugin.set({ key: KEYS_LS, value: serialized }).catch((error) => {
      console.warn("Не удалось сохранить ключи в защищённом хранилище", error);
    });
    return;
  }
  localStorage.setItem(KEYS_LS, serialized);
}

export function clearLlmKeys(): void {
  localStorage.removeItem(KEYS_LS);
  if (Capacitor.isNativePlatform()) {
    void SecureStoragePlugin.remove({ key: KEYS_LS }).catch(() => undefined);
  }
}

/** Поля для LLM-запросов: в APK ключи передаются только напрямую выбранному провайдеру. */
export function llmRequestFields(
  provider: LlmProviderChoice,
  keys: StoredLlmKeys,
  model?: string,
): {
  llmProvider: LlmProviderChoice;
  model?: string;
  apiKeys: {
    gemini?: string;
    nvidia?: string;
    groq?: string;
    openrouter?: string;
  };
} {
  const apiKeys: {
    gemini?: string;
    nvidia?: string;
    groq?: string;
    openrouter?: string;
  } = {};
  if (keys.gemini.trim()) apiKeys.gemini = keys.gemini.trim();
  if (keys.nvidia.trim()) apiKeys.nvidia = keys.nvidia.trim();
  if (keys.groq.trim()) apiKeys.groq = keys.groq.trim();
  if (keys.openrouter.trim()) apiKeys.openrouter = keys.openrouter.trim();

  return {
    llmProvider: provider,
    ...(model ? { model } : {}),
    apiKeys,
  };
}

export function defaultModelForProvider(
  provider: LlmProviderChoice,
  status?: {
    nvidiaDefaultModel?: string;
    groqDefaultModel?: string;
    openrouterDefaultModel?: string;
  } | null,
): string {
  if (provider === "nvidia") {
    return status?.nvidiaDefaultModel || DEFAULT_NVIDIA_MODEL;
  }
  if (provider === "groq") {
    return status?.groqDefaultModel || DEFAULT_GROQ_MODEL;
  }
  if (provider === "openrouter") {
    return status?.openrouterDefaultModel || DEFAULT_OPENROUTER_MODEL;
  }
  if (provider === "gemini") return DEFAULT_GEMINI_MODEL;
  // Автовыбор использует актуальный литературный профиль Gemini, если он выбран первым.
  return DEFAULT_GEMINI_MODEL;
}

export function providerLabel(provider: LlmProviderChoice): string {
  switch (provider) {
    case "nvidia": return "NVIDIA";
    case "gemini": return "Gemini";
    case "groq": return "Groq";
    case "openrouter": return "OpenRouter";
    case "auto": return "Автовыбор";
  }
}
