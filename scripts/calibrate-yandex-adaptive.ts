/**
 * Калибровка локального adaptive-детектора по отчётам Яндекс-нейродетектора.
 *
 * 1) Собирает JSON из test-artifacts (яндекс-*.json / detector-*.json)
 * 2) Учит centroid HUMAN/AI (learnFromDetectorReport)
 * 3) Leave-one-report-out: accuracy vs метки Яндекса
 * 4) Пишет seed: src/data/labyrinth/adaptive-detector-seed.ts
 * 5) Скоринг эталонов (гл.1, seed 6/7, live 7/8, dirty AI)
 *
 * npx tsx scripts/calibrate-yandex-adaptive.ts
 * FETCH_LIVE=1 — дополнительно дернуть Яндекс на эталонных текстах (если сеть пускает)
 */
import fs from "node:fs";
import path from "node:path";
import {
  createAdaptiveProfile,
  fitFusionWeight,
  learnFromDetectorReport,
  scoreCalibratedLocalDetector,
  scoreWithAdaptiveProfile,
  type AdaptiveDetectorProfile,
} from "../src/lib/adaptiveDetector";
import { validateDetectorReport, type DetectorLabel, type DetectorReport } from "../src/lib/detectorReport";
import { LABYRINTH_AUTHOR_SAMPLE, LABYRINTH_STORY_ID } from "../src/data/labyrinthCanon";
import chapter6Text from "../src/data/labyrinth/chapter-6.content";
import chapter7Text from "../src/data/labyrinth/chapter-7.content";
import { aiTellScore } from "../server/humanStyle";

const root = process.cwd();
const artifacts = path.join(root, "test-artifacts");
const outDir = path.join(artifacts, "adaptive-calibration");
const seedOut = path.join(root, "src", "data", "labyrinth", "adaptive-detector-seed.ts");

function walkJson(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJson(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      if (/яндекс|yandex|detector/i.test(entry.name)) acc.push(full);
    }
  }
  return acc;
}

/** Мягкий разбор: Яндекс иногда шлёт stats/len с UNKNOWN-расхождениями. */
function softParseReport(raw: unknown, source: string): DetectorReport | null {
  try {
    const rootObj = (raw && typeof raw === "object" && "results" in (raw as object)
      ? (raw as { results: unknown }).results
      : raw) as Record<string, unknown>;
    if (!rootObj || typeof rootObj !== "object") return null;
    if (Array.isArray(rootObj.segments) && rootObj.segments.length) {
      try {
        return validateDetectorReport(rootObj);
      } catch {
        // rebuild stats from segments
      }
    }
    const segmentsIn = Array.isArray(rootObj.segments) ? rootObj.segments : null;
    if (!segmentsIn?.length) return null;

    const counts: Record<DetectorLabel, number> = {
      AI: 0, LIKELY_AI: 0, LIKELY_HUMAN: 0, HUMAN: 0, UNKNOWN: 0,
    };
    const segments = segmentsIn.map((item, index) => {
      const seg = item as Record<string, unknown>;
      const text = String(seg.text || "");
      const label = String(seg.label || "UNKNOWN") as DetectorLabel;
      if (!text || !["AI", "LIKELY_AI", "LIKELY_HUMAN", "HUMAN", "UNKNOWN"].includes(label)) {
        throw new Error(`bad segment ${index}`);
      }
      counts[label] += 1;
      return { len: text.length, text, label, start: 0, end: 0 };
    });
    let offset = 0;
    for (const seg of segments) {
      seg.start = offset;
      offset += seg.len;
      seg.end = offset;
    }
    const classified = segments.length - counts.UNKNOWN;
    return {
      time: typeof rootObj.time === "string" ? rootObj.time : "",
      filename: typeof rootObj.filename === "string" ? rootObj.filename : source,
      stats: {
        segments_count: classified,
        AI_count: counts.AI,
        LIKELY_AI_count: counts.LIKELY_AI,
        LIKELY_HUMAN_count: counts.LIKELY_HUMAN,
        HUMAN_count: counts.HUMAN,
      },
      segments,
      short_text_warning: Boolean(rootObj.short_text_warning),
      text_length: offset,
      fullText: segments.map((s) => s.text).join(""),
    };
  } catch {
    return null;
  }
}

function isHumanLabel(label: string): boolean {
  return label === "HUMAN" || label === "LIKELY_HUMAN";
}
function isAiLabel(label: string): boolean {
  return label === "AI" || label === "LIKELY_AI";
}

