/**
 * 1) Прогон seed гл.7–8 (и опционально других файлов) через Yandex neurodetector
 * 2) Перекалибровка локального adaptive-детектора по всем отчётам
 *
 * npx tsx scripts/yandex-score-and-recalibrate.ts
 * SKIP_LIVE=1 — только калибровка по уже сохранённым JSON
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { buildLabyrinthStory, LABYRINTH_STORY_ID } from "../src/data/labyrinthCanon";
import {
  createAdaptiveProfile,
  fitFusionWeight,
  learnFromDetectorReport,
  scoreCalibratedLocalDetector,
  type AdaptiveDetectorProfile,
} from "../src/lib/adaptiveDetector";
import { validateDetectorReport, type DetectorLabel, type DetectorReport } from "../src/lib/detectorReport";
import { aiTellScore } from "../server/humanStyle";
import { LABYRINTH_AUTHOR_SAMPLE } from "../src/data/labyrinthCanon";
import chapter6Text from "../src/data/labyrinth/chapter-6.content";

const root = process.cwd();
const outDir = path.join(root, "test-artifacts", "yandex-recal");
const seedOut = path.join(root, "src", "data", "labyrinth", "adaptive-detector-seed.ts");
fs.mkdirSync(outDir, { recursive: true });

const skipLive = process.env.SKIP_LIVE === "1";

function walkJson(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJson(full, acc);
    else if (e.name.endsWith(".json") && /яндекс|yandex|detector/i.test(e.name)) acc.push(full);
  }
  return acc;
}

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
        /* rebuild */
      }
    }
    const segmentsIn = Array.isArray(rootObj.segments) ? rootObj.segments : null;
    if (!segmentsIn?.length) return null;
    const counts: Record<DetectorLabel, number> = {
      AI: 0, LIKELY_AI: 0, LIKELY_HUMAN: 0, HUMAN: 0, UNKNOWN: 0,
    };
    const segments = segmentsIn.map((item) => {
      const seg = item as Record<string, unknown>;
      const text = String(seg.text || "");
      const label = String(seg.label || "UNKNOWN") as DetectorLabel;
      if (!text || !["AI", "LIKELY_AI", "LIKELY_HUMAN", "HUMAN", "UNKNOWN"].includes(label)) {
        throw new Error("bad segment");
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
    return {
      time: typeof rootObj.time === "string" ? rootObj.time : new Date().toISOString(),
      filename: typeof rootObj.filename === "string" ? rootObj.filename : source,
      stats: {
        segments_count: segments.length - counts.UNKNOWN,
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

function aiPct(report: DetectorReport): number {
  let ai = 0;
  let tot = 0;
  for (const s of report.segments) {
    tot += s.len;
    if (s.label === "AI" || s.label === "LIKELY_AI") ai += s.len;
  }
  return tot ? (100 * ai) / tot : 0;
}

function postYandex(text: string, name: string): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  report?: DetectorReport;
  raw?: string;
}> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ text: text.slice(0, 14_000) });
    const req = https.request(
      {
        hostname: "yandex.ru",
        path: "/lab/neurodetector/api/analyze/text",
        method: "POST",
        rejectUnauthorized: false,
        timeout: 90_000,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          Origin: "https://yandex.ru",
          Referer: "https://yandex.ru/lab/neurodetector",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          fs.writeFileSync(path.join(outDir, `raw-${name}.txt`), raw, "utf8");
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            resolve({
              ok: false,
              status: res.statusCode,
              error: `redirect ${res.headers.location || ""}`,
              raw,
            });
            return;
          }
          if (!res.statusCode || res.statusCode >= 400) {
            resolve({ ok: false, status: res.statusCode || 0, error: raw.slice(0, 200), raw });
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            const report = softParseReport(parsed, name);
            if (!report) {
              resolve({ ok: false, status: res.statusCode, error: "no segments", raw });
              return;
            }
            fs.writeFileSync(
              path.join(outDir, `yandex-${name}.json`),
              JSON.stringify(report, null, 2),
              "utf8",
            );
            resolve({ ok: true, status: res.statusCode, report, raw });
          } catch (e) {
            resolve({
              ok: false,
              status: res.statusCode,
              error: e instanceof Error ? e.message : String(e),
              raw,
            });
          }
        });
      },
    );
    req.on("error", (e) => resolve({ ok: false, status: 0, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: "timeout" });
    });
    req.write(body);
    req.end();
  });
}

