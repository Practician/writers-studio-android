export interface TextHygieneReport {
  /** Количество удалённых невидимых или управляющих символов. */
  removedHiddenCharacters: number;
  /** Количество нормализованных нетипографских пробелов. */
  normalizedSpaces: number;
  /** Были ли заменены CRLF/CR на LF. */
  normalizedLineEndings: boolean;
  /** Итоговый текст отличается от исходного. */
  changed: boolean;
}

export interface TextHygieneResult {
  text: string;
  report: TextHygieneReport;
}

// Символы, которые не несут самостоятельного смысла в русской и английской
// прозе, но могут попадать в результат при копировании или генерации. Не
// удаляем ZWJ/variation selectors: они нужны для составных emoji и некоторых
// письменностей, поэтому не должны ломать пользовательский текст.
const INVISIBLE_OR_DIRECTIONAL = /[\u00AD\u034F\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;
const NONSTANDARD_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;

function countMatches(text: string, pattern: RegExp): number {
  const matcher = new RegExp(pattern.source, pattern.flags);
  return [...text.matchAll(matcher)].length;
}

/**
 * Финальный lossless-ish проход перед отправкой результата пользователю.
 *
 * Модуль не переписывает фразы и не оценивает «человечность» текста. Он только
 * удаляет невидимые служебные символы, bidi-маркеры и управляющие коды, а также
 * приводит необычные пробелы и переводы строк к предсказуемому виду.
 */
export function sanitizeGeneratedText(input: string): TextHygieneResult {
  const normalizedLineEndings = /\r/u.test(input);
  const normalizedSpaces = countMatches(input, NONSTANDARD_SPACE);
  const removedHiddenCharacters =
    countMatches(input, INVISIBLE_OR_DIRECTIONAL) + countMatches(input, DISALLOWED_CONTROL);

  const text = input
    .replace(/\r\n?/gu, "\n")
    .replace(INVISIBLE_OR_DIRECTIONAL, "")
    .replace(DISALLOWED_CONTROL, "")
    .replace(NONSTANDARD_SPACE, " ");

  return {
    text,
    report: {
      removedHiddenCharacters,
      normalizedSpaces,
      normalizedLineEndings,
      changed: text !== input,
    },
  };
}
