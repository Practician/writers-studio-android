/**
 * Сравнение провайдеров/моделей для очеловечивания (локальный AI-tell + опционально Yandex).
 *
 * npx tsx scripts/compare-humanize-providers.ts
 * SKIP_YANDEX=1 — только локальный score
 * QUICK=1 — меньше текста / один провайдер-цепочка auto
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { aiTellScore, humanizeGatePassed, resolveHumanizeDepth } from "../server/humanStyle";
import { humanizeProseDraft } from "../server/chapterGenerate";
import {
  loadAdaptiveProfile,
  scoreCalibratedLocalDetector,
} from "../src/lib/adaptiveDetector";
import {
  getLlmStatus,
  llmGenerate,
  runWithProviderPreference,
  type ProviderPreference,
} from "../server/llmProvider";

dotenv.config({ override: true });

const outDir = path.resolve(process.cwd(), "test-artifacts", "humanize-compare");
fs.mkdirSync(outDir, { recursive: true });

const depth = resolveHumanizeDepth("maximum");
const skipYandex = process.env.SKIP_YANDEX === "1" || process.env.QUICK === "1";
const rerankOnly = process.env.RERANK_ONLY === "1";
const adaptiveProfile = loadAdaptiveProfile("story-labyrinth");

/** Грязный ИИ-кусок в стиле «Лабиринта» — штампы + ровный ритм. */
const DIRTY_SAMPLE = `
Я шёл вдоль стены и думал о том, что произошло. Это был не просто коридор. Волна ужаса накрыла меня, и время словно остановилось. Сердце пропустило удар. Воздух сгустился вокруг.

В современном мире такие вещи кажутся невозможными, однако здесь всё было по-другому. Стоит отметить, что заряд телефона составлял около двадцати процентов. Я понимал, что нужно двигаться дальше.

Подводя итог своим размышлениям, я осознал: отпечаток ладони на стене ждал меня. Не просто ждал — словно нехотя притягивал взгляд. Я сделал шаг. Потом ещё один. Потом ещё.

Важно понять, что кольца на полу уже погасли. Число двадцать исчезло. Голод и жажда ушли. Но внутри оставалось странное чувство. С одной стороны, я был сыт. С другой стороны, я не знал, что делать дальше.

Вдруг внезапно я вспомнил сон про институт. Формула на доске. Мама. Суп. И снова Лабиринт. Это было не просто совпадение. Это был знак.
`.trim();

type Candidate = {
  id: string;
  provider: ProviderPreference;
  model?: string;
};

const CANDIDATES: Candidate[] = process.env.QUICK === "1"
  ? [{ id: "auto", provider: "auto" }]
  : [
      { id: "nvidia-deepseek-flash", provider: "nvidia", model: "deepseek-ai/deepseek-v4-flash" },
      { id: "nvidia-qwen", provider: "nvidia", model: "qwen/qwen3.5-122b-a10b" },
      { id: "gemini-flash", provider: "gemini", model: "gemini-3.5-flash" },
      { id: "groq-llama", provider: "groq", model: "llama-3.3-70b-versatile" },
      { id: "openrouter-free", provider: "openrouter", model: "openrouter/free" },
    ];

async function yandexAiPct(text: string, name: string): Promise<number | null> {
  try {
    const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
        Origin: "https://yandex.ru",
        Referer: "https://yandex.ru/lab/neurodetector",
      },
      body: JSON.stringify({ text }),
    });
    const raw = await res.text();
    if (!res.ok) {
      console.log(`  Yandex ${name}: HTTP ${res.status}`);
      return null;
    }
    const data = JSON.parse(raw);
    const report = data.results || data;
    fs.writeFileSync(path.join(outDir, `yandex-${name}.json`), JSON.stringify(report, null, 2), "utf8");
    let aiChars = 0;
    let total = 0;
    for (const seg of report.segments || []) {
      total += seg.len || 0;
      if (seg.label === "AI" || seg.label === "LIKELY_AI") aiChars += seg.len || 0;
    }
    return total > 0 ? (100 * aiChars) / total : null;
  } catch (error) {
    console.log(`  Yandex ${name}: error`, error instanceof Error ? error.message : error);
    return null;
  }
}

