/**
 * Применение переписанных сегментов отчёта нейродетектора к главе.
 *
 * Два места, которые ломали кнопку «Очеловечить AI-сегменты»:
 *
 * 1. **Переносы строк.** Детектор отдаёт сегменты без `\n` (в отчёте `result_*.json`
 *    их нет вовсе), а диапазон в главе, наоборот, охватывает настоящие абзацы.
 *    Подстановка блока как есть схлопывала абзацы AI-сегментов в одну простыню —
 *    на главе 4 это 105 абзацев → 1, плюс ломался ритм абзацев, который мы же
 *    и измеряем гейтом (`paragraphLengthCV`).
 * 2. **Пунктуация на границах.** Нормализация оставляет в диапазоне последнюю точку
 *    и первое тире реплики: блок заканчивается точкой, остаток добавлял вторую.
 *
 * Поэтому границы расширяются до букв, а блок раскладывается обратно по абзацам
 * исходного диапазона — с сохранением количества абзацев и разделителей.
 */

/** Токенизация: только буквы/цифры, ё→е, плюс отображение в исходные позиции.
 *  Нужна, потому что нейродетектор нормализует типографику и смещения из отчёта
 *  не совпадают с позициями в главе. */
export function normalizeWithMap(value: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i].toLowerCase();
    const c = ch === "ё" ? "е" : ch;
    if (/[а-яa-z0-9]/.test(c)) {
      text += c;
      map.push(i);
    }
  }
  return { text, map };
}

const LETTER_OR_DIGIT = /[а-яa-z0-9]/iu;

/** Ищет фрагмент текста (сегмент отчёта) в главе по потоку букв/цифр и возвращает
 *  реальные границы в главе — вместе с примыкающей пунктуацией, но не захватывая
 *  переносы строк: границы абзацев глава должна сохранить. */
export function findDetectorSegmentRange(chapter: string, segment: string): { start: number; end: number } | null {
  const chapterLetters = normalizeWithMap(chapter);
  const segmentLetters = normalizeWithMap(segment);
  if (!segmentLetters.text.length || !chapterLetters.text.length) return null;
  const from = chapterLetters.text.indexOf(segmentLetters.text);
  if (from < 0) return null;
  const to = from + segmentLetters.text.length;
  let start = chapterLetters.map[from];
  let end = (chapterLetters.map[to - 1] ?? start) + 1;
  // Поглощаем хвостовую пунктуацию сегмента (точка, кавычка), но останавливаемся
  // на переносе строки: иначе после блока остаётся вторая точка.
  while (end < chapter.length && !LETTER_OR_DIGIT.test(chapter[end] ?? "") && chapter[end] !== "\n") end += 1;
  // И висящие разделители реплик («— ») перед первым буквым символом сегмента.
  while (start > 0 && !LETTER_OR_DIGIT.test(chapter[start - 1] ?? "") && chapter[start - 1] !== "\n") start -= 1;
  return { start, end };
}

/** Заголовок раздела: его нельзя схлопнуть в первый абзац прозы. */
const TITLE_PATTERN = /^(?:глава\s+[\divxl]+|часть\s+[\divxl]+|пролог|эпилог|предисловие|послесловие)\b/iu;

function splitParagraphs(original: string): { texts: string[]; separators: string[] } {
  const tokens = original.split(/(\n+)/u);
  const texts: string[] = [];
  const separators: string[] = [];
  let pending = "\n\n";
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (i % 2 === 1) {
      pending = token;
      continue;
    }
    if (!token.trim()) continue;
    texts.push(token.trim());
    separators.push(pending);
  }
  return { texts, separators };
}

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?…]+[.!?…]*/gu) ?? [text])
    .map((sentence) => sentence.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

/** Убирает из начала блока заголовок, который уже стоит отдельным абзацем в главе. */
function stripLeading(block: string, prefix: string): string {
  const blockLetters = normalizeWithMap(block);
  const prefixLetters = normalizeWithMap(prefix);
  if (!prefixLetters.text.length) return block;
  if (!blockLetters.text.startsWith(prefixLetters.text)) return block;
  const cut = (blockLetters.map[prefixLetters.text.length - 1] ?? -1) + 1;
  return block.slice(cut).replace(/^[\s.,:;!?…—-]+/u, "");
}

/**
 * Складывает переписанный блок обратно в абзацы заменяемого диапазона.
 * Количество абзацев и разделители берутся из оригинала: детектор абзацев не видит,
 * но глава обязана остаться главой, а не стеной текста.
 */
export function mergeBlockIntoRange(original: string, block: string): string {
  const trimmed = block.replace(/\s+/gu, " ").trim();
  if (!trimmed) return original;

  const { texts, separators } = splitParagraphs(original);
  if (texts.length <= 1) return trimmed;

  let prose = trimmed;
  let head = "";
  let rest = original;
  if (TITLE_PATTERN.test(texts[0])) {
    head = texts[0];
    prose = stripLeading(trimmed, head);
    rest = texts.slice(1).join("\n\n");
    // Модель вернула один заголовок — абзацы главы трогать нечем, оставляем как есть.
    if (!prose) return original;
  }

  const paragraphs = head ? splitParagraphs(rest) : { texts, separators };
  const sentences = splitSentences(prose);
  if (!sentences.length) return head ? `${head}\n\n${trimmed}` : trimmed;

  const weights = paragraphs.texts.map((text) => Math.max(1, text.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const totalChars = sentences.reduce((sum, sentence) => sum + sentence.length, 0);

  const pieces: string[] = [];
  let cursor = 0;
  let takenChars = 0;
  let cumWeight = 0;
  for (let index = 0; index < paragraphs.texts.length && cursor < sentences.length; index += 1) {
    cumWeight += weights[index];
    const boundary = (cumWeight / totalWeight) * totalChars;
    const piece: string[] = [];
    while (cursor < sentences.length) {
      if (piece.length && takenChars >= boundary) break;
      piece.push(sentences[cursor]);
      takenChars += sentences[cursor].length;
      cursor += 1;
    }
    pieces.push(piece.join(" "));
  }
  // Остаток — в последний непустой абзац, если фраз в блоке больше, чем абзацев.
  if (cursor < sentences.length && pieces.length) {
    pieces[pieces.length - 1] = `${pieces[pieces.length - 1]} ${sentences.slice(cursor).join(" ")}`.trim();
  }

  const body = paragraphs.texts
    .map((_, index) => pieces[index] ?? "")
    .map((text, index) => (text ? { text, separator: paragraphs.separators[index] ?? "\n\n" } : null))
    .filter((entry): entry is { text: string; separator: string } => Boolean(entry));

  let out = "";
  for (let index = 0; index < body.length; index += 1) {
    out += body[index].text;
    if (index < body.length - 1) out += body[index].separator;
  }
  if (!out) return trimmed;
  return head ? `${head}${separators[0] ?? "\n\n"}${out}` : out;
}
