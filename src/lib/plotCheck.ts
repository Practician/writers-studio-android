/**
 * Смысловые нестыковки главы (шаг 7).
 *
 * Орфография, пунктуация и стиль считаются локально и бесплатно (соседние
 * модули). Здесь только то, чего словарём не видно: пропущенная реакция,
 * замороженная сцена, разрыв с предыдущей главой. Модель спрашивают ОДНИМ
 * запросом и только по кнопке автора, найденное показывается цитатой,
 * автор сам решает, правда ли это.
 *
 * Модуль чистый (без DOM и без сервера), поэтому его используют и клиент,
 * и серверный обработчик, и тесты.
 */

export const PLOT_CHECK_MAX_ISSUES = 200;
export const PLOT_CHECK_MIN_QUOTE = 8;
export const PLOT_CHECK_DOSSIER_LIMIT = 6000;

export type PlotCheckKind =
  | "silence"
  | "freeze"
  | "continuity"
  | "event_echo"
  | "seam_echo"
  | "explanation_tail";

export const PLOT_CHECK_KINDS: PlotCheckKind[] = [
  "silence",
  "freeze",
  "continuity",
  "event_echo",
  "seam_echo",
  "explanation_tail",
];

export interface PlotCheckIssue {
  kind: PlotCheckKind;
  quote: string;
  explanation: string;
  start: number;
  end: number;
}

export interface RawPlotIssue {
  kind?: unknown;
  quote?: unknown;
  explanation?: unknown;
}

export interface PlotCheckStats {
  issues: PlotCheckIssue[];
  /** Сколько пунктов модели удалось привязать к тексту (включая дубли). */
  located: number;
  /** Сколько пунктов пришлось выбросить: цитаты в главе нет. */
  dropped: number;
}

export const PLOT_CHECK_KIND_LABELS: Record<PlotCheckKind, string> = {
  silence: "Молчание вместо реакции",
  freeze: "Замороженная сцена",
  continuity: "Разрыв с предыдущей главой",
  event_echo: "Событие пропущено",
  seam_echo: "Шов между главами",
  explanation_tail: "Хвост объяснений",
};

export const PLOT_CHECK_KIND_HINTS: Record<PlotCheckKind, string> = {
  silence: "персонаж промолчал там, где по ситуации обязан был ответить, и текст это не отмечает",
  freeze: "сцена остановилась посреди действия: никто не двинулся и не решил",
  continuity: "факт, предмет или человек расходятся с предыдущей главой",
  event_echo: "в книге обещано событие, но в главе оно не случилось или случилось без описания",
  seam_echo: "начало главы продолжает предыдущую так, будто между ними выпал кусок",
  explanation_tail: "сцена объяснена автором, а не показана: рассказ вместо действия",
};

const QUOTE_LIKE = new Set(Array.from("«»„“”‟‘’‚‛‹›\"'"));
const DASH_LIKE = new Set(Array.from("–—−"));

interface AnchorIndex {
  normalized: string;
  map: number[];
}

/**
 * Приводим текст к «черновику для поиска»: пробелы схлопываем, кавычки и
 * длинные тире унифицируем, регистр опускаем. Длина строки при этом меняется,
 * поэтому рядом хранится карта: индекс в нормализованной строке → индекс в
 * исходной. Так цитата, набранная моделью с другими пробелами и кавычками,
 * всё равно находит точные смещения в главе.
 */
function buildAnchorIndex(text: string): AnchorIndex {
  const chars: string[] = [];
  const map: number[] = [];
  let previousWasSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/\s/u.test(char)) {
      if (chars.length === 0 || previousWasSpace) continue;
      previousWasSpace = true;
      chars.push(" ");
      map.push(index);
      continue;
    }
    previousWasSpace = false;
    let normalized = char;
    if (QUOTE_LIKE.has(normalized)) normalized = "\"";
    else if (DASH_LIKE.has(normalized)) normalized = "-";
    const lower = normalized.toLowerCase();
    chars.push(lower.length === 1 ? lower : normalized);
    map.push(index);
  }
  while (chars.length > 0 && chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }
  return { normalized: chars.join(""), map };
}

/** Смещения цитаты в исходном тексте или null, если цитата не найдена. */
export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  if (typeof text !== "string" || typeof quote !== "string") return null;
  const needle = buildAnchorIndex(quote).normalized;
  if (needle.length < PLOT_CHECK_MIN_QUOTE) return null;
  const haystack = buildAnchorIndex(text);
  const at = haystack.normalized.indexOf(needle);
  if (at < 0) return null;
  const last = at + needle.length - 1;
  if (last >= haystack.map.length) return null;
  return { start: haystack.map[at], end: haystack.map[last] + 1 };
}

function normalizeKind(value: unknown): PlotCheckKind {
  const candidate = String(value || "");
  return (PLOT_CHECK_KINDS as string[]).includes(candidate) ? (candidate as PlotCheckKind) : "continuity";
}

const FALLBACK_EXPLANATION = "Проверьте этот фрагмент: возможно, он расходится с предыдущей главой.";