function savedYandexAiPct(name: string): number | null {
  const file = path.join(outDir, `yandex-${name}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const report = data.results || data;
    let aiChars = 0;
    let total = 0;
    for (const seg of report.segments || []) {
      total += Number(seg.len || 0);
      if (seg.label === "AI" || seg.label === "LIKELY_AI") aiChars += Number(seg.len || 0);
    }
    return total > 0 ? (100 * aiChars) / total : null;
  } catch {
    return null;
  }
}

function rerankSaved(candidate: Candidate) {
  const file = path.join(outDir, `${candidate.id}.txt`);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const before = aiTellScore(DIRTY_SAMPLE);
  const after = aiTellScore(text);
  const calibrated = scoreCalibratedLocalDetector(text, adaptiveProfile);
  return {
    id: candidate.id,
    provider: candidate.provider,
    model: candidate.model || null,
    actualModels: [] as string[],
    ms: 0,
    scoreBefore: before.score,
    scoreAfter: after.score,
    delta: before.score - after.score,
    burstAfter: after.burstiness,
    hitsAfter: after.hits.length,
    gatePassed: humanizeGatePassed(after, depth.scoreGate, depth.minBurstiness),
    calibratedHumanProbability: calibrated?.calibratedHumanProbability ?? null,
    calibratedLabel: calibrated?.predictedLabel ?? null,
    refinedBlocks: null,
    yandexAiPct: savedYandexAiPct(candidate.id),
    chars: text.length,
  };
}

async function runOne(candidate: Candidate) {
  const before = aiTellScore(DIRTY_SAMPLE);
  console.log(`\n=== ${candidate.id} (${candidate.provider}${candidate.model ? ` / ${candidate.model}` : ""}) ===`);
  console.log(`  before: score=${before.score} burst=${before.burstiness.toFixed(2)} hits=${before.hits.length}`);

  const actualModels = new Set<string>();
  const generate = async (params: {
    model: string;
    contents: string;
    systemInstruction: string;
    temperature: number;
    responseMimeType?: string;
    responseSchema?: unknown;
    maxOutputTokens?: number;
  }) => {
    const result = await llmGenerate({
      model: candidate.model || params.model,
      contents: params.contents,
      systemInstruction: params.systemInstruction,
      temperature: params.temperature,
      responseMimeType: params.responseMimeType,
      responseSchema: params.responseSchema,
      maxOutputTokens: params.maxOutputTokens,
    });
    actualModels.add(`${result.provider}/${result.model}`);
    console.log(`  llm: ${result.provider}/${result.model} failover=${result.failoverCount ?? 0}`);
    return result.text;
  };

  const started = Date.now();
  try {
    const polished = await runWithProviderPreference(candidate.provider, () =>
      humanizeProseDraft(DIRTY_SAMPLE, generate, {
        model: candidate.model || "auto",
        personaBlock:
          "Рассказчик — студент от первого лица, сухой дневник, конкретика (%, запах, жест), без пафоса.",
        humanizeDepth: "maximum",
      }),
    );
    const after = aiTellScore(polished.text);
    const calibrated = scoreCalibratedLocalDetector(polished.text, adaptiveProfile);
    const ms = Date.now() - started;
    const gate = humanizeGatePassed(after, depth.scoreGate, depth.minBurstiness);
    let yandex: number | null = null;
    if (!skipYandex) {
      yandex = await yandexAiPct(polished.text, candidate.id);
    }
    fs.writeFileSync(path.join(outDir, `${candidate.id}.txt`), polished.text, "utf8");
    const row = {
      id: candidate.id,
      provider: candidate.provider,
      model: candidate.model || null,
      actualModels: [...actualModels],
      ms,
      scoreBefore: before.score,
      scoreAfter: after.score,
      delta: before.score - after.score,
      burstAfter: after.burstiness,
      hitsAfter: after.hits.length,
      gatePassed: gate,
      calibratedHumanProbability: calibrated?.calibratedHumanProbability ?? null,
      calibratedLabel: calibrated?.predictedLabel ?? null,
      refinedBlocks: polished.humanizeReport.refinedBlocks,
      yandexAiPct: yandex,
      chars: polished.text.length,
    };
    console.log(
      `  after: score=${after.score} burst=${after.burstiness.toFixed(2)} hits=${after.hits.length} gate=${gate}`
        + ` localH=${row.calibratedHumanProbability ?? "?"}% Δ=${row.delta} ${ms}ms`
        + (yandex != null ? ` yandexAI=${yandex.toFixed(1)}%` : ""),
    );
    return row;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  FAIL: ${message.slice(0, 240)}`);
    return {
      id: candidate.id,
      provider: candidate.provider,
      model: candidate.model || null,
      actualModels: [...actualModels],
      error: message.slice(0, 400),
      scoreBefore: before.score,
      scoreAfter: null,
      delta: null,
      burstAfter: null,
      hitsAfter: null,
      gatePassed: false,
      calibratedHumanProbability: null,
      calibratedLabel: null,
      refinedBlocks: null,
      yandexAiPct: null,
      chars: 0,
    };
  }
}

