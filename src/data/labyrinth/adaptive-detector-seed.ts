/**
 * Seed адаптивного детектора «Лабиринт» — обучен на отчётах Яндекс-нейродетектора.
 * Пересобирается: npx tsx scripts/yandex-score-and-recalibrate.ts
 *   или: npx tsx scripts/calibrate-yandex-adaptive.ts
 */
import type { AdaptiveDetectorProfile } from "../../lib/adaptiveDetector";

export const LABYRINTH_ADAPTIVE_DETECTOR_SEED: AdaptiveDetectorProfile = {
  "version": 2,
  "storyId": "story-labyrinth",
  "updatedAt": 1784325699584,
  "reportHashes": [
    "bdb5aad0",
    "2e3cc86c",
    "1eff5923",
    "c863ed2f",
    "032b2b61",
    "ee853d99",
    "9fecdda2",
    "6e669cf3",
    "f0d67718",
    "b1152732",
    "31a6bab6",
    "4eae1f12",
    "e2011d9f",
    "c02345b3",
    "47195fbe",
    "72d7384b",
    "0dc44c29",
    "76dea3ce",
    "c5c12112",
    "59857e1c",
    "df1e9ef7",
    "d2646e85",
    "543dc885",
    "d0fad5ab",
    "db5f2201",
    "b0bb859f",
    "ea97f5ce",
    "d33d256c",
    "c4c77a82",
    "b62319e8",
    "4949d9b2",
    "ff93f00e",
    "936c5c60",
    "22304c72",
    "b5ff2c7d"
  ],
  "human": {
    "count": 86,
    "mean": {
      "averageSentenceWords": 9.047792819518504,
      "sentenceLengthDeviation": 4.3698777099677475,
      "shortSentenceShare": 0.17926606469046155,
      "exclamationsPerThousandWords": 2.5127926172229347,
      "ellipsesPerThousandWords": 2.3347929528742837,
      "dialogueLineShare": 0,
      "particlesPerThousandWords": 4.2601184333092785,
      "similesPerThousandWords": 0
    },
    "m2": {
      "averageSentenceWords": 362.5172625990401,
      "sentenceLengthDeviation": 132.36940825630285,
      "shortSentenceShare": 1.5812865335607003,
      "exclamationsPerThousandWords": 2282.9359763078583,
      "ellipsesPerThousandWords": 1996.574466917097,
      "dialogueLineShare": 0,
      "particlesPerThousandWords": 3826.4901840638345,
      "similesPerThousandWords": 0
    }
  },
  "ai": {
    "count": 132,
    "mean": {
      "averageSentenceWords": 7.793198667652789,
      "sentenceLengthDeviation": 4.738498524007804,
      "shortSentenceShare": 0.3502677371332207,
      "exclamationsPerThousandWords": 0.14422875099700752,
      "ellipsesPerThousandWords": 0.6388324602656195,
      "dialogueLineShare": 0,
      "particlesPerThousandWords": 2.5486864067674597,
      "similesPerThousandWords": 0
    },
    "m2": {
      "averageSentenceWords": 1011.2175973276379,
      "sentenceLengthDeviation": 351.95249213891947,
      "shortSentenceShare": 5.387819147200575,
      "exclamationsPerThousandWords": 201.38522972778284,
      "ellipsesPerThousandWords": 701.3865705708004,
      "dialogueLineShare": 0,
      "particlesPerThousandWords": 2595.8645733702197,
      "similesPerThousandWords": 0
    }
  },
  "fusion": {
    "adaptiveWeight": 0.75,
    "humanThreshold": 55,
    "source": "yandex-loo-fit",
    "calibratedAt": "2026-07-17T22:02:17.125Z",
    "looAccuracy": 0.7992700729927007
  }
} as AdaptiveDetectorProfile;
