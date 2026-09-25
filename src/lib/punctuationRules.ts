export type PunctuationRuleId =
  | "double-space"
  | "space-before-punctuation"
  | "missing-space-after-punctuation"
  | "hyphen-as-dash"
  | "straight-quotes"
  | "broken-ellipsis";

export interface PunctuationIssue {
  rule: PunctuationRuleId;
  message: string;
  found: string;
  replacement: string;
  start: number;
  end: number;
  severity: "note" | "warning";
}

export const PUNCTUATION_RULE_LABELS: Record<PunctuationRuleId, string> = {
  "double-space": "Двойной пробел",
  "space-before-punctuation": "Пробел перед знаком",
  "missing-space-after-punctuation": "Нет пробела после знака",
  "hyphen-as-dash": "Дефис вместо тире",
  "straight-quotes": "Прямые кавычки",
  "broken-ellipsis": "Сломанное многоточие",
};

const DIGIT_RE = /[0-9]/u;

/**
 * Шесть механических правил. Только очевидные случаи: спорное форматирование
 * (например, три точки как авторская пунктуация) правилами не трогаем.
 */
export function findPunctuationIssues(text: string): PunctuationIssue[] {
  const issues: PunctuationIssue[] = [];

  // 1. Двойной и более пробел внутри строки.
  for (const match of text.matchAll(/ {2,}/gu)) {
    const start = match.index ?? 0;
    if (start === 0 || text[start - 1] === "\n") continue;
    issues.push({
      rule: "double-space",
      message: "Лишний пробел.",
      found: match[0],
      replacement: " ",
      start,
      end: start + match[0].length,
      severity: "warning",
    });
  }

  // 2. Пробел перед знаком препинания.
  for (const match of text.matchAll(/[ \t]+([,.!?;:…])/gu)) {
    const start = match.index ?? 0;
    issues.push({
      rule: "space-before-punctuation",
      message: "Перед знаком препинания пробел не нужен.",
      found: match[0],
      replacement: match[1],
      start,
      end: start + match[0].length,
      severity: "warning",
    });
  }

  // 3. Нет пробела после знака препинания. Точку в правила не берём:
  //    инициалы и сокращения вроде «т.е.» иначе дают ложные срабатывания.
  for (const match of text.matchAll(/([,;:!?…])(?=[«"]?[А-Яа-яЁё])/gu)) {
    const start = match.index ?? 0;
    issues.push({
      rule: "missing-space-after-punctuation",
      message: "После знака препинания нужен пробел.",
      found: match[0],
      replacement: `${match[1]} `,
      start,
      end: start + match[0].length,
      severity: "warning",
    });
  }

  // 4. Дефис или короткое тире вместо тире. Числовые диапазоны не трогаем.
  for (const match of text.matchAll(/(\s)[-–](\s)/gu)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = start > 0 ? text[start - 1] : "";
    const after = end < text.length ? text[end] : "";
    if (DIGIT_RE.test(before) && DIGIT_RE.test(after)) continue;
    issues.push({
      rule: "hyphen-as-dash",
      message: "В прямой речи и вставках ставится тире.",
      found: match[0],
      replacement: `${match[1]}—${match[2]}`,
      start,
      end,
      severity: "warning",
    });
  }

  // 5. Прямые кавычки: парность считаем по всему тексту, поэтому подсказка
  //    зависит от порядка кавычки.
  let quoteIndex = 0;
  for (const match of text.matchAll(/"/gu)) {
    const start = match.index ?? 0;
    const before = start > 0 ? text[start - 1] : "";
    if (DIGIT_RE.test(before)) continue;
    const replacement = quoteIndex % 2 === 0 ? "«" : "»";
    quoteIndex += 1;
    issues.push({
      rule: "straight-quotes",
      message: quoteIndex % 2 === 1 ? "Открывающая кавычка-ёлочка." : "Закрывающая кавычка-ёлочка.",
      found: '"',
      replacement,
      start,
      end: start + 1,
      severity: "note",
    });
  }

  // 6. Сломанное многоточие: ровно две точки или четыре и больше.
  //    Три точки оставлены автору: это законный вариант оформления.
  for (const match of text.matchAll(/(?<!\.)(?:\.{2}(?!\.)|\.{4,})/gu)) {
    const start = match.index ?? 0;
    issues.push({
      rule: "broken-ellipsis",
      message: "Многоточие оформляется одним знаком.",
      found: match[0],
      replacement: "…",
      start,
      end: start + match[0].length,
      severity: "note",
    });
  }

  return issues.sort((left, right) => left.start - right.start);
}

/** Замена одного места. После правки остальные смещения пересчитываются заново. */
export function applyPunctuationFix(text: string, issue: PunctuationIssue): string {
  return text.slice(0, issue.start) + issue.replacement + text.slice(issue.end);
}
