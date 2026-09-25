import { normalizeSpellKey } from "./spellRu";

const STORAGE_KEY = "writers_studio_personal_dictionary";

/** Свои слова книги: имена, топонимы, термины. Хранятся только на устройстве. */
export function loadPersonalWords(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => String(value).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function savePersonalWords(words: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
  } catch {
    // Приватный режим и переполнение хранилища не должны ломать редактор.
  }
}

export function addPersonalWord(words: string[], word: string): string[] {
  const trimmed = word.trim();
  if (!trimmed) return words;
  const key = normalizeSpellKey(trimmed);
  if (!key) return words;
  if (words.some((existing) => normalizeSpellKey(existing) === key)) return words;
  return [...words, trimmed];
}

export function removePersonalWord(words: string[], word: string): string[] {
  const key = normalizeSpellKey(word);
  return words.filter((existing) => normalizeSpellKey(existing) !== key);
}

/** Объединяет свои слова с именами книги и защищёнными терминами профиля автора. */
export function mergeKnownWords(...sources: (string[] | undefined)[]): string[] {
  const merged = new Map<string, string>();
  for (const source of sources) {
    for (const raw of source || []) {
      const trimmed = String(raw || "").trim();
      const key = normalizeSpellKey(trimmed);
      if (key && !merged.has(key)) merged.set(key, trimmed);
    }
  }
  return [...merged.values()];
}
