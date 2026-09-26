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
