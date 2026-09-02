import { computeStyleStats, hashText, wordsOf } from "./authorAudit";
import { DetectorReport } from "./detectorReport";
import { aiTellScore } from "../../server/humanStyle";
import { LABYRINTH_ADAPTIVE_DETECTOR_SEED } from "../data/labyrinth/adaptive-detector-seed";

const STORAGE_PREFIX = "writers-studio-adaptive-detector-v1:";
const MAX_REPORT_HASHES = 100;
const MIN_SEGMENT_WORDS = 25;

export const ADAPTIVE_FEATURES = [
  "averageSentenceWords",
  "sentenceLengthDeviation",
  "shortSentenceShare",
  "exclamationsPerThousandWords",
  "ellipsesPerThousandWords",
  "dialogueLineShare",
  "particlesPerThousandWords",
  "similesPerThousandWords",
] as const;

export type AdaptiveFeature = typeof ADAPTIVE_FEATURES[number];
export type AdaptiveClass = "human" | "ai";
export type FeatureVector = Record<AdaptiveFeature, number>;

export interface AdaptiveCentroid {
  count: number;
  mean: FeatureVector;
  m2: FeatureVector;
}

/** Веса fusion: style-adaptive (Яндекс-сегменты) + локальный aiTell (штампы). */
export interface AdaptiveFusionConfig {
  /** Доля style-adaptive в итоговом HUMAN% (0…1). Остальное — из (100 − aiTell). */
  adaptiveWeight: number;
  /** Порог HUMAN (по умолчанию 50). */
  humanThreshold: number;
  /** Источник калибровки (для UI). */
  source?: string;
  calibratedAt?: string;
  /** LOO accuracy на сегментах Яндекса при калибровке. */
  looAccuracy?: number;
}

export interface AdaptiveDetectorProfile {
  version: 1 | 2;
  storyId: string;
  updatedAt: number;
  reportHashes: string[];
  human: AdaptiveCentroid;
  ai: AdaptiveCentroid;
  fusion?: AdaptiveFusionConfig;
}

export interface AdaptiveLearningResult {
  profile: AdaptiveDetectorProfile;
  duplicate: boolean;
  learnedHuman: number;
  learnedAi: number;
  ignored: number;
}

export interface AdaptiveScore {
  humanProbability: number;
  confidence: number;
  humanDistance: number;
  aiDistance: number;
  humanExamples: number;
  aiExamples: number;
}

export interface CalibratedLocalScore extends AdaptiveScore {
  /** Итог после fusion с aiTell (калибровка под Яндекс). */
  calibratedHumanProbability: number;
  adaptiveHumanProbability: number;
  aiTellScore: number;
  aiTellBurstiness: number;
  fusionWeight: number;
  predictedLabel: "HUMAN" | "AI";
}

function zeroVector(): FeatureVector {
  return Object.fromEntries(ADAPTIVE_FEATURES.map((feature) => [feature, 0])) as FeatureVector;
}

function emptyCentroid(): AdaptiveCentroid {
  return { count: 0, mean: zeroVector(), m2: zeroVector() };
}

export function createAdaptiveProfile(storyId: string): AdaptiveDetectorProfile {
  return {
    version: 2,
    storyId,
    updatedAt: Date.now(),
    reportHashes: [],
    human: emptyCentroid(),
    ai: emptyCentroid(),
  };
}

/** Fixed scales keep the first few reports stable; learned variance is added once enough examples exist. */
const FEATURE_SCALES: FeatureVector = {
  averageSentenceWords: 6,
  sentenceLengthDeviation: 5,
  shortSentenceShare: 0.2,
  exclamationsPerThousandWords: 5,
  ellipsesPerThousandWords: 5,
  dialogueLineShare: 0.25,
  particlesPerThousandWords: 5,
  similesPerThousandWords: 4,
};

export function extractAdaptiveFeatures(text: string): FeatureVector {
  const stats = computeStyleStats(text);
  return Object.fromEntries(ADAPTIVE_FEATURES.map((feature) => [feature, stats[feature]])) as FeatureVector;
}