function isHuman(label: string) {
  return label === "HUMAN" || label === "LIKELY_HUMAN";
}
function isAi(label: string) {
  return label === "AI" || label === "LIKELY_AI";
}

function train(reports: DetectorReport[]): AdaptiveDetectorProfile {
  let profile = createAdaptiveProfile(LABYRINTH_STORY_ID);
  for (const report of reports) {
    const r = learnFromDetectorReport(profile, report);
    if (!r.duplicate) profile = r.profile;
  }
  const samples: Array<{ text: string; human: boolean }> = [];
  for (const report of reports) {
    for (const seg of report.segments) {
      if (!isHuman(seg.label) && !isAi(seg.label)) continue;
      if (seg.text.split(/\s+/).filter(Boolean).length < 25) continue;
      samples.push({ text: seg.text, human: isHuman(seg.label) });
    }
  }
  const fusion = fitFusionWeight(samples, profile);
  return { ...profile, version: 2, fusion };
}

function looCalibrated(reports: DetectorReport[], fusion: AdaptiveDetectorProfile["fusion"]) {
  let total = 0;
  let ok = 0;
  for (let i = 0; i < reports.length; i++) {
    const held = reports[i];
    const trainSet = reports.filter((_, j) => j !== i);
    let profile = createAdaptiveProfile(LABYRINTH_STORY_ID);
    for (const report of trainSet) {
      const r = learnFromDetectorReport(profile, report);
      if (!r.duplicate) profile = r.profile;
    }
    if (profile.human.count < 1 || profile.ai.count < 1) continue;
    const withFusion = { ...profile, version: 2 as const, fusion };
    for (const seg of held.segments) {
      if (!isHuman(seg.label) && !isAi(seg.label)) continue;
      if (seg.text.split(/\s+/).filter(Boolean).length < 25) continue;
      const scored = scoreCalibratedLocalDetector(seg.text, withFusion);
      if (!scored) continue;
      total += 1;
      if ((scored.predictedLabel === "HUMAN") === isHuman(seg.label)) ok += 1;
    }
  }
  return { total, accuracy: total ? ok / total : 0 };
}