function words(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

async function fetchYandex(text: string, name: string): Promise<DetectorReport | null> {
  try {
    const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
        Origin: "https://yandex.ru",
        Referer: "https://yandex.ru/lab/neurodetector",
      },
      body: JSON.stringify({ text: text.slice(0, 14_000) }),
    });
    const raw = await res.text();
    if (!res.ok) {
      console.log(`  live Yandex ${name}: HTTP ${res.status}`);
      return null;
    }
    const parsed = JSON.parse(raw);
    const report = softParseReport(parsed, name);
    if (report) {
      fs.writeFileSync(path.join(outDir, `live-yandex-${name}.json`), JSON.stringify(report, null, 2), "utf8");
    }
    return report;
  } catch (error) {
    console.log(`  live Yandex ${name}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

function trainOnReports(reports: DetectorReport[], storyId = LABYRINTH_STORY_ID): {
  profile: AdaptiveDetectorProfile;
  learnedHuman: number;
  learnedAi: number;
  filesUsed: number;
} {
  let profile = createAdaptiveProfile(storyId);
  let learnedHuman = 0;
  let learnedAi = 0;
  let filesUsed = 0;
  for (const report of reports) {
    const result = learnFromDetectorReport(profile, report);
    if (result.duplicate) continue;
    profile = result.profile;
    learnedHuman += result.learnedHuman;
    learnedAi += result.learnedAi;
    if (result.learnedHuman + result.learnedAi > 0) filesUsed += 1;
  }
  return { profile, learnedHuman, learnedAi, filesUsed };
}

/** LOO: для каждого отчёта учимся на остальных, скорим сегменты held-out. */
function leaveOneOut(reports: DetectorReport[]) {
  let total = 0;
  let correct = 0;
  let humanCorrect = 0;
  let humanTotal = 0;
  let aiCorrect = 0;
  let aiTotal = 0;
  const confusions = { hh: 0, ha: 0, ah: 0, aa: 0 };

  for (let i = 0; i < reports.length; i += 1) {
    const held = reports[i];
    const train = reports.filter((_, j) => j !== i);
    const { profile } = trainOnReports(train);
    if (profile.human.count < 1 || profile.ai.count < 1) continue;

    for (const seg of held.segments) {
      if (!isHumanLabel(seg.label) && !isAiLabel(seg.label)) continue;
      if (words(seg.text) < 25) continue;
      const score = scoreWithAdaptiveProfile(seg.text, profile);
      if (!score) continue;
      const predHuman = score.humanProbability >= 50;
      const goldHuman = isHumanLabel(seg.label);
      total += 1;
      if (predHuman === goldHuman) correct += 1;
      if (goldHuman) {
        humanTotal += 1;
        if (predHuman) {
          humanCorrect += 1;
          confusions.hh += 1;
        } else confusions.ha += 1;
      } else {
        aiTotal += 1;
        if (!predHuman) {
          aiCorrect += 1;
          confusions.aa += 1;
        } else confusions.ah += 1;
      }
    }
  }

  return {
    total,
    accuracy: total ? correct / total : 0,
    humanRecall: humanTotal ? humanCorrect / humanTotal : 0,
    aiRecall: aiTotal ? aiCorrect / aiTotal : 0,
    humanTotal,
    aiTotal,
    confusions,
  };
}

function scoreText(label: string, text: string, profile: AdaptiveDetectorProfile) {
  const adaptive = scoreWithAdaptiveProfile(text, profile);
  const local = aiTellScore(text);
  return {
    label,
    chars: text.length,
    adaptiveHumanPct: adaptive?.humanProbability ?? null,
    adaptiveConfidence: adaptive?.confidence ?? null,
    aiTell: local.score,
    burst: Number(local.burstiness.toFixed(3)),
  };
}

function writeSeedFile(profile: AdaptiveDetectorProfile) {
  const body = `/**
 * Seed адаптивного детектора «Лабиринт» — обучен на отчётах Яндекс-нейродетектора.
 * Пересобирается: npx tsx scripts/calibrate-yandex-adaptive.ts
 * Не править вручную без пересчёта.
 */
import type { AdaptiveDetectorProfile } from "../../lib/adaptiveDetector";

export const LABYRINTH_ADAPTIVE_DETECTOR_SEED: AdaptiveDetectorProfile = ${JSON.stringify(profile, null, 2)} as AdaptiveDetectorProfile;
`;
  fs.writeFileSync(seedOut, body, "utf8");
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log("=== Calibrate local adaptive detector on Yandex reports ===\n");

  const files = walkJson(artifacts);
  const reports: DetectorReport[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const report = softParseReport(raw, path.basename(file));
      if (!report || !report.segments.some((s) => isHumanLabel(s.label) || isAiLabel(s.label))) {
        skipped.push(path.relative(root, file) + " (no labeled segs)");
        continue;
      }
      reports.push(report);
      console.log(
        `  + ${path.relative(root, file)} segs=${report.segments.length}`
        + ` H=${report.stats.HUMAN_count}+LH=${report.stats.LIKELY_HUMAN_count}`
        + ` A=${report.stats.AI_count}+LA=${report.stats.LIKELY_AI_count}`,
      );
    } catch {
      skipped.push(path.relative(root, file) + " (parse error)");
    }
  }

  if (process.env.FETCH_LIVE === "1") {
    console.log("\n--- Live Yandex fetch ---");
    const liveTargets: Array<{ name: string; text: string }> = [
      { name: "author-ch1", text: LABYRINTH_AUTHOR_SAMPLE },
      { name: "seed-ch6", text: chapter6Text },
      { name: "seed-ch7", text: chapter7Text },
    ];
    const liveCh7 = path.join(artifacts, "ch678-verify", "глава-7.txt");
    const liveCh8 = path.join(artifacts, "ch678-verify", "глава-8.txt");
    if (fs.existsSync(liveCh7)) liveTargets.push({ name: "live-ch7", text: fs.readFileSync(liveCh7, "utf8") });
    if (fs.existsSync(liveCh8)) liveTargets.push({ name: "live-ch8", text: fs.readFileSync(liveCh8, "utf8") });

    for (const target of liveTargets) {
      const report = await fetchYandex(target.text, target.name);
      if (report) {
        reports.push(report);
        console.log(
          `  + live ${target.name} H=${report.stats.HUMAN_count} A=${report.stats.AI_count}+LA=${report.stats.LIKELY_AI_count}`,
        );
      }
    }
  }

  console.log(`\nReports usable: ${reports.length}, skipped: ${skipped.length}`);
  if (!reports.length) {
    console.error("Нет отчётов для обучения");
    process.exit(1);
  }

  const trained = trainOnReports(reports);
  console.log(
    `\nTrained: files=${trained.filesUsed} HUMAN segs=${trained.learnedHuman} AI segs=${trained.learnedAi}`
    + ` centroid H=${trained.profile.human.count} A=${trained.profile.ai.count}`,
  );

  if (trained.profile.human.count < 1 || trained.profile.ai.count < 1) {
    console.error("Нужны оба класса HUMAN и AI в сегментах");
    process.exit(1);
  }

  // Собрать сегменты для fit fusion
  const fusionSamples: Array<{ text: string; human: boolean }> = [];
  for (const report of reports) {
    for (const seg of report.segments) {
      if (!isHumanLabel(seg.label) && !isAiLabel(seg.label)) continue;
      if (words(seg.text) < 25) continue;
      fusionSamples.push({ text: seg.text, human: isHumanLabel(seg.label) });
    }
  }
  const fusion = fitFusionWeight(fusionSamples, trained.profile);
  trained.profile = {
    ...trained.profile,
    version: 2,
    fusion,
  };
  console.log(
    `\nFusion fit: adaptiveWeight=${fusion.adaptiveWeight} threshold=${fusion.humanThreshold}`
    + ` trainAcc=${((fusion.looAccuracy ?? 0) * 100).toFixed(1)}% n=${fusionSamples.length}`,
  );

  console.log("\n--- Leave-one-report-out vs Yandex labels (style-only) ---");
  const loo = leaveOneOut(reports);
  console.log(
    `  n=${loo.total} acc=${(loo.accuracy * 100).toFixed(1)}%`
    + ` humanRecall=${(loo.humanRecall * 100).toFixed(1)}% (${loo.humanTotal})`
    + ` aiRecall=${(loo.aiRecall * 100).toFixed(1)}% (${loo.aiTotal})`,
  );
  console.log(
    `  confusion: HH=${loo.confusions.hh} HA=${loo.confusions.ha} AH=${loo.confusions.ah} AA=${loo.confusions.aa}`,
  );

  // Calibrated LOO: train style on others, apply global fusion weights
  let calTotal = 0;
  let calOk = 0;
  for (let i = 0; i < reports.length; i += 1) {
    const held = reports[i];
    const train = reports.filter((_, j) => j !== i);
    const fold = trainOnReports(train);
    if (fold.profile.human.count < 1 || fold.profile.ai.count < 1) continue;
    const foldProfile = { ...fold.profile, version: 2 as const, fusion };
    for (const seg of held.segments) {
      if (!isHumanLabel(seg.label) && !isAiLabel(seg.label)) continue;
      if (words(seg.text) < 25) continue;
      const scored = scoreCalibratedLocalDetector(seg.text, foldProfile);
      if (!scored) continue;
      calTotal += 1;
      const goldHuman = isHumanLabel(seg.label);
      if ((scored.predictedLabel === "HUMAN") === goldHuman) calOk += 1;
    }
  }
  const calAcc = calTotal ? calOk / calTotal : 0;
  console.log(`\n--- Calibrated LOO (style+aiTell fusion) ---`);
  console.log(`  n=${calTotal} acc=${(calAcc * 100).toFixed(1)}%`);

  // Эталонные тексты
  const dirtyAi = `Это был не просто коридор. Волна ужаса накрыла меня, и время словно остановилось.
В современном мире такие вещи кажутся невозможными. Стоит отметить, что заряд составлял двадцать процентов.
Подводя итог, важно понять: отпечаток ладони ждал меня. С одной стороны я был сыт, с другой — растерян.`;

  function bench(label: string, text: string) {
    const base = scoreText(label, text, trained.profile);
    const cal = scoreCalibratedLocalDetector(text, trained.profile);
    return {
      ...base,
      calibratedHumanPct: cal?.calibratedHumanProbability ?? null,
      predicted: cal?.predictedLabel ?? null,
    };
  }

  const benchmarks = [
    bench("author-ch1 (эталон HUMAN)", LABYRINTH_AUTHOR_SAMPLE),
    bench("seed-ch6", chapter6Text),
    bench("seed-ch7", chapter7Text),
    bench("dirty-ai-stamps", dirtyAi),
  ];
  const live7path = path.join(artifacts, "ch678-verify", "глава-7.txt");
  const live8path = path.join(artifacts, "ch678-verify", "глава-8.txt");
  if (fs.existsSync(live7path)) {
    benchmarks.push(bench("live-gen-ch7", fs.readFileSync(live7path, "utf8")));
  }
  if (fs.existsSync(live8path)) {
    benchmarks.push(bench("live-gen-ch8", fs.readFileSync(live8path, "utf8")));
  }

  console.log("\n--- Benchmark scores (calibrated / adaptive / aiTell) ---");
  for (const row of benchmarks) {
    console.log(
      `  ${row.label}: calHUMAN=${row.calibratedHumanPct}% (${row.predicted})`
      + ` | style=${row.adaptiveHumanPct}% | aiTell=${row.aiTell} burst=${row.burst}`,
    );
  }

  // Качество seed: гл.1 human, dirty AI, calibrated LOO
  const ch1 = benchmarks.find((b) => b.label.startsWith("author-ch1"))!;
  const dirty = benchmarks.find((b) => b.label.startsWith("dirty"))!;
  const thr = fusion.humanThreshold ?? 50;
  const gates = {
    ch1HumanLean: (ch1.calibratedHumanPct ?? 0) >= thr && ch1.predicted === "HUMAN",
    dirtyAiLean: dirty.predicted === "AI" || (dirty.calibratedHumanPct ?? 100) < thr,
    calibratedLooMin: calTotal >= 10 ? calAcc >= 0.62 : true,
    bothClasses: trained.profile.human.count >= 3 && trained.profile.ai.count >= 3,
    fusionPresent: Boolean(trained.profile.fusion?.adaptiveWeight != null),
    ch1AboveDirty: (ch1.calibratedHumanPct ?? 0) > (dirty.calibratedHumanPct ?? 100),
  };
  console.log("\n--- Gates ---");
  for (const [k, v] of Object.entries(gates)) {
    console.log(`  ${v ? "✓" : "✗"} ${k}${k === "calibratedLooMin" ? ` (${(calAcc * 100).toFixed(1)}%)` : ""}`);
  }

  writeSeedFile(trained.profile);
  console.log(`\nSeed written: ${seedOut}`);

  const report = {
    createdAt: new Date().toISOString(),
    reportsUsed: reports.length,
    filesUsed: trained.filesUsed,
    learnedHuman: trained.learnedHuman,
    learnedAi: trained.learnedAi,
    centroid: { human: trained.profile.human.count, ai: trained.profile.ai.count },
    fusion,
    loo,
    calibratedLoo: { total: calTotal, accuracy: calAcc },
    benchmarks,
    gates,
    skipped: skipped.slice(0, 40),
    humanMean: trained.profile.human.mean,
    aiMean: trained.profile.ai.mean,
  };
  fs.writeFileSync(path.join(outDir, "calibration-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`Report: ${path.join(outDir, "calibration-report.json")}`);

  const failed = Object.values(gates).some((g) => !g);
  if (failed) {
    console.error("\nCALIBRATION GATES FAILED");
    process.exitCode = 1;
  } else {
    console.log("\nCALIBRATION OK");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
