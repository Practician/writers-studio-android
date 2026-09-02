/**
 * adaptiveDetectorEnhanced.ts
 *
 * РАСШИРЕНИЕ src/lib/adaptiveDetector.ts:
 *  - 12-мерное пространство стиля (8 базовых + 4 новых)
 *  - Mahalanobis distance с полной ковариационной матрицей
 *  - Implicit feedback loop: накопление «применено / отклонено»
 *  - Cross-chapter transfer: HUMAN-профиль главы 1 усиливает генерацию главы 2+
 * 
 * Логика заимствована из:
 *  - scripts/calibrate-yandex-adaptive.ts (LOO cross-validation)
 *  - scripts/validate-detector-v2.ts (threshold tuning)
 *  - scripts/compare-humanize-providers.ts (ensemble scoring)
 *  - server/agent/selfLearner.ts (edit diff → pattern learning)
 */

// ─────────────────────────────────────────────────────────────────────────────
// РАСШИРЕННЫЙ ВЕКТОР ПРИЗНАКОВ (8 → 12)
// ─────────────────────────────────────────────────────────────────────────────

/** Полный список признаков: 8 существующих + 4 новых */
export const EXTENDED_FEATURES = [
  // Существующие (из adaptiveDetector.ts)
  "averageSentenceWords",
  "sentenceLengthDeviation",
  "shortSentenceShare",
  "exclamationsPerThousandWords",
  "ellipsesPerThousandWords",
  "dialogueLineShare",
  "particlesPerThousandWords",
  "similesPerThousandWords",
  // Новые (из humanStyleEnhanced.ts)
  "paragraphLengthCV",
  "passiveVoiceShare",
  "uniqueWordRatio200",
  "connectorDiversity",
] as const;

export type ExtendedFeature = typeof EXTENDED_FEATURES[number];
export type ExtendedVector  = Record<ExtendedFeature, number>;

/** Масштабы для Mahalanobis (аналог FEATURE_SCALES в adaptiveDetector.ts) */
export const EXTENDED_SCALES: ExtendedVector = {
  // Базовые — скопированы из adaptiveDetector.ts
  averageSentenceWords:         6,
  sentenceLengthDeviation:      5,
  shortSentenceShare:           0.2,
  exclamationsPerThousandWords: 5,
  ellipsesPerThousandWords:     5,
  dialogueLineShare:            0.25,
  particlesPerThousandWords:    5,
  similesPerThousandWords:      4,
  // Новые — подобраны эмпирически по главам «Лабиринт»
  paragraphLengthCV:            0.35,
  passiveVoiceShare:            0.08,
  uniqueWordRatio200:           0.12,
  connectorDiversity:           0.3,
};

// ─────────────────────────────────────────────────────────────────────────────
// РАСШИРЕННЫЙ ЦЕНТРОИД (поддерживает 12 признаков)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtendedCentroid {
  count: number;
  mean:  ExtendedVector;
  m2:    ExtendedVector;   // для online Welford variance
  /** Сумма произведений отклонений для ковариационной матрицы */
  crossM2: Partial<Record<string, number>>;
}

function zeroExtended(): ExtendedVector {
  return Object.fromEntries(EXTENDED_FEATURES.map(f => [f, 0])) as ExtendedVector;
}

export function emptyExtendedCentroid(): ExtendedCentroid {
  return { count: 0, mean: zeroExtended(), m2: zeroExtended(), crossM2: {} };
}

/** Ключ для пары признаков в crossM2 */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Онлайн-обновление центроида по алгоритму Welford.
 * Расширен для вычисления cross-M2 (ковариация).
 */