async function main() {
  console.log("=== Yandex score + recalibrate local detector ===\n");
  const story = buildLabyrinthStory();
  const ch7 = story.chapters.find((c) => /глава\s*7/i.test(c.title))!;
  const ch8 = story.chapters.find((c) => /глава\s*8/i.test(c.title))!;
  fs.writeFileSync(path.join(outDir, "ch7.txt"), ch7.content, "utf8");
  fs.writeFileSync(path.join(outDir, "ch8.txt"), ch8.content, "utf8");

  const liveResults: Array<{
    name: string;
    ok: boolean;
    status?: number;
    error?: string;
    aiPct?: number;
    stats?: DetectorReport["stats"];
  }> = [];

  if (!skipLive) {
    console.log("--- Live Yandex ---");
    for (const [name, text] of [
      ["ch7-seed", ch7.content],
      ["ch8-seed", ch8.content],
      ["ch1-author", LABYRINTH_AUTHOR_SAMPLE.slice(0, 12_000)],
      ["ch6-seed", chapter6Text.slice(0, 12_000)],
    ] as const) {
      process.stdout.write(`  ${name}… `);
      const res = await postYandex(text, name);
      if (res.ok && res.report) {
        const pct = aiPct(res.report);
        console.log(
          `OK AI%=${pct.toFixed(1)} H=${res.report.stats.HUMAN_count} AI=${res.report.stats.AI_count}+LA=${res.report.stats.LIKELY_AI_count}`,
        );
        liveResults.push({
          name,
          ok: true,
          status: res.status,
          aiPct: pct,
          stats: res.report.stats,
        });
      } else {
        console.log(`FAIL status=${res.status} ${res.error || ""}`);
        liveResults.push({
          name,
          ok: false,
          status: res.status,
          error: res.error,
        });
      }
      // polite pause
      await new Promise((r) => setTimeout(r, 800));
    }
  } else {
    console.log("SKIP_LIVE=1 — live Yandex skipped");
  }

  console.log("\n--- Collect reports for calibration ---");
  const files = walkJson(path.join(root, "test-artifacts"));
  const reports: DetectorReport[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const report = softParseReport(raw, path.basename(file));
      if (!report?.segments.some((s) => isHuman(s.label) || isAi(s.label))) continue;
      reports.push(report);
      console.log(
        `  + ${path.relative(root, file)} segs=${report.segments.length}`
        + ` H=${report.stats.HUMAN_count}+LH=${report.stats.LIKELY_HUMAN_count}`
        + ` A=${report.stats.AI_count}+LA=${report.stats.LIKELY_AI_count}`,
      );
    } catch {
      /* skip */
    }
  }
  console.log(`Reports: ${reports.length}`);

  if (!reports.length) {
    console.error("No reports to calibrate");
    process.exit(1);
  }

  console.log("\n--- Train + fusion ---");
  const profile = train(reports);
  console.log(
    `centroid H=${profile.human.count} A=${profile.ai.count}`
    + ` fusion w=${profile.fusion?.adaptiveWeight} thr=${profile.fusion?.humanThreshold}`
    + ` fitAcc=${((profile.fusion?.looAccuracy ?? 0) * 100).toFixed(1)}%`,
  );

  const loo = looCalibrated(reports, profile.fusion);
  console.log(`calibrated LOO: n=${loo.total} acc=${(loo.accuracy * 100).toFixed(1)}%`);

  const benchmarks = [
    ["ch1", LABYRINTH_AUTHOR_SAMPLE],
    ["ch6", chapter6Text],
    ["ch7", ch7.content],
    ["ch8", ch8.content],
    [
      "dirty",
      "Это был не просто коридор. Волна ужаса накрыла меня. В современном мире стоит отметить: время словно остановилось.",
    ],
  ] as const;

  console.log("\n--- Local calibrated scores ---");
  const localScores: Record<string, unknown> = {};
  for (const [name, text] of benchmarks) {
    const cal = scoreCalibratedLocalDetector(text, profile);
    const tell = aiTellScore(text);
    localScores[name] = {
      calHuman: cal?.calibratedHumanProbability,
      predicted: cal?.predictedLabel,
      style: cal?.adaptiveHumanProbability,
      aiTell: tell.score,
      burst: Number(tell.burstiness.toFixed(3)),
    };
    console.log(
      `  ${name}: calHUMAN=${cal?.calibratedHumanProbability}%→${cal?.predictedLabel}`
      + ` style=${cal?.adaptiveHumanProbability}% tell=${tell.score}`,
    );
  }

  // write seed
  const body = `/**
 * Seed адаптивного детектора «Лабиринт» — обучен на отчётах Яндекс-нейродетектора.
 * Пересобирается: npx tsx scripts/yandex-score-and-recalibrate.ts
 *   или: npx tsx scripts/calibrate-yandex-adaptive.ts
 */
import type { AdaptiveDetectorProfile } from "../../lib/adaptiveDetector";

export const LABYRINTH_ADAPTIVE_DETECTOR_SEED: AdaptiveDetectorProfile = ${JSON.stringify(profile, null, 2)} as AdaptiveDetectorProfile;
`;
  fs.writeFileSync(seedOut, body, "utf8");
  console.log(`\nSeed written: ${seedOut}`);

  const liveOk = liveResults.filter((r) => r.ok);
  const report = {
    createdAt: new Date().toISOString(),
    skipLive,
    live: liveResults,
    liveOk: liveOk.length,
    calibration: {
      reports: reports.length,
      human: profile.human.count,
      ai: profile.ai.count,
      fusion: profile.fusion,
      loo,
    },
    localScores,
    seedPath: seedOut,
    note: liveOk.length
      ? "Live Yandex OK — see yandex-*.json"
      : "Live Yandex unavailable; recalibrated from stored reports only",
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`Report: ${path.join(outDir, "report.json")}`);

  // gates
  const ch1 = localScores.ch1 as { calHuman?: number; predicted?: string };
  const dirty = localScores.dirty as { predicted?: string; calHuman?: number };
  const gates = {
    bothClasses: profile.human.count >= 3 && profile.ai.count >= 3,
    looMin: loo.total < 10 || loo.accuracy >= 0.6,
    ch1Human: (ch1.calHuman ?? 0) >= 50 || ch1.predicted === "HUMAN",
    dirtyAi: dirty.predicted === "AI" || (dirty.calHuman ?? 100) < 55,
    fusion: Boolean(profile.fusion),
  };
  console.log("\n--- Gates ---");
  let fail = false;
  for (const [k, v] of Object.entries(gates)) {
    console.log(`  ${v ? "✓" : "✗"} ${k}`);
    if (!v) fail = true;
  }
  if (fail) process.exitCode = 1;
  else console.log("\nRECALIBRATION OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