function addObservation(centroid: AdaptiveCentroid, observation: FeatureVector): AdaptiveCentroid {
  const count = centroid.count + 1;
  const mean = { ...centroid.mean };
  const m2 = { ...centroid.m2 };
  for (const feature of ADAPTIVE_FEATURES) {
    const delta = observation[feature] - centroid.mean[feature];
    mean[feature] = centroid.mean[feature] + delta / count;
    m2[feature] = centroid.m2[feature] + delta * (observation[feature] - mean[feature]);
  }
  return { count, mean, m2 };
}

function reportFingerprint(report: DetectorReport): string {
  return hashText(report.segments.map((segment) => `${segment.label}:${segment.text}`).join("\u241e"));
}

export function learnFromDetectorReport(
  current: AdaptiveDetectorProfile,
  report: DetectorReport,
): AdaptiveLearningResult {
  const fingerprint = reportFingerprint(report);
  if (current.reportHashes.includes(fingerprint)) {
    return { profile: current, duplicate: true, learnedHuman: 0, learnedAi: 0, ignored: 0 };
  }

  let human = current.human;
  let ai = current.ai;
  let learnedHuman = 0;
  let learnedAi = 0;
  let ignored = 0;
  for (const segment of report.segments) {
    const label: AdaptiveClass | null = segment.label === "HUMAN" || segment.label === "LIKELY_HUMAN"
      ? "human"
      : segment.label === "AI" || segment.label === "LIKELY_AI"
        ? "ai"
        : null;
    if (!label || wordsOf(segment.text).length < MIN_SEGMENT_WORDS) {
      ignored += 1;
      continue;
    }
    const features = extractAdaptiveFeatures(segment.text);
    if (label === "human") {
      human = addObservation(human, features);
      learnedHuman += 1;
    } else {
      ai = addObservation(ai, features);
      learnedAi += 1;
    }
  }

  return {
    duplicate: false,
    learnedHuman,
    learnedAi,
    ignored,
    profile: {
      ...current,
      updatedAt: Date.now(),
      reportHashes: [...current.reportHashes, fingerprint].slice(-MAX_REPORT_HASHES),
      human,
      ai,
    },
  };
}

function distance(vector: FeatureVector, own: AdaptiveCentroid, other: AdaptiveCentroid): number {
  const total = ADAPTIVE_FEATURES.reduce((sum, feature) => {
    const ownVariance = own.count > 1 ? own.m2[feature] / (own.count - 1) : 0;
    const otherVariance = other.count > 1 ? other.m2[feature] / (other.count - 1) : 0;
    const scale = Math.max(FEATURE_SCALES[feature] ** 2, (ownVariance + otherVariance) / 2);
    return sum + ((vector[feature] - own.mean[feature]) ** 2) / scale;
  }, 0);
  return Math.sqrt(total / ADAPTIVE_FEATURES.length);
}

export function scoreWithAdaptiveProfile(text: string, profile: AdaptiveDetectorProfile): AdaptiveScore | null {
  if (!text.trim() || profile.human.count < 1 || profile.ai.count < 1) return null;
  const features = extractAdaptiveFeatures(text);
  const humanDistance = distance(features, profile.human, profile.ai);
  const aiDistance = distance(features, profile.ai, profile.human);
  const probability = 1 / (1 + Math.exp(-2.2 * (aiDistance - humanDistance)));
  const confidence = Math.min(0.95, 0.25 + Math.log2(1 + Math.min(profile.human.count, profile.ai.count)) / 5);
  return {
    humanProbability: Math.round(probability * 100),
    confidence: Math.round(confidence * 100),
    humanDistance,
    aiDistance,
    humanExamples: profile.human.count,
    aiExamples: profile.ai.count,
  };
}

export const DEFAULT_FUSION: AdaptiveFusionConfig = {
  adaptiveWeight: 0.45,
  humanThreshold: 50,
  source: "default",
};

/** aiTell 0…100 (выше = больше «ИИ») → HUMAN% 100…0 */
export function humanProbabilityFromAiTell(score: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  // Мягкая кривая: score 0 → 100, 12 → ~78, 30 → ~48, 60 → ~18
  return Math.round(100 / (1 + Math.exp((clamped - 22) / 10)));
}

/**
 * Локальный детектор, откалиброванный под Яндекс:
 * style-centroid (сегменты HUMAN/AI из отчётов) + каталог штампов aiTell.
 */