async function main() {
  console.log("=== Compare humanize providers ===\n");
  const status = getLlmStatus();
  console.log("Configured:", {
    gemini: status.geminiKeys,
    nvidia: status.nvidiaConfigured,
    groq: status.groqConfigured,
    openrouter: status.openrouterConfigured,
    pref: status.providerPreference,
  });
  console.log(`Dirty sample: ${DIRTY_SAMPLE.length} chars, depth=${depth.id}, yandex=${!skipYandex}`);

  const results = [];
  for (const candidate of CANDIDATES) {
    // Пропуск незаконфигуренных
    if (candidate.provider === "nvidia" && !status.nvidiaConfigured) {
      console.log(`\nSKIP ${candidate.id}: no NVIDIA key`);
      continue;
    }
    if (candidate.provider === "gemini" && !status.geminiKeys) {
      console.log(`\nSKIP ${candidate.id}: no Gemini key`);
      continue;
    }
    if (candidate.provider === "groq" && !status.groqConfigured) {
      console.log(`\nSKIP ${candidate.id}: no Groq key`);
      continue;
    }
    if (candidate.provider === "openrouter" && !status.openrouterConfigured) {
      console.log(`\nSKIP ${candidate.id}: no OpenRouter key`);
      continue;
    }
    if (rerankOnly) {
      const saved = rerankSaved(candidate);
      if (saved) results.push(saved);
    } else {
      results.push(await runOne(candidate));
    }
  }

  const ranking = [...results]
    .filter((r) => r.scoreAfter != null && !(Number(r.delta) === 0 && Number(r.scoreAfter) >= 40))
    .sort((a, b) => {
      // Внешняя метка — контроль калибровки; затем локальный calibrated HUMAN%, потом AI-tell.
      const ya = a.yandexAiPct;
      const yb = b.yandexAiPct;
      if (ya != null && yb != null && ya !== yb) return ya - yb;
      if (ya != null && yb == null) return -1;
      if (ya == null && yb != null) return 1;
      const ca = Number(a.calibratedHumanProbability ?? -1);
      const cb = Number(b.calibratedHumanProbability ?? -1);
      if (ca !== cb) return cb - ca;
      return Number(a.scoreAfter) - Number(b.scoreAfter);
    });

  const report = {
    createdAt: new Date().toISOString(),
    depth: "maximum",
    dirtyScore: aiTellScore(DIRTY_SAMPLE).score,
    ranking,
    all: results,
    recommendation: ranking[0]
      ? `Лучший для очеловечивания: ${ranking[0].id} (localH=${ranking[0].calibratedHumanProbability}%, scoreAfter=${ranking[0].scoreAfter}`
        + (ranking[0].yandexAiPct != null ? `, yandexAI=${Number(ranking[0].yandexAiPct).toFixed(1)}%` : "")
        + ")"
      : "Нет успешных прогонов",
  };

  fs.writeFileSync(path.join(outDir, "ranking.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("\n=== Ranking ===");
  for (const row of ranking) {
    console.log(
      `  ${row.id}: localH=${row.calibratedHumanProbability}% score=${row.scoreAfter} (Δ${row.delta}) burst=${Number(row.burstAfter).toFixed(2)}`
        + (row.yandexAiPct != null ? ` yandex=${Number(row.yandexAiPct).toFixed(1)}%` : "")
        + ` ${row.ms}ms`,
    );
  }
  console.log(`\n${report.recommendation}`);
  console.log(`Report: ${path.join(outDir, "ranking.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
