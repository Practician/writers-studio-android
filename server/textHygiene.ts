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

// ─────────────────────────────────────────────────────────────────────────────
// Линт пунктуации (сборка 114)
// ─────────────────────────────────────────────────────────────────────────────
//
// Три артефакта, которые не пишет ни один человек, а модель и наш собственный
// конвейер — регулярно. В готовой главе 4 их было 21, 1 и 9 соответственно при
// нуле в эталоне автора; в эталоне 38 145 знаков их нет ни одного.
//
//   1. «точка, заменённая на точку с запятой»: `…как маска идола; Он молча…`
//      Порождает `fuseShortSentencesForTail` (склейка коротких фраз в длинные),
//      который соединял независимые клаузы без опускания буквы. В русском
//      тексте конструкция «точка с запятой + заглавная» не встречается вообще.
//   2. «слипшаяся пунктуация»: `Оно открывается.Пластина издала…`
//      Ошибка склейки ответа модели с обрезанным краем.
//   3. «реплика, разорванная зазвучной ремаркой»: `— Слышал, — буркнул он. — Звук…`
//      Само по себе допустимо, но с полным предложением внутри реплики
//      («— Илья, гляди, — прошептал Васька. Внутри всё сжалось. — Оно
//      открывается.») абзац перестаёт быть репликой: читается как сбой сборки.

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
 * Абзац-реплика, разорванная полным предложением зазвучной ремарки:
 * `— Илья, гляди, — прошептал Васька. Внутри всё сжалось. — Оно открывается.`
 *
 * Условие строгое, и это важно. У живого автора разрыв ремаркой внутри реплики —
 * норма: «— Ха! Темно потому что часы перевели не ту сторону, брат! — хохотнул
 * Илюха и помог Ваське отцепиться. — Ты вернулся с турбазы?» Там ремарка является
 * придаточным и держит реплику одной скобкой. Сбой — когда между двумя
 * половинами реплики стоит САМОСТОЯТЕЛЬНОЕ предложение без союза: предикат
 * теряет субъект, и абзац перестаёт быть репликой. Именно это и ловит приёмка:
 * ремарка без союза и без прямой речи внутри.
 */
/**
 * Абзац-реплика целиком. Разрыв внутри ищется отдельно — так условие читается
 * прямо и не зависит от того, где остановился жадный матч.
 */
const SPEECH_PARAGRAPH = /^[ \t]*(?:—|–|-)[ \t]+\S[^\n]*/gmu;

/** Внутри абзаца: точка, затем самостоятельное предложение без союза, затем новая реплика. */
const SPEECH_BREAK = /(^|[.!?…])[ \t]*(?=[А-ЯЁ][а-яё]+[а-яё\s,]*[.!?…][ \t]+(?:—|–|-)[ \t]+\S)/u;

/**
 * Союз в ремарке — признак того, что это придаточное, а не разрыв реплики.
 *
 * Прежняя форма искала союз сразу после точки (`\. и\b`), то есть в начале
 * следующего предложения, а не внутри ремарки: на живых примерах не сработала ни
 * разу. Правильный признак — союз ВНУТРИ куска между половинами реплики.
 * Границы — через lookaround: `\b` по кириллице не работает.
 */
const REMARK_CONJUNCTION = /(?<![а-яё])(?:и|а|но|зато|потом|хотя|как|будто|что|котор(?:ый|ая|ое)|если|когда|пока|даже|поэтому|значит)(?![а-яё])/iu;

function countMatches(text: string, pattern: RegExp): number {
  const matcher = new RegExp(pattern.source, pattern.flags);
  return [...text.matchAll(matcher)].length;
}

/**
 * Markdown-выделение в художественной прозе.
 *
 * Условие на границы — то, что отличает разметку от авторского знака ударения
 * (`тём*` пишут без пробела, и это живая речь) и от знака умножения (`2 ** 3`):
 * выделение стоит после пробела, скобки или открывающей ёлочки, заканчивается
 * пробелом, знаком препинания или закрывающей кавычкой, а внутри нет пробелов.
 * Внутри прямой речи (`«**Беги!**»`) выделение снимается: там это всё равно
 * разметка модели, а не авторский знак.
 */