export function scoreCalibratedLocalDetector(
  text: string,
  profile: AdaptiveDetectorProfile,
): CalibratedLocalScore | null {
  const adaptive = scoreWithAdaptiveProfile(text, profile);
  if (!adaptive) return null;
  const tell = aiTellScore(text);
  const fusion = profile.fusion ?? DEFAULT_FUSION;
  const w = Math.max(0, Math.min(1, fusion.adaptiveWeight));
  const fromTell = humanProbabilityFromAiTell(tell.score);
  const calibrated = Math.round(w * adaptive.humanProbability + (1 - w) * fromTell);
  const threshold = fusion.humanThreshold ?? 50;
  return {
    ...adaptive,
    calibratedHumanProbability: calibrated,
    adaptiveHumanProbability: adaptive.humanProbability,
    aiTellScore: tell.score,
    aiTellBurstiness: tell.burstiness,
    fusionWeight: w,
    predictedLabel: calibrated >= threshold ? "HUMAN" : "AI",
  };
}

/** Подбор adaptiveWeight по размеченным сегментам (максимум accuracy). */
export function fitFusionWeight(
  samples: Array<{ text: string; human: boolean }>,
  profile: AdaptiveDetectorProfile,
): AdaptiveFusionConfig {
  let bestW = DEFAULT_FUSION.adaptiveWeight;
  let bestAcc = -1;
  let bestThreshold = 50;
  for (let w = 0; w <= 100; w += 5) {
    const weight = w / 100;
    for (const threshold of [45, 50, 55]) {
      let ok = 0;
      for (const sample of samples) {
        const adaptive = scoreWithAdaptiveProfile(sample.text, profile);
        if (!adaptive) continue;
        const tell = aiTellScore(sample.text);
        const fromTell = humanProbabilityFromAiTell(tell.score);
        const calibrated = weight * adaptive.humanProbability + (1 - weight) * fromTell;
        const predHuman = calibrated >= threshold;
        if (predHuman === sample.human) ok += 1;
      }
      const acc = samples.length ? ok / samples.length : 0;
      if (acc > bestAcc) {
        bestAcc = acc;
        bestW = weight;
        bestThreshold = threshold;
      }
    }
  }
  return {
    adaptiveWeight: bestW,
    humanThreshold: bestThreshold,
    source: "yandex-loo-fit",
    calibratedAt: new Date().toISOString(),
    looAccuracy: bestAcc,
  };
}

function range(value: number, spread: number, digits = 1): string {
  const low = Math.max(0, value - spread).toFixed(digits);
  const high = (value + spread).toFixed(digits);
  return `${low}–${high}`;
}

/** Turns verified HUMAN statistics into soft writing constraints. It contains no source prose or plot data. */
export function buildAdaptiveWritingGuidance(profile: AdaptiveDetectorProfile): string {
  if (profile.human.count < 1) return "";
  const human = profile.human.mean;
  const lines = [
    "АДАПТИВНЫЙ ПРОФИЛЬ ПОДТВЕРЖДЁННЫХ HUMAN-СЕГМЕНТОВ:",
    "Используй эти значения как живые диапазоны на уровне сцены, а не как квоты для каждого абзаца.",
    `- Средняя длина предложения: ${range(human.averageSentenceWords, 2)} слова; разброс длины: ${range(human.sentenceLengthDeviation, 2)}.`,
    `- Доля коротких предложений: ${range(human.shortSentenceShare * 100, 7, 0)}%; не собирай их в механические серии.`,
    `- Доля строк диалога: ${range(human.dialogueLineShare * 100, 8, 0)}%.`,
    `- На 1000 слов: частицы ${range(human.particlesPerThousandWords, 2)}, многоточия ${range(human.ellipsesPerThousandWords, 2)}, восклицания ${range(human.exclamationsPerThousandWords, 2)}, сравнения ${range(human.similesPerThousandWords, 2)}.`,
    "Сохраняй причинность, конкретные бытовые действия, неполную осведомлённость героя и естественные неровности ритма.",
  ];
  if (profile.ai.count > 0) {
    const ai = profile.ai.mean;
    const contrasts: string[] = [];
    if (ai.shortSentenceShare > human.shortSentenceShare + 0.08) contrasts.push("серий одинаково коротких фраз");
    if (ai.similesPerThousandWords > human.similesPerThousandWords + 2) contrasts.push("плотных декоративных сравнений");
    if (ai.ellipsesPerThousandWords > human.ellipsesPerThousandWords + 2) contrasts.push("частых многоточий");
    if (ai.exclamationsPerThousandWords > human.exclamationsPerThousandWords + 2) contrasts.push("избыточных восклицаний");
    if (contrasts.length) lines.push(`По отрицательным AI-примерам особенно избегай: ${contrasts.join(", ")}.`);
    lines.push("Не копируй усреднённый рисунок отрицательных AI-сегментов; при конфликте ориентируйся на HUMAN-профиль и авторский образец.");
  }
  lines.push(`Основание профиля: HUMAN ${profile.human.count}, AI ${profile.ai.count}.`);
  return lines.join("\n");
}

