import { createRuSpellChecker, type RuSpellChecker } from "./spellRu";

export type SpellDictionaryStatus = "idle" | "loading" | "ready" | "error";

/**
 * Словарь лежит отдельным ресурсом в public/dictionaries и скачивается
 * только при входе во вкладку «Глава». В JS-бандл 3,5 МБ не попадают.
 */
const DICTIONARY_FILES = {
  aff: "dictionaries/ru_RU.aff",
  dic: "dictionaries/ru_RU.dic",
} as const;

let checkerPromise: Promise<RuSpellChecker> | null = null;

function resolveAsset(path: string): string {
  if (typeof document !== "undefined" && document.baseURI) {
    return new URL(path, document.baseURI).href;
  }
  return `/${path}`;
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(resolveAsset(path));
  if (!response.ok) {
    throw new Error(`Словарь недоступен: ${response.status} ${path}`);
  }
  return response.text();
}

/** Загрузка ровно один раз на сессию; повторные вызовы переиспользуют результат. */
export function loadRuSpellChecker(): Promise<RuSpellChecker> {
  if (!checkerPromise) {
    checkerPromise = (async () => {
      const [aff, dic] = await Promise.all([fetchText(DICTIONARY_FILES.aff), fetchText(DICTIONARY_FILES.dic)]);
      return createRuSpellChecker(aff, dic);
    })().catch((error) => {
      checkerPromise = null;
      throw error;
    });
  }
  return checkerPromise;
}

export function ruSpellCheckerIfReady(): RuSpellChecker | null {
  return null;
}

/**
 * Освобождает словарь. Разобранный словарь занимает около 166 МБ heap —
 * держать его, пока автор работает в другой вкладке, нельзя.
 */
export function releaseRuSpellChecker(): void {
  checkerPromise = null;
}
