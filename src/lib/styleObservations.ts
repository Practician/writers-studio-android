import {
  ABSTRACT_SUBJECT,
  AI_PHRASES,
  auditStyleSignals,
  compareStyle,
  computeStyleStats,
  wordsOf,
  type CalibratedStyleMetric,
  type StyleSignal,
} from "./authorAudit";

export interface StyleObservation {
  category: string;
  message: string;
  quote: string;
  /** Смещения в главе: клик по наблюдению выделяет место в редакторе. */
  start: number;
  end: number;
  severity: "note" | "warning";
}

export interface StyleReport {
  signals: StyleSignal[];
  observations: StyleObservation[];
  metrics: {
    words: number;
    sentences: number;
    averageSentenceWords: number;
    longSentences: number;
    lexicalRepeats: number;
  };
  calibration: {
    similarity: number;
    weakest: { metric: CalibratedStyleMetric; label: string; score: number }[];
  } | null;
}

export const CALIBRATED_METRIC_LABELS: Record<CalibratedStyleMetric, string> = {
  averageSentenceWords: "длина предложений",
  sentenceLengthDeviation: "разброс длины",
  shortSentenceShare: "доля коротких фраз",
  exclamationsPerThousandWords: "восклицания",
  ellipsesPerThousandWords: "многоточия",
  dialogueLineShare: "доля диалога",
  particlesPerThousandWords: "частицы",
  similesPerThousandWords: "сравнения",
};

// Служебные слова не считаем повтором: они неизбежны в любом тексте.
const REPEAT_STOPWORDS = new Set([
  "это", "этот", "эта", "эти", "его", "её", "ему", "ей", "ею", "их", "они",
  "был", "была", "было", "были", "быть", "есть", "как", "что", "чтобы",
  "когда", "тогда", "если", "себя", "себе", "свой", "свою", "свои", "также",
  "только", "даже", "ещё", "еще", "уже", "опять", "снова", "потом", "теперь",
  "здесь", "там", "него", "неё", "нее", "них", "чем", "кто", "весь", "всё",
  "все", "вся", "один", "одна", "одно", "очень", "просто", "через", "между",
  "перед", "после", "около", "почти", "можно", "нужно", "надо", "будет",
]);

const LONG_SENTENCE_WORDS = 45;
const MAX_OBSERVATIONS = 40;

interface SentenceSpan {
  start: number;
  end: number;
  text: string;
}

/** Разбиение на предложения с сохранением смещений в исходном тексте. */
export function sentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const boundary = /[.!?…]+(?=\s|$)|\n+/gu;
  let cursor = 0;

  const push = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const lead = raw.length - raw.replace(/^\s*(?:[—–-]\s*)?/u, "").length;
    const trimmed = raw.slice(lead).replace(/\s+$/u, "");
    if (!trimmed) return;
    const start = from + lead;
    spans.push({ start, end: start + trimmed.length, text: trimmed });
  };

  for (const match of text.matchAll(boundary)) {
    const index = match.index ?? 0;
    // Знак конца предложения входит в само предложение: без него цитата
    // и смещения наблюдений обрезались бы на последнем слове.
    push(cursor, index + match[0].length);
    cursor = index + match[0].length;
  }
  push(cursor, text.length);

  return spans;
}

function collectRanged(text: string, pattern: RegExp, category: string, message: string, severity: "note" | "warning"): StyleObservation[] {
  const found: StyleObservation[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    found.push({ category, message, quote: match[0], start, end: start + match[0].length, severity });
  }
  return found;
}

function findPhraseOccurrences(text: string): StyleObservation[] {
  const lower = text.toLowerCase();
  const found: StyleObservation[] = [];
  for (const phrase of AI_PHRASES) {
    let from = 0;
    for (;;) {
      const index = lower.indexOf(phrase, from);
      if (index === -1) break;
      found.push({
        category: "Шаблонные обороты",
        message: "Предсказуемая формула. Проверяйте контекст, а не заменяйте автоматически.",
        quote: text.slice(index, index + phrase.length),
        start: index,
        end: index + phrase.length,
        severity: "warning",
      });
      from = index + phrase.length;
    }
  }
  return found;
}

function findLexicalRepeats(spans: SentenceSpan[]): StyleObservation[] {
  const found: StyleObservation[] = [];
  for (let index = 1; index < spans.length && found.length < MAX_OBSERVATIONS; index += 1) {
    const previous = spans[index - 1];
    const current = spans[index];
    const previousWords = new Set(
      wordsOf(previous.text)
        .map((word) => word.toLowerCase())
        .filter((word) => word.length >= 4 && !REPEAT_STOPWORDS.has(word)),
    );
    if (!previousWords.size) continue;
    const seen = new Set<string>();
    for (const word of wordsOf(current.text)) {
      const key = word.toLowerCase();
      if (!previousWords.has(key) || seen.has(key)) continue;
      seen.add(key);
      const offset = current.text.toLowerCase().indexOf(key);
      if (offset === -1) continue;
      const start = current.start + offset;
      found.push({
        category: "Повтор слова",
        message: `Слово повторяется в двух соседних предложениях: «${word}».`,
        quote: word,
        start,
        end: start + word.length,
        severity: "note",
      });
    }
  }
  return found;
}

/**
 * Локальный разбор стиля: 0 токенов, только уже написанная статистика плюс
 * повторы слов и слишком длинные предложения, которых она не видит.
 */
export function buildStyleReport(text: string, reference?: string): StyleReport {
  const stats = computeStyleStats(text);
  const spans = sentenceSpans(text);
  const observations: StyleObservation[] = [
    ...findPhraseOccurrences(text),
    ...collectRanged(
      text,
      new RegExp(ABSTRACT_SUBJECT.source, "giu"),
      "Абстрактные действующие лица",
      "Чувство или среда действует вместо героя.",
      "note",
    ),
    ...findLexicalRepeats(spans),
  ];

  for (const span of spans) {
    if (wordsOf(span.text).length <= LONG_SENTENCE_WORDS) continue;
    observations.push({
      category: "Длинное предложение",
      message: `Предложений длиннее ${LONG_SENTENCE_WORDS} слов трудно читать вслух.`,
      quote: span.text.slice(0, 60) + (span.text.length > 60 ? "…" : ""),
      start: span.start,
      end: span.end,
      severity: "note",
    });
  }

  const calibration =
    reference && reference.trim().length >= 120
      ? (() => {
          const comparison = compareStyle(reference, text);
          return {
            similarity: comparison.similarity,
            weakest: comparison.weakestMetrics.map((metric) => ({
              metric,
              label: CALIBRATED_METRIC_LABELS[metric],
              score: comparison.metricScores[metric],
            })),
          };
        })()
      : null;

  return {
    signals: auditStyleSignals(text),
    observations: observations
      .sort((left, right) => left.start - right.start)
      .slice(0, MAX_OBSERVATIONS),
    metrics: {
      words: stats.words,
      sentences: stats.sentences,
      averageSentenceWords: Math.round(stats.averageSentenceWords * 10) / 10,
      longSentences: observations.filter((item) => item.category === "Длинное предложение").length,
      lexicalRepeats: observations.filter((item) => item.category === "Повтор слова").length,
    },
    calibration,
  };
}