function isValidProfile(value: unknown, storyId: string): value is AdaptiveDetectorProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<AdaptiveDetectorProfile>;
  const versionOk = profile.version === 1 || profile.version === 2;
  return versionOk && profile.storyId === storyId && Array.isArray(profile.reportHashes)
    && Boolean(profile.human && profile.ai)
    && typeof profile.human?.count === "number" && typeof profile.ai?.count === "number";
}

/** Seed Яндекс-калибровки для «Лабиринт». */
function labyrinthSeedProfile(storyId: string): AdaptiveDetectorProfile | null {
  const seed = LABYRINTH_ADAPTIVE_DETECTOR_SEED;
  if (!seed || seed.storyId !== storyId || !isValidProfile(seed, seed.storyId)) return null;
  return {
    ...seed,
    human: { ...seed.human, mean: { ...seed.human.mean }, m2: { ...seed.human.m2 } },
    ai: { ...seed.ai, mean: { ...seed.ai.mean }, m2: { ...seed.ai.m2 } },
    reportHashes: [...seed.reportHashes],
    fusion: seed.fusion ? { ...seed.fusion } : undefined,
  };
}

export function resolveSeedAdaptiveProfile(storyId: string): AdaptiveDetectorProfile | null {
  return labyrinthSeedProfile(storyId);
}

export function loadAdaptiveProfile(storyId: string): AdaptiveDetectorProfile {
  const seed = resolveSeedAdaptiveProfile(storyId);

  if (typeof localStorage !== "undefined") {
    try {
      const parsed = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${storyId}`) || "null");
      if (isValidProfile(parsed, storyId)) {
        // Пустой user-профиль → подставить seed (калибровка Яндекса)
        if ((parsed.human.count + parsed.ai.count) === 0 && seed) {
          return seed;
        }
        // Есть user-данные, но нет fusion → унаследовать веса из seed
        if (!parsed.fusion && seed?.fusion) {
          return { ...parsed, version: 2, fusion: { ...seed.fusion } };
        }
        return parsed;
      }
    } catch {
      /* fall through */
    }
  }

  if (seed) return seed;
  return createAdaptiveProfile(storyId);
}

export function saveAdaptiveProfile(profile: AdaptiveDetectorProfile): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`${STORAGE_PREFIX}${profile.storyId}`, JSON.stringify(profile));
}

export function resetAdaptiveProfile(storyId: string): AdaptiveDetectorProfile {
  if (typeof localStorage !== "undefined") localStorage.removeItem(`${STORAGE_PREFIX}${storyId}`);
  return resolveSeedAdaptiveProfile(storyId) ?? createAdaptiveProfile(storyId);
}

// ─────────────────────────────────────────────────────────────────────────────
// РАСШИРЕННЫЙ АДАПТИВНЫЙ ДЕТЕКТОР v2 (12-МЕРНЫЙ)
// Re-export из adaptiveDetectorEnhanced.ts
// ─────────────────────────────────────────────────────────────────────────────
export {
  EXTENDED_FEATURES,
  EXTENDED_SCALES,
  emptyExtendedCentroid,
  addExtendedObservation,
  mahalanobisDistance,
  aggregateImplicitFeedback,
  mergeWithDonorProfile,
  computeEnsembleScore,
  DETECTOR_V2,
  type ExtendedFeature,
  type ExtendedVector,
  type ExtendedCentroid,
  type ImplicitFeedbackRecord,
  type FeedbackAggregation,
  type CrossChapterTransferConfig,
  type EnsembleScore,
} from "./adaptiveDetectorEnhanced";
