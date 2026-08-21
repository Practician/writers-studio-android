export interface StyleStats {
  words: number;
  sentences: number;
  averageSentenceWords: number;
  sentenceLengthDeviation: number;
  shortSentenceShare: number;
  exclamationsPerThousandWords: number;
  ellipsesPerThousandWords: number;
  dialogueLineShare: number;
  particlesPerThousandWords: number;
  similesPerThousandWords: number;
}

export interface StyleSignal {
  category: string;
  message: string;
  count: number;
  severity: "note" | "warning";
}

export type CalibratedStyleMetric =
  | "averageSentenceWords"
  | "sentenceLengthDeviation"
  | "shortSentenceShare"
  | "exclamationsPerThousandWords"
  | "ellipsesPerThousandWords"
  | "dialogueLineShare"
  | "particlesPerThousandWords"
  | "similesPerThousandWords";

export interface CalibratedStyleResult {
  expected: StyleStats;
  actual: StyleStats;
  /** 100 = совпадение с подтверждённым человеческим эталоном по измеримому голосу. */
  similarity: number;
  metricScores: Record<CalibratedStyleMetric, number>;
  weakestMetrics: CalibratedStyleMetric[];
}

const PARTICLES = new Set(["же", "ведь", "вот", "ну", "однако", "чтож"]);
const AI_PHRASES = [
  "не просто",
  "словно нехотя",
  "с пугающей скоростью",
  "густая и равнодушная",
  "прорвала плотину",
  "в тот самый момент",
  "не мог ошибиться",
  "перед лицом",
];
const ABSTRACT_SUBJECT = /(?:^|[.!?]\s+)(паника|тишина|темнота|пустота|одиночество|ярость|страх|жажда|судьба)\s+(?:медленно\s+)?(?:полз|нав|накр|поглот|захлест|душ|тян|дав|вытесн)/giu;

export function wordsOf(text: string): string[] {
  return text.match(/[а-яёa-z0-9]+(?:-[а-яёa-z0-9]+)?/giu) || [];
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim().replace(/^[—–-]\s*/, ""))
    .filter(Boolean);
}

