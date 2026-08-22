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
export const DEFAULT_OPENROUTER_MODEL = "stealth/ox-alpha";
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
    return status?.nvidiaDefaultModel || "deepseek-ai/deepseek-v4-flash";
  }
  if (provider === "groq") {
    return status?.groqDefaultModel || "llama-3.3-70b-versatile";
  }
  if (provider === "openrouter") {
    return status?.openrouterDefaultModel || DEFAULT_OPENROUTER_MODEL;
  }
  if (provider === "gemini") return "gemini-3.5-flash";
  // auto — Gemini первым: лучший результат максимального humanize-бенчмарка.
  return "gemini-3.5-flash";
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