/**
 * Привязка ответа модели к тексту. Пункт без находимой цитаты выбрасывается:
 * без смещений клик по списку не сможет выделить место в редакторе, а значит
 * такой пункт бесполезен. Цитатой становится сам кусок главы — что выделено,
 * то и показано.
 */
export function collectPlotIssues(chapterText: string, raw: unknown): PlotCheckStats {
  const text = typeof chapterText === "string" ? chapterText : "";
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const collected: PlotCheckIssue[] = [];
  let located = 0;
  let dropped = 0;

  for (const item of list) {
    const candidate: RawPlotIssue = item && typeof item === "object" ? (item as RawPlotIssue) : {};
    const range = locateQuote(text, typeof candidate.quote === "string" ? candidate.quote : "");
    if (!range) {
      dropped += 1;
      continue;
    }
    located += 1;
    const key = `${range.start}:${range.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const explanation = typeof candidate.explanation === "string" ? candidate.explanation.trim() : "";
    collected.push({
      kind: normalizeKind(candidate.kind),
      quote: text.slice(range.start, range.end),
      explanation: explanation || FALLBACK_EXPLANATION,
      start: range.start,
      end: range.end,
    });
  }

  return {
    issues: collected.slice(0, PLOT_CHECK_MAX_ISSUES),
    located,
    dropped,
  };
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Достаём массив пунктов из ответа модели: чистый JSON, ```json-блок или объект с issues. */
function extractIssuesArray(rawResponse: string): unknown[] {
  const text = String(rawResponse || "")
    .replace(/^\s*```(?:json)?/iu, "")
    .replace(/```\s*$/u, "")
    .trim();
  if (!text) throw new Error("Ответ модели пуст");

  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const direct = tryParseJson(text.slice(arrayStart, arrayEnd + 1));
    if (Array.isArray(direct)) return direct;
  }

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    const parsed = tryParseJson(text.slice(objectStart, objectEnd + 1));
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { issues?: unknown }).issues)) {
      return (parsed as { issues: unknown[] }).issues;
    }
  }

  throw new Error("В ответе модели нет списка стыковок");
}

export interface ParsedPlotCheck {
  issues: PlotCheckIssue[];
  truncated: boolean;
  dropped: number;
}

export function parsePlotCheckResponse(rawResponse: string, chapterText: string): ParsedPlotCheck {
  const list = extractIssuesArray(rawResponse);
  const stats = collectPlotIssues(chapterText, list);
  return {
    issues: stats.issues,
    truncated: stats.located > stats.issues.length,
    dropped: stats.dropped,
  };
}

export interface PlotCheckPromptInput {
  chapterTitle?: string;
  text: string;
  previousChapter?: string;
  canonDossier?: string;
}

/** Единственный промпт проверки: модель молчит, если не уверена. */
export function buildPlotCheckPrompt(input: PlotCheckPromptInput): string {
  const chapter = String(input.text || "").trim();
  const previous = String(input.previousChapter || "").trim();
  const dossier = String(input.canonDossier || "").trim();
  const dossierCapped =
    dossier.length > PLOT_CHECK_DOSSIER_LIMIT
      ? `${dossier.slice(0, PLOT_CHECK_DOSSIER_LIMIT)}\n… (материалы обрезаны)`
      : dossier;
  const kindList = PLOT_CHECK_KINDS.map(
    (kind) => `- ${kind}: ${PLOT_CHECK_KIND_LABELS[kind]} — ${PLOT_CHECK_KIND_HINTS[kind]}`,
  ).join("\n");

  return `Вы — внимательный редактор-сюжетник. Вы проверяете ТОЛЬКО смысловые стыковки главы на русском языке. Стиль, орфографию и пунктуацию не разбирайте: их проверяют другие инструменты.

ГЛАВА${input.chapterTitle ? ` «${input.chapterTitle}»` : ""}:
"""
${chapter}
"""

${
    previous
      ? `ПРЕДЫДУЩАЯ ГЛАВА (её конец — то, с чем эта глава должна стыковаться):
"""
${previous}
"""
`
      : "ПРЕДЫДУЩАЯ ГЛАВА не передана.\n"
  }${
    dossierCapped
      ? `МАТЕРИАЛЫ КНИГИ (план, библия мира, герои, правила):
"""
${dossierCapped}
"""
`
      : ""
  }
Ищите только такие нестыковки:
${kindList}

Правила ответа:
1. Цитата — ДОСЛОВНЫЙ кусок из главы выше, 4–20 слов, без кавычек и многоточий по краям. Именно по этой цитате будет найдено место в тексте.
2. Объяснение — одна короткая фраза: что именно не сходится и с чем.
3. Если уверенности нет — НЕ включайте пункт. Пустой список лучше выдуманной нестыковки.
4. Не более ${PLOT_CHECK_MAX_ISSUES} пунктов, самое важное — первым.

Ответ — только JSON-массив, без пояснений и markdown:
[{"kind":"continuity","quote":"дословный кусок главы","explanation":"что не сходится"}]`;
}