function standardDeviation(values: number[]): number {
  if (!values.length) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

export function computeStyleStats(text: string): StyleStats {
  const words = wordsOf(text);
  const sentences = splitSentences(text);
  const sentenceLengths = sentences.map((sentence) => wordsOf(sentence).length).filter(Boolean);
  const averageSentenceWords = sentenceLengths.length
    ? sentenceLengths.reduce((sum, value) => sum + value, 0) / sentenceLengths.length
    : 0;
  const lines = text.split(/\r?\n/u).filter((line) => line.trim());
  const dialogueLines = lines.filter((line) => /^\s*[—–-]\s/u.test(line)).length;
  const lowerWords = words.map((word) => word.toLowerCase());
  const particleCount = lowerWords.filter((word) => PARTICLES.has(word)).length;
  const simileCount = (text.match(/\b(?:будто|словно|точно|как будто)\b/giu) || []).length;
  const ellipsisCount = (text.match(/(?:\.\.\.|…)/gu) || []).length;
  const denominator = Math.max(words.length, 1);

  return {
    words: words.length,
    sentences: sentences.length,
    averageSentenceWords,
    sentenceLengthDeviation: standardDeviation(sentenceLengths),
    shortSentenceShare: sentenceLengths.length
      ? sentenceLengths.filter((value) => value <= 4).length / sentenceLengths.length
      : 0,
    exclamationsPerThousandWords: (text.match(/!/gu) || []).length * 1000 / denominator,
    ellipsesPerThousandWords: ellipsisCount * 1000 / denominator,
    dialogueLineShare: lines.length ? dialogueLines / lines.length : 0,
    particlesPerThousandWords: particleCount * 1000 / denominator,
    similesPerThousandWords: simileCount * 1000 / denominator,
  };
}

export function auditStyleSignals(text: string): StyleSignal[] {
  const signals: StyleSignal[] = [];
  const lower = text.toLowerCase();
  const phraseHits = AI_PHRASES.reduce((sum, phrase) => sum + lower.split(phrase).length - 1, 0);
  if (phraseHits) {
    signals.push({
      category: "Шаблонные обороты",
      message: "Найдены предсказуемые формулы. Проверяйте контекст, а не заменяйте их автоматически.",
      count: phraseHits,
      severity: "warning",
    });
  }

  const personificationHits = (text.match(ABSTRACT_SUBJECT) || []).length;
  if (personificationHits) {
    signals.push({
      category: "Абстрактные действующие лица",
      message: "Чувство или среда действует вместо героя; часть мест может звучать обезличенно.",
      count: personificationHits,
      severity: "note",
    });
  }

  const sentences = splitSentences(text);
  let shortRunCount = 0;
  let run = 0;
  for (const sentence of sentences) {
    if (wordsOf(sentence).length <= 4) {
      run += 1;
      if (run === 3) shortRunCount += 1;
    } else {
      run = 0;
    }
  }
  if (shortRunCount) {
    signals.push({
      category: "Метроном коротких фраз",
      message: "Три и более коротких предложения подряд могут создавать искусственный ритм.",
      count: shortRunCount,
      severity: "note",
    });
  }

  const openings = new Map<string, number>();
  for (const sentence of sentences) {
    const first = wordsOf(sentence)[0]?.toLowerCase();
    if (first && !/^\d+$/u.test(first)) openings.set(first, (openings.get(first) || 0) + 1);
  }
  const repeatedOpenings = [...openings.values()].filter((count) => count >= 4).reduce((sum, count) => sum + count, 0);
  if (repeatedOpenings) {
    signals.push({
      category: "Повтор зачина",
      message: "Много предложений начинается одинаково. Это диагностический сигнал, не ошибка сам по себе.",
      count: repeatedOpenings,
      severity: "note",
    });
  }

  return signals;
}

export function compareStyle(reference: string, candidate: string): CalibratedStyleResult {
  const expected = computeStyleStats(reference);
  const actual = computeStyleStats(candidate);
  const fields: CalibratedStyleMetric[] = [
      "averageSentenceWords",
      "sentenceLengthDeviation",
      "shortSentenceShare",
      "exclamationsPerThousandWords",
      "ellipsesPerThousandWords",
      "dialogueLineShare",
      "particlesPerThousandWords",
    "similesPerThousandWords",
  ];
  // Статистика одного и того же живого автора заметно плавает от сцены к сцене.
  // Сравниваем не с точкой, а с коридором вокруг подтверждённого HUMAN-эталона.
  const tolerance: Record<CalibratedStyleMetric, number> = {
    averageSentenceWords: 0.2,
    sentenceLengthDeviation: 0.35,
    shortSentenceShare: 0.4,
    exclamationsPerThousandWords: 0.2,
    ellipsesPerThousandWords: 0.4,
    dialogueLineShare: 0.25,
    particlesPerThousandWords: 0.2,
    similesPerThousandWords: 0.2,
  };
  const deviations = fields.map((field) => {
    const baseline = Math.max(Math.abs(expected[field]), field.includes("Share") ? 0.05 : 1);
    const raw = Math.abs(actual[field] - expected[field]) / baseline;
    const allowed = tolerance[field];
    return Math.min(1, Math.max(0, raw - allowed) / (1 - allowed));
  });
  const metricScores = Object.fromEntries(
    fields.map((field, index) => [field, Math.round(100 * (1 - deviations[index]))]),
  ) as Record<CalibratedStyleMetric, number>;
  const similarity = Math.round(100 * (1 - deviations.reduce((sum, value) => sum + value, 0) / deviations.length));
  const weakestMetrics = [...fields]
    .sort((left, right) => metricScores[left] - metricScores[right])
    .slice(0, 3);
  return { expected, actual, similarity, metricScores, weakestMetrics };
}

export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
