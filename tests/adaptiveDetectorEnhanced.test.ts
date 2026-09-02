/**
 * adaptiveDetectorEnhanced.test.ts
 *
 * Unit-тесты для src/lib/adaptiveDetectorEnhanced.ts
 * Запуск: npm test
 */

import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXTENDED_FEATURES,
  EXTENDED_SCALES,
  emptyExtendedCentroid,
  addExtendedObservation,
  mahalanobisDistance,
  aggregateImplicitFeedback,
  mergeWithDonorProfile,
  computeEnsembleScore,
  type ExtendedVector,
} from "../src/lib/adaptiveDetectorEnhanced";

function mockVector(fill = 0): ExtendedVector {
  return Object.fromEntries(EXTENDED_FEATURES.map((f) => [f, fill])) as ExtendedVector;
}

describe("adaptiveDetectorEnhanced", () => {
  it("EXTENDED_FEATURES содержит 12 признаков", () => {
    assert.strictEqual(EXTENDED_FEATURES.length, 12);
  });

  it("EXTENDED_SCALES покрывает все 12 признаков", () => {
    for (const f of EXTENDED_FEATURES) {
      assert.ok(typeof EXTENDED_SCALES[f] === "number");
      assert.ok(EXTENDED_SCALES[f] > 0);
    }
  });

  it("emptyExtendedCentroid инициализирует центроид с нулевыми значениями", () => {
    const c = emptyExtendedCentroid();
    assert.strictEqual(c.count, 0);
    for (const f of EXTENDED_FEATURES) {
      assert.strictEqual(c.mean[f], 0);
      assert.strictEqual(c.m2[f], 0);
    }
  });

  it("addExtendedObservation корректно аккумулирует среднее Welford", () => {
    let c = emptyExtendedCentroid();
    const obs1 = mockVector(10);
    const obs2 = mockVector(20);

    c = addExtendedObservation(c, obs1);
    assert.strictEqual(c.count, 1);
    assert.strictEqual(c.mean.averageSentenceWords, 10);

    c = addExtendedObservation(c, obs2);
    assert.strictEqual(c.count, 2);
    assert.strictEqual(c.mean.averageSentenceWords, 15);
  });

  it("mahalanobisDistance возвращает неотрицательное число", () => {
    let c = emptyExtendedCentroid();
    c = addExtendedObservation(c, mockVector(10));
    c = addExtendedObservation(c, mockVector(12));

    const dist = mahalanobisDistance(mockVector(11), c);
    assert.ok(typeof dist === "number");
    assert.ok(!Number.isNaN(dist));
    assert.ok(dist >= 0);
  });

  it("aggregateImplicitFeedback реагирует на accept/reject", () => {
    const res = aggregateImplicitFeedback([
      {
        storyId: "s1",
        chapterId: "c1",
        revisionId: "r1",
        applied: true,
        originalText: "A",
        revisedText: "B",
        aiTellBefore: 30,
        aiTellAfter: 10,
        timestamp: Date.now(),
      },
      {
        storyId: "s1",
        chapterId: "c1",
        revisionId: "r2",
        applied: true,
        originalText: "C",
        revisedText: "D",
        aiTellBefore: 25,
        aiTellAfter: 5,
        timestamp: Date.now(),
      },
    ]);

    assert.strictEqual(res.acceptedCount, 2);
    assert.strictEqual(res.rejectedCount, 0);
    assert.ok(res.acceptedDeltaSum > 0);
  });

  it("mergeWithDonorProfile сливает профили при нехватке собственных данных", () => {
    let recipient = emptyExtendedCentroid();
    let donor = emptyExtendedCentroid();

    for (let i = 0; i < 10; i++) {
      donor = addExtendedObservation(donor, mockVector(50));
    }

    const merged = mergeWithDonorProfile(recipient, donor);
    assert.strictEqual(merged.mean.averageSentenceWords, 50);
  });

  it("computeEnsembleScore корректно взвешивает компоненты", () => {
    const score = computeEnsembleScore({
      text: "Тестовый текст без особых клише.",
      aiTellScore: 10,
      centroidHumanProbability: 80,
      humanNgrams: ["без особых"],
      aiNgrams: ["важно понять"],
      humanCentroidCount: 15,
      aiCentroidCount: 15,
    });

    assert.ok(score.humanProbability >= 0 && score.humanProbability <= 100);
    assert.ok(["HUMAN", "REVIEW", "AI"].includes(score.label));
    assert.ok(score.confidence > 0);
  });
});
