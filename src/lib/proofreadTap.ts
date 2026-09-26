import { PLOT_CHECK_KIND_LABELS, type PlotCheckIssue } from "./plotCheck";
import { PUNCTUATION_RULE_LABELS, type PunctuationIssue } from "./punctuationRules";
import type { SpellIssue } from "./spellRu";
import { MARK_KINDS, type MarkKind } from "./proofreadHighlights";

export interface MarkRange {
  start: number;
  end: number;
}

export interface MarkHit {
  kind: MarkKind;
  index: number;
}

/** Готовая карточка метки: что нажали, почему и чем заменить. */
export interface ActiveMark {
  kind: MarkKind;
  index: number;
  start: number;
  end: number;
  /** Заголовок: вид проверки, правило пунктуации или вид нестыковки. */
  label: string;
  /** Что не так — человеческим языком. */
  message: string;
  /** Готовая замена. Пусто — менять нечего (орфография, стыковки). */
  replacement: string;
  /** Слово или цитата, к которой привязана метка. */
  quote: string;
}

export interface MarkLists {
  spelling: SpellIssue[];
  punctuation: PunctuationIssue[];
  plot: PlotCheckIssue[];
}

/**
 * Нажатие в тексте: какая метка стоит под пальцем.
 * Границы полуоткрытые — [start, end): тап сразу за словом метку не открывает.
 * Порядок видов задаёт приоритет, по умолчанию — правописание, пунктуация, стыковки.
 */
export function findMarkAtOffset(
  offset: number,
  lists: Partial<Record<MarkKind, MarkRange[]>>,
  order: MarkKind[] = MARK_KINDS,
): MarkHit | null {
  if (!Number.isFinite(offset) || offset < 0) return null;
  for (const kind of order) {
    const ranges = lists[kind];
    if (!ranges || ranges.length === 0) continue;
    const index = ranges.findIndex((range) => offset >= range.start && offset < range.end);
    if (index >= 0) return { kind, index };
  }
  return null;
}

/** Собирает карточку по найденной метке. Неизвестная метка — null, а не пустая карточка. */
export function buildActiveMark(hit: MarkHit, lists: MarkLists): ActiveMark | null {
  if (hit.kind === "spelling") {
    const issue = lists.spelling[hit.index];
    if (!issue) return null;
    return {
      kind: "spelling",
      index: hit.index,
      start: issue.start,
      end: issue.end,
      label: "Правописание",
      message: "Слова нет в словаре русского языка. Если это имя или придуманное слово — добавьте его в личный словарь.",
      replacement: "",
      quote: issue.word,
    };
  }

  if (hit.kind === "punctuation") {
    const issue = lists.punctuation[hit.index];
    if (!issue) return null;
    return {
      kind: "punctuation",
      index: hit.index,
      start: issue.start,
      end: issue.end,
      label: PUNCTUATION_RULE_LABELS[issue.rule] || "Пунктуация",
      message: issue.message,
      replacement: issue.replacement,
      quote: issue.found,
    };
  }

  const issue = lists.plot[hit.index];
  if (!issue) return null;
  return {
    kind: "plot",
    index: hit.index,
    start: issue.start,
    end: issue.end,
    label: PLOT_CHECK_KIND_LABELS[issue.kind] || "Стыковка",
    message: issue.explanation,
    replacement: "",
    quote: issue.quote,
  };
}

/** Порядок опроса меток под пальцем: скрытые виды не открываются. */
export function visibleMarkOrder(visible: Partial<Record<MarkKind, boolean>>): MarkKind[] {
  return MARK_KINDS.filter((kind) => visible[kind] !== false);
}