const MARKDOWN_EMPHASIS = /(?<=^|[\s([«„"'])\*\*(?!\s)([^*\n]{1,80}?)(?<!\s)\*\*(?=$|[\s.,!?;:…)\]»”"'])/gmu;

/** Отрезок строки вокруг артефакта — для журнала. */
function sampleAt(text: string, index: number, before = 40, after = 40): string {
  const start = Math.max(0, index - before);
  const end = Math.min(text.length, index + after);
  return text.slice(start, end).replace(/\s+/gu, " ").trim();
}

/**
 * Точечная починка машинных артефактов пунктуации.
 *
 * Модуль не переписывает фразы и не оценивает «человечность» текста. Каждая
 * правка — это восстановление того вида, который в русской прозе единственно
 * возможен: после точки с запятой строчная буква, после точки пробел, реплика
 * либо реплика с ремаркой, либо реплика без ремарки.
 */
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

  // 3. Реплика, разорванная самостоятельным предложением ремарки. Ремарка
  //    сворачивается в придаточное: перед ней ставится двоеточие, первая буква
  //    опускается. Пример: «— Илья, гляди, — прошептал Васька. Внутри всё
  //    сжалось. — Оно открывается.» → «— Илья, гляди, — прошептал Васька: внутри
  //    всё сжалось. — Оно открывается.» Если в ремарке есть союз, предложение
  //    оставляется как есть — это придаточное, а не сбой.
  let splitFixed = 0;
  SPEECH_PARAGRAPH.lastIndex = 0;
  text = text.replace(SPEECH_PARAGRAPH, (paragraph) => {
    const broken = paragraph.match(SPEECH_BREAK);
    if (!broken) return paragraph;
    const markAt = broken.index ?? 0;
    const head = paragraph.slice(0, markAt).replace(/[.!?…][ \t]*$/u, "");
    const tail = paragraph.slice(markAt);
    // Граница ремарки — знак перед следующей репликой.
    const nextSpeech = tail.search(/[.!?…][ \t]*(?=(?:—|–|-)[ \t]+\S)/u);
    if (nextSpeech < 0) return paragraph;
    // Знак, которым заканчивалась первая половина реплики, поглощается: он больше
    // не нужен, потому что ремарка становится придаточным.
    const remark = tail.slice(/^[.!?…][ \t]*/u.exec(tail)?.[0].length || 0, nextSpeech)
      .replace(/[.!?…][ \t]*$/u, "");
    const rest = tail.slice(nextSpeech).replace(/^[.!?…][ \t]*/u, "");
    if (!remark || !rest) return paragraph;
    // Союз ищется В РЕМАРКЕ, а не во всём хвосте. Проверка по хвосту ловила любой
    // союз дальше по абзацу и потому пропускала настоящие разрывы: в «Он сделал
    // шаг вперёд… как экран телевизора» союз «как» стоял за второй репликой.
    if (REMARK_CONJUNCTION.test(remark)) return paragraph;
    // Знак перед следующей репликой сохраняем: без него «— Оно открывается»
    // приклеивается к ремарке и абзац снова рассыпается.
    const breakMark = tail[nextSpeech];
    splitFixed += 1;
    return `${head}: ${remark.charAt(0).toLowerCase()}${remark.slice(1)}${breakMark} ${rest}`;
  });
  if (splitFixed) {
    count += splitFixed;
    notes.push(`реплика, разорванная ремаркой, собрана зново ×${splitFixed}`);
  }

  // 4. Markdown-выделение внутри прозы: `боясь спугнуть **трепет**`. Модель
  //    помечает слово двумя звёздочками, и в готовой главе они остаются
  //    буквальными символами — в живом DOCX выгрузки главы 4 (05.10.2026) их
  //    было 8 на 19 300 знаков (`**трепет**`, `**тревоги**`). Ни одна из трёх
  //    правок выше markdown не ловит: он не про пунктуацию. Снимаем только
  //    парное выделение и одиночные хвостовые звёздочки; одиночная `*`
  //    посреди слова — это знак ударения вроде `тём*` в авторской речи, её
  //    не трогаем (проверка требует, чтобы рядом был пробел или граница).
  const emphasised = [...text.matchAll(MARKDOWN_EMPHASIS)];
  if (emphasised.length) {
    text = text.replace(MARKDOWN_EMPHASIS, "$1");
    count += emphasised.length;
    notes.push(`markdown-выделение снято ×${emphasised.length} (${sampleAt(input, emphasised[0].index ?? 0)})`);
  }

  return { text, count, notes };
}

/**
 * Финальный lossless-ish проход перед отправкой результата пользователю.
 *
 * Модуль не переписывает фразы и не оценивает «человечность» текста. Он только
 * удаляет невидимые служебные символы, bidi-маркеры и управляющие коды,
 * приводит необычные пробелы и переводы строк к предсказуемому виду и чинит
 * три машинных артефакта пунктуации, которых в живой прозе не бывает.
 */
export function sanitizeGeneratedText(input: string): TextHygieneResult {
  const normalizedLineEndings = /\r/u.test(input);
  const normalizedSpaces = countMatches(input, NONSTANDARD_SPACE);
  const removedHiddenCharacters =
    countMatches(input, INVISIBLE_OR_DIRECTIONAL) + countMatches(input, DISALLOWED_CONTROL);

  const cleaned = input
    .replace(/\r\n?/gu, "\n")
    .replace(INVISIBLE_OR_DIRECTIONAL, "")
    .replace(DISALLOWED_CONTROL, "")
    .replace(NONSTANDARD_SPACE, " ");
  const punctuation = fixPunctuationArtifacts(cleaned);
  // Сборка 120: ё возвращается после всех пунктуационных правок — они слов
  // не меняют, а карта server/yoRestore.ts работает по целым словам.
  const yo = restoreYo(punctuation.text);
  const text = yo.text;
  const punctuationNotes = [...punctuation.notes];
  if (yo.restored > 0) {
    punctuationNotes.push(`ё восстановлено ×${yo.restored} (${yo.samples.join(", ")})`);
  }

  return {
    text,
    report: {
      removedHiddenCharacters,
      normalizedSpaces,
      normalizedLineEndings,
      fixedPunctuationArtifacts: punctuation.count,
      punctuationNotes,
      restoredYo: yo.restored,
      changed: text !== input,
    },
  };
}

/** Строки отчёта для журнала: пусто, когда чисто. */
export function punctuationHygieneNote(report: TextHygieneReport): string {
  return report.punctuationNotes.length
    ? `машинная пунктуация исправлена (${report.fixedPunctuationArtifacts}): ${report.punctuationNotes.join("; ")}`
    : "";
}

export { WORD_EDGE, WORD_START };