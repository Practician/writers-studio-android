export type HighlightKind = "spelling" | "punctuation";

export interface HighlightRange {
  start: number;
  end: number;
  kind: HighlightKind;
}

export interface HighlightSegment {
  text: string;
  kind: HighlightKind | "plain";
  start: number;
}

/**
 * Готовит куски текста для зеркального слоя под редактором.
 * Пересечения отбрасываются: сначала орфография, потом пунктуация,
 * чтобы одна буква не получала две волны.
 */
export function buildHighlightSegments(text: string, ranges: HighlightRange[]): HighlightSegment[] {
  // При совпадении начала приоритет у орфографии: волна ошибки важнее
  // пунктуационной подсказки на том же месте.
  const priority: Record<HighlightKind, number> = { spelling: 0, punctuation: 1 };
  const ordered = [...ranges]
    .filter((range) => range.end > range.start && range.start >= 0 && range.end <= text.length)
    .sort((left, right) => {
      if (left.start !== right.start) return left.start - right.start;
      if (priority[left.kind] !== priority[right.kind]) return priority[left.kind] - priority[right.kind];
      return left.end - right.end;
    });

  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const range of ordered) {
    if (range.start < cursor) continue;
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), kind: "plain", start: cursor });
    }
    segments.push({ text: text.slice(range.start, range.end), kind: range.kind, start: range.start });
    cursor = range.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), kind: "plain", start: cursor });
  }

  return segments;
}
