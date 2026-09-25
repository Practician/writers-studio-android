import Typo from "typo-js";

export interface SpellIssue {
  word: string;
  /** Смещение в тексте главы: нужно, чтобы подсветить слово и заменить только его. */
  start: number;
  end: number;
}

export interface SpellScanResult {
  issues: SpellIssue[];
  truncated: boolean;
  checkedWords: number;
}

export interface SpellScanOptions {
  /**
   * Слова автора: имена героев, топонимы, термины книги. Сравниваются
   * без учёта регистра и без различия ё/е, чтобы словарь не ругался на них.
   */
  extraWords?: Iterable<string>;
  /** Потолок найденных мест: длинная глава не должна выливать в UI простыню. */
  limit?: number;
}

export interface RuSpellChecker {
  check(word: string): boolean;
  suggest(word: string, limit?: number): string[];
}

/**
 * В русском письме ё и е взаимозаменяемы, регистр в проверке не значим.
 * Одна нормализация для «своих» слов и для выдачи подсказок.
 */
export function normalizeSpellKey(word: string): string {
  return word.toLowerCase().replace(/ё/g, "е");
}

// Отдельное слово — только кириллица, возможно составное через дефис.
// Латиница и цифры попадают в проверку через соседние символы и отсекаются ниже.
const WORD_RE = /[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/gu;
const DIGIT_RE = /[0-9]/u;
const LATIN_RE = /[A-Za-z]/u;
const SUGGESTION_RE = /^[А-Яа-яЁё-]{2,}$/u;

/**
 * Чистый движок без ввода-вывода: данные словаря передаёт вызывающая сторона.
 * Так один и тот же код работает и в приложении (fetch), и в тестах (fs).
 */
export function createRuSpellChecker(affData: string, dicData: string): RuSpellChecker {
  const typo = new Typo("ru_RU", affData, dicData) as unknown as {
    check: (word: string) => boolean;
    suggest: (word: string) => string[];
  };

  return {
    check: (word: string) => {
      try {
        return Boolean(typo.check(word));
      } catch {
        return true;
      }
    },
    suggest: (word: string, limit = 6) => {
      try {
        const raw = typo.suggest(word) || [];
        return raw
          .map((candidate) => String(candidate).replace(/[.!?;:]+$/u, ""))
          .filter((candidate) => SUGGESTION_RE.test(candidate))
          .filter((candidate, index, all) => all.indexOf(candidate) === index)
          .slice(0, limit);
      } catch {
        return [];
      }
    },
  };
}

function isKnownWord(checker: RuSpellChecker, word: string, extra: Set<string>): boolean {
  if (extra.has(normalizeSpellKey(word))) return true;
  if (checker.check(word)) return true;

  // «кто-нибудь», «из-за»: если части по отдельности верны, слово тоже верно.
  if (word.includes("-")) {
    const parts = word.split("-").filter((part) => part.length > 1);
    if (parts.length > 1 && parts.every((part) => extra.has(normalizeSpellKey(part)) || checker.check(part))) {
      return true;
    }
  }

  return false;
}

/**
 * Проверяет текст главы и возвращает места непонятных слов.
 * Подсказки замен здесь намеренно не считаются: `suggest()` дорогой,
 * его вызывают по клику автора на конкретном слове.
 */
export function scanSpellIssues(
  checker: RuSpellChecker,
  text: string,
  options: SpellScanOptions = {},
): SpellScanResult {
  const extra = new Set<string>();
  for (const raw of options.extraWords || []) {
    const key = normalizeSpellKey(String(raw || "").trim());
    if (key) extra.add(key);
  }

  const limit = options.limit ?? 600;
  const issues: SpellIssue[] = [];
  let truncated = false;
  let checkedWords = 0;

  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0];
    const start = match.index ?? 0;
    const end = start + word.length;

    // Однобуквенные слова и инициалы не проверяем: шума больше, чем пользы.
    if (word.length < 2) continue;

    const before = start > 0 ? text[start - 1] : "";
    const after = end < text.length ? text[end] : "";
    if (DIGIT_RE.test(before) || DIGIT_RE.test(after)) continue;
    if (LATIN_RE.test(before) || LATIN_RE.test(after)) continue;

    checkedWords += 1;
    if (isKnownWord(checker, word, extra)) continue;

    const isAllCaps = word === word.toUpperCase() && word !== word.toLowerCase();
    // Аббревиатуры в словаре почти не встречаются: короткие заглавные не трогаем.
    if (isAllCaps && word.length <= 4) continue;
    if (isAllCaps && checker.check(word.toLowerCase())) continue;

    if (issues.length >= limit) {
      truncated = true;
      continue;
    }
    issues.push({ word, start, end });
  }

  return { issues, truncated, checkedWords };
}