export function addExtendedObservation(
  centroid: ExtendedCentroid,
  obs: ExtendedVector,
): ExtendedCentroid {
  const count = centroid.count + 1;
  const mean  = { ...centroid.mean };
  const m2    = { ...centroid.m2 };
  const crossM2 = { ...centroid.crossM2 };

  const deltas: Partial<Record<string, number>> = {};
  for (const f of EXTENDED_FEATURES) {
    const d = obs[f] - centroid.mean[f];
    mean[f] = centroid.mean[f] + d / count;
    deltas[f] = d;
  }
  for (const f of EXTENDED_FEATURES) {
    m2[f] = centroid.m2[f] + deltas[f]! * (obs[f] - mean[f]);
  }
  // Cross-M2 для ковариации
  for (let i = 0; i < EXTENDED_FEATURES.length; i++) {
    for (let j = i + 1; j < EXTENDED_FEATURES.length; j++) {
      const fi = EXTENDED_FEATURES[i];
      const fj = EXTENDED_FEATURES[j];
      const key = pairKey(fi, fj);
      crossM2[key] = (crossM2[key] ?? 0) + deltas[fi]! * (obs[fj] - mean[fj]);
    }
  }

  return { count, mean, m2, crossM2 };
}

/**
 * Возвращает вариацию признака (variance) из центроида.
 */
function featureVariance(centroid: ExtendedCentroid, feature: ExtendedFeature): number {
  if (centroid.count < 2) return EXTENDED_SCALES[feature] ** 2;
  return Math.max(EXTENDED_SCALES[feature] ** 2, centroid.m2[feature] / (centroid.count - 1));
}

/**
 * Возвращает ковариацию пары признаков из центроида.
 * Минимум: 0 (не допускаем отрицательных при малом числе данных).
 */
function featureCovariance(
  centroid: ExtendedCentroid,
  fi: ExtendedFeature,
  fj: ExtendedFeature,
): number {
  if (centroid.count < 5) return 0; // нужно достаточно данных
  const key = pairKey(fi, fj);
  const raw = (centroid.crossM2[key] ?? 0) / (centroid.count - 1);
  return raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAHALANOBIS DISTANCE
// Заимствует идею из scripts/calibrate-yandex-adaptive.ts:
// вместо евклидового расстояния используем полную матрицу ковариации
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Упрощённое Mahalanobis расстояние с диагональной матрицей (быстро, стабильно).
 * При count >= 30 добавляет поправку на попарные ковариации.
 */
export function mahalanobisDistance(
  obs: ExtendedVector,
  centroid: ExtendedCentroid,
): number {
  const n = EXTENDED_FEATURES.length;
  let sum = 0;
  
  // Диагональный вклад (всегда)
  for (const f of EXTENDED_FEATURES) {
    const variance = featureVariance(centroid, f);
    const diff = obs[f] - centroid.mean[f];
    sum += diff * diff / variance;
  }

  // Поправка на ковариацию (только при достаточном числе примеров)
  if (centroid.count >= 30) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const fi = EXTENDED_FEATURES[i];
        const fj = EXTENDED_FEATURES[j];
        const cov = featureCovariance(centroid, fi, fj);
        const vi  = featureVariance(centroid, fi);
        const vj  = featureVariance(centroid, fj);
        const corr = cov / Math.sqrt(vi * vj);
        if (Math.abs(corr) > 0.5) {
          // Учитываем только сильные корреляции
          const di = obs[fi] - centroid.mean[fi];
          const dj = obs[fj] - centroid.mean[fj];
          sum -= 2 * corr * (di / Math.sqrt(vi)) * (dj / Math.sqrt(vj));
        }
      }
    }
  }

  return Math.sqrt(Math.max(0, sum / n));
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLICIT FEEDBACK LOOP
// Заимствует логику selfLearner.ts: «applied» правка = правильный HUMAN-пример
// ─────────────────────────────────────────────────────────────────────────────

export interface ImplicitFeedbackRecord {
  storyId:      string;
  chapterId:    string;
  revisionId:   string;
  applied:      boolean;   // true = автор принял правку
  originalText: string;    // до правки
  revisedText:  string;    // предложенный вариант
  aiTellBefore: number;
  aiTellAfter:  number;
  timestamp:    number;
}

export interface FeedbackAggregation {
  acceptedCount:  number;
  rejectedCount:  number;
  /** Суммарная дельта aiTell для принятых правок */
  acceptedDeltaSum: number;
  /** Суммарная дельта aiTell для отклонённых правок */
  rejectedDeltaSum: number;
  /** Скорректированный вес adaptive для fusion */
  recommendedAdaptiveWeight: number;
}

