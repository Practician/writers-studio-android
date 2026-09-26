export type MarkKind = "spelling" | "punctuation" | "plot";

/** Прежнее имя: используется в зеркальном слое редактора. */
export type HighlightKind = MarkKind;

export interface HighlightRange {
  start: number;
  end: number;
  kind: MarkKind;
  /** Ключ метки: по нему карточка находит своё место в зеркальном слое. */
  id?: string;
}

export interface HighlightSegment {
  text: string;
  kind: MarkKind | "plain";
  start: number;
  id?: string;
}

export type MarkKindVisibility = Record<MarkKind, boolean>;

export const MARK_KINDS: MarkKind[] = ["spelling", "punctuation", "plot"];

export const DEFAULT_MARK_VISIBILITY: MarkKindVisibility = {
  spelling: true,
  punctuation: true,
  plot: true,
};

/** При совпадении места приоритет у правописания: мелкая метка точнее фразы. */
const PRIORITY: Record<MarkKind, number> = { spelling: 0, punctuation: 1, plot: 2 };

export function markId(kind: MarkKind, index: number): string {
  return `${kind}:${index}`;
}

export interface AnchoredRange extends HighlightRange {
  /** Текст, который обязан стоять под меткой: слово словаря или найденный знак. */
  expected?: string;
}

/** Насколько далеко ищем слово, уехавшее после правки выше по тексту. */
const ANCHOR_LOOKBACK = 240;

/**
 * Смещения приходят из отложенной проверки: пока словарь искал места, автор мог
 * дописать слово выше, и прежние числа попадают на чужой текст — метка встаёт
 * не под своим словом. Поэтому каждую метку привязываем заново: сначала
 * проверяем прежнее место, потом ищем то же слово рядом. Не нашли — метку не
 * рисуем: пустая лучше чужой.
 */
export function anchorRangesToText(text: string, ranges: AnchoredRange[]): HighlightRange[] {
  const result: HighlightRange[] = [];

  for (const range of ranges) {
    const expected = range.expected;
    if (!expected) {
      if (range.end > range.start && range.end <= text.length) {
        result.push({ start: range.start, end: range.end, kind: range.kind, id: range.id });
      }
      continue;
    }

    if (text.slice(range.start, range.end) === expected) {
      result.push({ start: range.start, end: range.end, kind: range.kind, id: range.id });
      continue;
    }

    const from = Math.max(0, range.start - ANCHOR_LOOKBACK);
    const to = Math.min(text.length, range.end + ANCHOR_LOOKBACK);
    const window = text.slice(from, to);
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let at = window.indexOf(expected);
    while (at !== -1) {
      const candidate = from + at;
      const distance = Math.abs(candidate - range.start);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
      at = window.indexOf(expected, at + 1);
    }

    if (best >= 0) {
      result.push({ start: best, end: best + expected.length, kind: range.kind, id: range.id });
    }
  }

  return result;
}

/**
 * Готовит куски текста для зеркального слоя под редактором.
 * Пересечения отбрасываются: сначала правописание, потом пунктуация,
 * а фраза стыковки уступает мелкой метке внутри неё. Выключенные виды меток
 * в слой не попадают.
 */
export function buildHighlightSegments(
  text: string,
  ranges: HighlightRange[],
  visible: MarkKindVisibility = DEFAULT_MARK_VISIBILITY,
): HighlightSegment[] {
  const valid = ranges.filter(
    (range) => visible[range.kind] && range.end > range.start && range.start >= 0 && range.end <= text.length,
  );
  const fine = valid.filter((range) => range.kind !== "plot");
  // Иначе под violet-волной стояла бы мелкая метка, и нажатие открывало бы
  // не то, что нарисовано.
  const plot = valid.filter(
    (range) => range.kind === "plot" && !fine.some((other) => range.start < other.end && other.start < range.end),
  );
  const ordered = [...fine, ...plot].sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    if (PRIORITY[left.kind] !== PRIORITY[right.kind]) return PRIORITY[left.kind] - PRIORITY[right.kind];
    return left.end - right.end;
  });

  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const range of ordered) {
    if (range.start < cursor) continue;
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), kind: "plain", start: cursor });
    }
    segments.push({ text: text.slice(range.start, range.end), kind: range.kind, start: range.start, id: range.id });
    cursor = range.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), kind: "plain", start: cursor });
  }

  return segments;
}
