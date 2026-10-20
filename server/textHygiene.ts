import { restoreYo } from "./yoRestore";

export interface TextHygieneReport {
  /** Сколько удалено невидимых или управляющих символов. */
  removedHiddenCharacters: number;
  /** Сколько нормализовано нетипографских пробелов. */
  normalizedSpaces: number;
  /** Были ли заменены CRLF/CR на LF. */
  normalizedLineEndings: boolean;
  /** Сколько исправлено машинных артефактов пунктуации (сборка 114). */
  fixedPunctuationArtifacts: number;
  /** Что именно исправлено — строки для журнала, пусто если чисто. */
  punctuationNotes: string[];
  /** Сколько словам возвращена буква ё (сборка 120, server/yoRestore.ts). */
  restoredYo: number;
  fixedLatinLeaks: number;
  fixedProperNounCase: number;
  fixedGenderAgreement: number;
  removedBurstinessStubs: number;
  removedDuplicateParagraphs: number;
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

const LATIN_LEAK_MAP: Record<string, string> = {
  brown: "бурого",
  dark: "тёмно",
  light: "светло",
  grey: "серого",
  gray: "серого",
  black: "чёрного",
  green: "зелёного",
  red: "красного",
  blue: "синего",
  white: "белого",
  stone: "каменного",
  rock: "скального",
  shadow: "тени",
  deep: "глубокого",
  cold: "холодного",
  warm: "тёплого",
};

const MASCULINE_A_NOUNS = [
  "Вася", "Васька", "Васёк", "Илья", "Илюха", "Илюша", "Никита",
  "Даня", "Данила", "Миша", "Мишка", "Саша", "Сашка", "Паша", "Пашка",
  "Лёша", "Лёшка", "Серёга", "Серёжа", "Коля", "Колька", "Толя",
  "Витя", "Витька", "Генка", "Петька", "Федька", "Димка", "Вовка",
  "батя", "дядя", "дядька", "дядюшка", "дедушка", "папа", "мужчина",
  "парнишка", "мальчишка", "братишка", "старшина",
];

const PROPER_NAMES_RESTORE = [
  "Вася", "Васька", "Васьки", "Ваське", "Ваську", "Васькой",
  "Илья", "Ильи", "Илье", "Илью", "Ильёй", "Ильей",
  "Илюха", "Илюхи", "Илюхе", "Илюху", "Илюхой",
  "Лиза", "Лизы", "Лизе", "Лизу", "Лизой",
  "Гур", "Гура", "Гуру", "Гуром",
  "Паша", "Паши", "Пень", "Колода",
];

const ARTIFICIAL_TAIL_STUB_RE =
  /(?<=[.!?])\s+(?:Прикинул|Решил|Подумал|Осознал|Смекнул|Отметил|Запомнил|Понял|Выдохнул|Вздохнул)\.(?=\s*(?:\n|$))/gu;

/** Граница кириллического слова: `\b` в JS опирается на `\w` (ASCII) и по кириллице не работает. */
const WORD_EDGE = "(?![а-яё])";
const WORD_START = "(?<![а-яё])";

/** `;` перед заглавной буквой внутри абзаца. Предложение начинается с имени или «Он». */
const SEMICOLON_CAPITAL = new RegExp(
  `;\\s+(?=[А-ЯЁ][а-яё])`,
  "gu",
);

/** Отсутствие пробела после точки/знака перед словом: `слово.Слово`. */
const GLUED_PUNCTUATION = new RegExp(
  `([а-яё,.!?…]\\.)(?=[А-ЯЁ][а-яё])`,
  "gu",
);

/**
 * Абзац-реплика целиком. Разрыв внутри ищется отдельно — так условие читается
 * прямо и не зависит от того, где остановился жадный матч.
 */
const SPEECH_PARAGRAPH = /^[ \t]*(?:—|–|-)[ \t]+\S[^\n]*/gmu;

/** Внутри абзаца: точка, затем самостоятельное предложение без союза, затем новая реплика. */
const SPEECH_BREAK = /(^|[.!?…])[ \t]*(?=[А-ЯЁ][а-яё]+[а-яё\s,]*[.!?…][ \t]+(?:—|–|-)[ \t]+\S)/u;

/**
 * Союз в ремарке — признак того, что это придаточное, а не разрыв реплики.
 */
const REMARK_CONJUNCTION = /(?<![а-яё])(?:и|а|но|зато|потом|хотя|как|будто|что|котор(?:ый|ая|ое)|если|когда|пока|даже|поэтому|значит)(?![а-яё])/iu;

function countMatches(text: string, pattern: RegExp): number {
  const matcher = new RegExp(pattern.source, pattern.flags);
  return [...text.matchAll(matcher)].length;
}

const MARKDOWN_EMPHASIS = /(?<=^|[\s([«„"'])\*\*(?!\s)([^*\n]{1,80}?)(?<!\s)\*\*(?=$|[\s.,!?;:…)\]»”"'])/gmu;

function sampleAt(text: string, index: number, before = 40, after = 40): string {
  const start = Math.max(0, index - before);
  const end = Math.min(text.length, index + after);
  return text.slice(start, end).replace(/\s+/gu, " ").trim();
}

function fixPunctuationArtifacts(input: string): { text: string; count: number; notes: string[] } {
  let text = input;
  let count = 0;
  const notes: string[] = [];

  // 1. «точка с запятой» перед заглавной → точка, буква остаётся заглавной.
  SEMICOLON_CAPITAL.lastIndex = 0;
  const semicolons = [...text.matchAll(SEMICOLON_CAPITAL)];
  if (semicolons.length) {
    text = text.replace(SEMICOLON_CAPITAL, ". ");
    count += semicolons.length;
    notes.push(`«; » перед заглавной → «. » ×${semicolons.length} (${sampleAt(input, semicolons[0].index ?? 0)})`);
  }

  // 2. Слипшаяся пунктуация → вставить пробел. Минимальная длина слова слева
  //    отсекает сокращения «т. д.», «и. о.», «см. Рис.».
  GLUED_PUNCTUATION.lastIndex = 0;
  const glued = [...text.matchAll(GLUED_PUNCTUATION)].filter((match) => {
    const left = text.slice(Math.max(0, (match.index ?? 0) - 4), (match.index ?? 0) + 1);
    const word = left.match(/([а-яё]{2,})\.$/iu);
    return !word || !/^(?:т|и|см|рис|стр|г|в|д|стр|рис|изд|ч|ст|тыс|руб|коп|лет|им|ул|доб|отв)$/iu.test(word[1]);
  });
  if (glued.length) {
    text = text.replace(GLUED_PUNCTUATION, "$1 ");
    count += glued.length;
    notes.push(`пропущенный пробел после знака ×${glued.length} (${sampleAt(input, glued[0].index ?? 0)})`);
  }

  // 3. Реплика, разорванная самостоятельным предложением ремарки.
  let splitFixed = 0;
  SPEECH_PARAGRAPH.lastIndex = 0;
  text = text.replace(SPEECH_PARAGRAPH, (paragraph) => {
    const broken = paragraph.match(SPEECH_BREAK);
    if (!broken) return paragraph;
    const markAt = broken.index ?? 0;
    const head = paragraph.slice(0, markAt).replace(/[.!?…][ \t]*$/u, "");
    const tail = paragraph.slice(markAt);
    const nextSpeech = tail.search(/[.!?…][ \t]*(?=(?:—|–|-)[ \t]+\S)/u);
    if (nextSpeech < 0) return paragraph;
    const remark = tail.slice(/^[.!?…][ \t]*/u.exec(tail)?.[0].length || 0, nextSpeech)
      .replace(/[.!?…][ \t]*$/u, "");
    const rest = tail.slice(nextSpeech).replace(/^[.!?…][ \t]*/u, "");
    if (!remark || !rest) return paragraph;
    if (REMARK_CONJUNCTION.test(remark)) return paragraph;
    const breakMark = tail[nextSpeech];
    splitFixed += 1;
    return `${head}: ${remark.charAt(0).toLowerCase()}${remark.slice(1)}${breakMark} ${rest}`;
  });
  if (splitFixed) {
    count += splitFixed;
    notes.push(`реплика, разорванная ремаркой, собрана заново ×${splitFixed}`);
  }

  // 4. Markdown-выделение внутри прозы
  const emphasised = [...text.matchAll(MARKDOWN_EMPHASIS)];
  if (emphasised.length) {
    text = text.replace(MARKDOWN_EMPHASIS, "$1");
    count += emphasised.length;
    notes.push(`markdown-выделение снято ×${emphasised.length} (${sampleAt(input, emphasised[0].index ?? 0)})`);
  }

  return { text, count, notes };
}

function normalizeForSimilarity(paragraph: string): string {
  return paragraph
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenJaccardSimilarity(a: string, b: string): number {
  const normA = normalizeForSimilarity(a);
  const normB = normalizeForSimilarity(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const wordsA = normA.split(" ").filter((w) => w.length > 2);
  const wordsB = normB.split(" ").filter((w) => w.length > 2);
  if (wordsA.length < 5 || wordsB.length < 5) return 0;

  const setA = new Set<string>();
  const setB = new Set<string>();
  for (let i = 0; i <= wordsA.length - 3; i++) {
    setA.add(`${wordsA[i]} ${wordsA[i + 1]} ${wordsA[i + 2]}`);
  }
  for (let i = 0; i <= wordsB.length - 3; i++) {
    setB.add(`${wordsB[i]} ${wordsB[i + 1]} ${wordsB[i + 2]}`);
  }
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function deduplicateParagraphs(text: string): { text: string; removedCount: number } {
  const blocks = text.split("\n");
  const kept: string[] = [];
  let removedCount = 0;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.length < 45) {
      kept.push(block);
      continue;
    }

    let isDuplicate = false;
    const windowStart = Math.max(0, kept.length - 6);
    for (let i = windowStart; i < kept.length; i++) {
      const prev = kept[i].trim();
      if (prev.length < 45) continue;
      if (tokenJaccardSimilarity(prev, trimmed) >= 0.82) {
        isDuplicate = true;
        removedCount++;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(block);
    }
  }

  return { text: kept.join("\n"), removedCount };
}

export function sanitizeGeneratedText(input: string, authorSample?: string): TextHygieneResult {
  const normalizedLineEndings = /\r/u.test(input);
  const normalizedSpaces = countMatches(input, NONSTANDARD_SPACE);
  const removedHiddenCharacters =
    countMatches(input, INVISIBLE_OR_DIRECTIONAL) + countMatches(input, DISALLOWED_CONTROL);

  let text = input
    .replace(/\r\n?/gu, "\n")
    .replace(INVISIBLE_OR_DIRECTIONAL, "")
    .replace(DISALLOWED_CONTROL, "")
    .replace(NONSTANDARD_SPACE, " ");

  const punctuation = fixPunctuationArtifacts(text);
  text = punctuation.text;
  let fixedPunctuationArtifacts = punctuation.count;
  const punctuationNotes = [...punctuation.notes];

  let fixedLatinLeaks = 0;
  text = text.replace(
    /([А-ЯЁа-яё]+)-([A-Za-z]+)|([A-Za-z]+)-([А-ЯЁа-яё]+)/g,
    (full, cyr1, lat1, lat2, cyr2) => {
      fixedLatinLeaks++;
      if (cyr1 && lat1) {
        const replacement = LATIN_LEAK_MAP[lat1.toLowerCase()];
        return replacement ? `${cyr1}-${replacement}` : cyr1;
      }
      if (lat2 && cyr2) {
        const replacement = LATIN_LEAK_MAP[lat2.toLowerCase()];
        return replacement ? `${replacement}-${cyr2}` : cyr2;
      }
      return full;
    }
  );
  if (fixedLatinLeaks > 0) {
    punctuationNotes.push(`Исправлены англоязычные склейки в словах (${fixedLatinLeaks})`);
  }

  let fixedProperNounCase = 0;
  for (const properName of PROPER_NAMES_RESTORE) {
    const lowerName = properName.toLowerCase();
    const re = new RegExp(`([;:])\\s+${lowerName}(?![а-яё])`, "gu");
    text = text.replace(re, () => {
      fixedProperNounCase++;
      fixedPunctuationArtifacts++;
      return `. ${properName}`;
    });
  }
  if (fixedProperNounCase > 0) {
    punctuationNotes.push(
      `Восстановлены заглавные буквы имён собственных после точки с запятой (${fixedProperNounCase})`
    );
  }

  text = text.replace(/;\s+([А-ЯЁ])/gu, (_m, cap) => {
    fixedPunctuationArtifacts++;
    return `. ${cap}`;
  });

  text = text.replace(/(^|\n|[—–-]\s*)А:\s+чего\?/gu, (_m, prefix) => {
    fixedPunctuationArtifacts++;
    return `${prefix}А? Чего?`;
  });
  text = text.replace(/(Чего\s+там\s+ещ[её]):\s+/giu, (_m, prefix) => {
    fixedPunctuationArtifacts++;
    return `${prefix} — `;
  });

  let removedBurstinessStubs = 0;
  text = text.replace(ARTIFICIAL_TAIL_STUB_RE, () => {
    removedBurstinessStubs++;
    fixedPunctuationArtifacts++;
    return "";
  });
  if (removedBurstinessStubs > 0) {
    punctuationNotes.push(
      `Удалены искусственные однословные отбивки ритма (${removedBurstinessStubs})`
    );
  }

  let fixedGenderAgreement = 0;
  const mascPattern = MASCULINE_A_NOUNS.join("|");
  const genderRe = new RegExp(
    `(?<![А-ЯЁа-яё])(${mascPattern})((?:\\s+(?:уже|снова|опять|вдруг|сразу|тихо|быстро|молча|нехотя|тоже|также|чуть|едва|просто|сам))?)\\s+([а-яё]{2,}л)а(сь)?(?![а-яё])`,
    "giu"
  );
  text = text.replace(genderRe, (_full, name, adv, verbStem, refl) => {
    fixedGenderAgreement++;
    fixedPunctuationArtifacts++;
    const fixedSuffix = refl ? "ся" : "";
    return `${name}${adv ?? ""} ${verbStem}${fixedSuffix}`;
  });
  if (fixedGenderAgreement > 0) {
    punctuationNotes.push(
      `Исправлено согласование мужского рода для имён на -а/-я (${fixedGenderAgreement})`
    );
  }

  const dedup = deduplicateParagraphs(text);
  text = dedup.text;
  const removedDuplicateParagraphs = dedup.removedCount;
  if (removedDuplicateParagraphs > 0) {
    punctuationNotes.push(`Удалены дублирующиеся абзацы (${removedDuplicateParagraphs})`);
  }

  const yoResult = restoreYo(text, authorSample);
  text = yoResult.text;
  const restoredYo = yoResult.restored;
  if (restoredYo > 0) {
    punctuationNotes.push(`ё восстановлено ×${restoredYo} (${yoResult.samples.join(", ")})`);
  }

  const changed = text !== input;

  return {
    text,
    report: {
      removedHiddenCharacters,
      normalizedSpaces,
      normalizedLineEndings,
      fixedPunctuationArtifacts,
      punctuationNotes,
      restoredYo,
      fixedLatinLeaks,
      fixedProperNounCase,
      fixedGenderAgreement,
      removedBurstinessStubs,
      removedDuplicateParagraphs,
      changed,
    },
  };
}

export function punctuationHygieneNote(report: TextHygieneReport): string {
  return report.punctuationNotes.length
    ? `машинная пунктуация исправлена (${report.fixedPunctuationArtifacts}): ${report.punctuationNotes.join("; ")}`
    : "";
}

export { WORD_EDGE, WORD_START };