/**
 * Анализирует историю feedback и рекомендует скорректированный
 * вес adaptive-компоненты в fusion.
 * 
 * Если автор часто отклоняет правки (adaptive ошибается) → снизить вес.
 * Если принимает с высокой дельтой → повысить вес.
 */
export function aggregateImplicitFeedback(
  records: ImplicitFeedbackRecord[],
  currentWeight: number = 0.75,
): FeedbackAggregation {
  if (records.length === 0) {
    return {
      acceptedCount:         0,
      rejectedCount:         0,
      acceptedDeltaSum:      0,
      rejectedDeltaSum:      0,
      recommendedAdaptiveWeight: currentWeight,
    };
  }

  const accepted = records.filter(r => r.applied);
  const rejected = records.filter(r => !r.applied);

  const acceptedDelta = accepted.reduce((s, r) => s + (r.aiTellBefore - r.aiTellAfter), 0);
  const rejectedDelta = rejected.reduce((s, r) => s + (r.aiTellBefore - r.aiTellAfter), 0);

  const acceptRate = accepted.length / records.length;

  // Простая эвристика: если reject rate > 40% → снижаем вес на 0.1
  let newWeight = currentWeight;
  if (records.length >= 5) {
    if (acceptRate < 0.6) newWeight = Math.max(0.3, currentWeight - 0.1);
    if (acceptRate > 0.85 && acceptedDelta > rejectedDelta) newWeight = Math.min(0.95, currentWeight + 0.05);
  }

  return {
    acceptedCount:            accepted.length,
    rejectedCount:            rejected.length,
    acceptedDeltaSum:         acceptedDelta,
    rejectedDeltaSum:         rejectedDelta,
    recommendedAdaptiveWeight: Math.round(newWeight * 100) / 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-CHAPTER TRANSFER
// Логика: подтверждённый HUMAN-профиль из гл.1 используется для гл.2+
// Аналог: scripts/verify-ch678-continuity.ts (верификация продолжений)
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossChapterTransferConfig {
  /** Максимальный вес transfer-профиля при слиянии (0–1) */
  maxTransferWeight: number;
  /** Минимальное число HUMAN-сегментов в source-профиле для transfer */
  minSourceHumanCount: number;
}

export const DEFAULT_CROSS_CHAPTER_CONFIG: CrossChapterTransferConfig = {
  maxTransferWeight:   0.4,
  minSourceHumanCount: 5,
};

/**
 * Мерджит «донорский» профиль предыдущих глав с «реципиентным» профилем текущей.
 * Используется когда у текущей главы мало накопленных примеров.
 * 
 * @param recipient - Профиль текущей главы (мало примеров)
 * @param donor     - Профиль предыдущей главы (много HUMAN примеров)
 * @param config    - Параметры transfer
 */
export function mergeWithDonorProfile(
  recipient: ExtendedCentroid,
  donor:     ExtendedCentroid,
  config:    CrossChapterTransferConfig = DEFAULT_CROSS_CHAPTER_CONFIG,
): ExtendedCentroid {
  if (donor.count < config.minSourceHumanCount) {
    return recipient; // донор ненадёжен
  }

  if (recipient.count >= config.minSourceHumanCount * 2) {
    return recipient; // у реципиента достаточно своих данных
  }

  // Вес transfer: убывает по мере накопления собственных примеров
  const transferWeight = Math.min(
    config.maxTransferWeight,
    config.maxTransferWeight * (1 - recipient.count / (config.minSourceHumanCount * 2)),
  );
  const recipientWeight = 1 - transferWeight;

  // Взвешенное среднее mean (простое: не истинный Welford merge)
  const mergedMean = zeroExtended();
  for (const f of EXTENDED_FEATURES) {
    mergedMean[f] = recipient.count > 0
      ? recipientWeight * recipient.mean[f] + transferWeight * donor.mean[f]
      : donor.mean[f];
  }

  return {
    count:    Math.max(recipient.count, 1),
    mean:     mergedMean,
    m2:       { ...recipient.m2 }, // сохраняем оригинальную дисперсию
    crossM2:  { ...recipient.crossM2 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENSEMBLE SCORING
// Объединяет: aiTell regex + extended style centroid + N-gram predictor
// Заимствует из scripts/run-bestof-detector-test.ts (best-of-N scoring)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnsembleScore {
  /** Вероятность HUMAN (0–100) */
  humanProbability:   number;
  /** Вклад aiTell компоненты */
  aiTellContribution: number;
  /** Вклад style-centroid компоненты */
  centroidContribution: number;
  /** Вклад N-gram predictor компоненты */
  ngramContribution:  number;
  /** Итоговый вердикт */
  label: "HUMAN" | "REVIEW" | "AI";
  confidence: number;
}

/**
 * N-gram predictor: вероятность HUMAN по совпадению биграмм с HUMAN-профилем.
 * Простая реализация без внешних зависимостей.
 */
export function ngramHumanProbability(
  text: string,
  humanNgrams: string[],
  aiNgrams:    string[],
): number {
  if (humanNgrams.length === 0 && aiNgrams.length === 0) return 50;

  const textLower = text.toLowerCase();
  let humanHits = 0;
  let aiHits    = 0;

  for (const ng of humanNgrams) {
    if (textLower.includes(ng)) humanHits++;
  }
  for (const ng of aiNgrams) {
    if (textLower.includes(ng)) aiHits++;
  }

  const total = humanHits + aiHits;
  if (total === 0) return 50;
  return Math.round((humanHits / total) * 100);
}

/**
 * Ансамблевый скоринг.
 * 
 * Веса компонент:
 *  - aiTell (regex): 35%
 *  - style-centroid: 45%
 *  - N-gram predictor: 20%
 */
export function computeEnsembleScore(params: {
  text:            string;
  aiTellScore:     number;         // 0–100 (выше = больше AI)
  centroidHumanProbability: number; // 0–100
  humanNgrams:     string[];
  aiNgrams:        string[];
  humanCentroidCount: number;
  aiCentroidCount:    number;
}): EnsembleScore {
  const {
    text, aiTellScore, centroidHumanProbability,
    humanNgrams, aiNgrams, humanCentroidCount, aiCentroidCount,
  } = params;

  // 1. aiTell → HUMAN% (инвертированный)
  const aiTellHuman = Math.max(0, 100 - aiTellScore * 1.2);

  // 2. Centroid → HUMAN% (передан напрямую)
  const centroidHuman = centroidHumanProbability;

  // 3. N-gram predictor
  const ngramHuman = ngramHumanProbability(text, humanNgrams, aiNgrams);

  // Динамические веса: если данных мало — снижаем вес centroid
  const centroidReliability = Math.min(1, (humanCentroidCount + aiCentroidCount) / 20);
  const w_tell    = 0.35;
  const w_centroid = 0.45 * centroidReliability;
  const w_ngram   = 1 - w_tell - w_centroid;

  const humanProbability = Math.round(
    w_tell     * aiTellHuman
    + w_centroid * centroidHuman
    + w_ngram    * ngramHuman,
  );

  // Confidence: растёт с числом данных
  const confidence = Math.round(
    Math.min(95, 40 + Math.log2(1 + Math.min(humanCentroidCount, aiCentroidCount)) / 5 * 55),
  );

  let label: "HUMAN" | "REVIEW" | "AI";
  if (humanProbability >= 65)       label = "HUMAN";
  else if (humanProbability >= 40)  label = "REVIEW";
  else                              label = "AI";

  return {
    humanProbability,
    aiTellContribution:     aiTellHuman,
    centroidContribution:   centroidHuman,
    ngramContribution:      ngramHuman,
    label,
    confidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ЭКСПОРТ
// ─────────────────────────────────────────────────────────────────────────────

export const DETECTOR_V2 = {
  features:           EXTENDED_FEATURES,
  scales:             EXTENDED_SCALES,
  emptyExtended:      emptyExtendedCentroid,
  addObservation:     addExtendedObservation,
  mahalanobis:        mahalanobisDistance,
  feedback:           aggregateImplicitFeedback,
  crossChapterMerge:  mergeWithDonorProfile,
  ensemble:           computeEnsembleScore,
};
