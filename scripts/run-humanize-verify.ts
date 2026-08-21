/**
 * Полный прогон очеловечивания + локальный AI-tell + Яндекс-нейродетектор.
 * npx tsx scripts/run-humanize-verify.ts
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { aiTellScore } from "../server/humanStyle";
import { generateHumanizedChapter, humanizeProseDraft } from "../server/chapterGenerate";
import { getLlmStatus, llmGenerate } from "../server/llmProvider";

dotenv.config({ override: true });

const outDir = path.resolve(process.cwd(), "..", "тест-очеловечивание");
const samplePath = path.resolve(process.cwd(), "..", "лабиринт_.txt");
const aiDraftPath = path.join(outDir, "2-ии-текст-до.txt");

// Предпочитаем NVIDIA (Gemini free tier часто 429)
const model =
  process.env.HUMANIZE_TEST_MODEL
  || process.env.NVIDIA_DEFAULT_MODEL
  || "meta/llama-3.1-70b-instruct";

function scoreLine(label: string, text: string) {
  const s = aiTellScore(text);
  console.log(
    `  ${label}: score=${s.score}/100 burst=${s.burstiness.toFixed(2)} hits=${s.hits.length}` +
      (s.hits.length ? ` [${[...new Set(s.hits.map((h) => h.label))].slice(0, 6).join("; ")}]` : ""),
  );
  return s;
}

async function yandexCheck(name: string, text: string) {
  const payloadPath = path.join(outDir, `payload-live-${name}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify({ text }), "utf8");
  const outPath = path.join(outDir, `яндекс-live-${name}.json`);
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
    console.log(`  Yandex ${name}: HTTP ${res.status} ${raw.slice(0, 200)}`);
    return null;
  }
  const data = JSON.parse(raw);
  const report = data.results || data;
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  const st = report.stats || {};
  const ai = (st.AI_count || 0) + (st.LIKELY_AI_count || 0);
  const hum = (st.HUMAN_count || 0) + (st.LIKELY_HUMAN_count || 0);
  const segs = st.segments_count || 0;
  let aiChars = 0;
  let total = 0;
  for (const seg of report.segments || []) {
    total += seg.len || 0;
    if (seg.label === "AI" || seg.label === "LIKELY_AI") aiChars += seg.len || 0;
  }
  console.log(
    `  Yandex ${name}: classified=${segs} AI/LAI=${ai} HUMAN/LH=${hum}` +
      (total ? ` AI-chars=${((100 * aiChars) / total).toFixed(1)}%` : ""),
  );
  return report;
}

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
    model: params.model || model,
    contents: params.contents,
    systemInstruction: params.systemInstruction,
    temperature: params.temperature,
    responseMimeType: params.responseMimeType,
    responseSchema: params.responseSchema,
    maxOutputTokens: params.maxOutputTokens,
  });
  console.log(`    [llm ${result.provider}/${result.model} failover=${result.failoverCount ?? 0}]`);
  return result.text;
};

async function main() {
  console.log("=== Humanize verification ===\n");
  const status = getLlmStatus();
  console.log("LLM status:", JSON.stringify({
    pref: status.providerPreference,
    geminiKeys: status.geminiKeys,
    nvidia: status.nvidiaConfigured,
    nvidiaModel: status.nvidiaDefaultModel,
    chain: status.nvidiaModelChain.slice(0, 5),
  }));
  console.log("Test model:", model);

  // smoke
  console.log("\n0) Smoke LLM…");
  const smoke = await llmGenerate({
    model,
    contents: "Ответь одним словом: готов",
    systemInstruction: "Коротко.",
    temperature: 0.1,
    maxOutputTokens: 16,
  });
  console.log(`  OK ${smoke.provider}/${smoke.model}: ${smoke.text.slice(0, 80)}`);

  const sample = fs.existsSync(samplePath) ? fs.readFileSync(samplePath, "utf8") : "";
  const aiDraft = fs.readFileSync(aiDraftPath, "utf8");

  // --- 1) Touchup full AI draft (or large window with stamps) ---
  console.log("\n1) Touchup AI-draft (очеловечивание готового текста)…");
  // full text may be long; use ~8k for cost/speed
  const touchSlice = aiDraft.length > 9000 ? aiDraft.slice(0, 9000) : aiDraft;
  const beforeTouch = scoreLine("before", touchSlice);
  const polished = await humanizeProseDraft(touchSlice, generate, {
    model,
    personaBlock:
      "Рассказчик — инженер от первого лица, сухо, конкретно, с лёгкой бытовой иронией. Как в главе 1 «Лабиринт».",
    humanizeDepth: "balanced",
  });
  const afterTouch = scoreLine("after ", polished.text);
  fs.writeFileSync(path.join(outDir, "live-verify-touchup.txt"), polished.text, "utf8");
  fs.writeFileSync(
    path.join(outDir, "live-verify-touchup.report.json"),
    JSON.stringify({ before: beforeTouch, after: afterTouch, report: polished.humanizeReport }, null, 2),
    "utf8",
  );
  console.log("  humanizeReport:", JSON.stringify(polished.humanizeReport));

  // --- 2) Generate short chapter with scenes ---
  console.log("\n2) Generate chapter (balanced / scenes)…");
  let genText = "";
  let genReport: any = null;
  try {
    const generated = await generateHumanizedChapter({
      title: "Лабиринт. Путь домой",
      genre: "психологический триллер / выживание",
      description: "Герой в тёмном лабиринте со смартфоном.",
      currentChapterTitle: "Глава 2. Протокол (тест)",
      currentChapterSummary:
        "Герой размечает путь ключом, считает шаги, следует правилу левой руки, жажда, заряд 3%.",
      previousChapter: sample.slice(0, 2200) || "Темнота. Уровень 1. Заряд низкий.",
      worldBible: "Метки ключом светятся синим. Правило левой руки. Смартфон показывает уровень.",
      bookPlan: "Глава 2 — протокол разметки.",
      canonDossier: "Один герой. Ключи, смартфон. Уровень 1. Без магии.",
      customPrompt: "Коротко, 500–800 слов. Тон как в образце. Без новых технологий.",
      authorSample: sample.slice(0, 7000),
      voicePreset: "conversational",
      humanizeDepth: "balanced",
      model,
    }, generate);
    genText = generated.text;
    genReport = generated.humanizeReport;
    scoreLine("generated", genText);
    console.log("  humanizeReport:", JSON.stringify(genReport));
    fs.writeFileSync(path.join(outDir, "live-verify-gen.txt"), genText, "utf8");
    fs.writeFileSync(
      path.join(outDir, "live-verify-gen.report.json"),
      JSON.stringify({ score: aiTellScore(genText), report: genReport }, null, 2),
      "utf8",
    );
  } catch (error: any) {
    console.error("  GEN FAIL:", error?.status || "", String(error?.message || error).slice(0, 300));
  }

  // --- 3) Yandex ---
  console.log("\n3) Yandex neurodetector…");
  await yandexCheck("touchup-before", touchSlice);
  await yandexCheck("touchup-after", polished.text);
  if (genText) await yandexCheck("gen-chapter", genText);

  // summary
  console.log("\n=== SUMMARY ===");
  console.log(`Touchup AI-tell: ${beforeTouch.score} → ${afterTouch.score} (Δ ${beforeTouch.score - afterTouch.score})`);
  console.log(`Touchup hits:    ${beforeTouch.hits.length} → ${afterTouch.hits.length}`);
  console.log(`Touchup gate:    ${polished.humanizeReport.gatePassed} refined=${polished.humanizeReport.refinedBlocks}`);
  console.log(`Touchup burst:   ${afterTouch.burstiness.toFixed(2)}`);
  if (genReport) {
    console.log(`Gen AI-tell:     ${genReport.scoreBefore} → ${genReport.scoreAfter}`);
    console.log(`Gen scenes:      ${genReport.scenesGenerated} mode=${genReport.mode} gate=${genReport.gatePassed}`);
    console.log(`Gen burst:       ${genReport.burstiness?.toFixed?.(2) ?? aiTellScore(genText).burstiness.toFixed(2)}`);
  }
  console.log(`Artifacts: ${outDir}/live-verify-*`);

  const genScore = genText ? aiTellScore(genText) : null;
  const kpis = {
    touchupScoreAfter: afterTouch.score,
    touchupHitsAfter: afterTouch.hits.length,
    touchupImproved: afterTouch.score < beforeTouch.score,
    genScoreAfter: genScore?.score ?? null,
    genHitsAfter: genScore?.hits.length ?? null,
    genGate: genReport?.gatePassed ?? null,
    genBurstiness: genScore?.burstiness ?? null,
    genScenes: genReport?.scenesGenerated ?? null,
  };
  const pass =
    kpis.touchupImproved
    && kpis.touchupHitsAfter === 0
    && (genScore == null || (genScore.score <= 12 && genScore.hits.length === 0));

  const md = [
    `# Humanize verify ${new Date().toISOString()}`,
    "",
    `Model: \`${model}\``,
    "",
    "## Touchup",
    `- AI-tell: **${beforeTouch.score} → ${afterTouch.score}**`,
    `- hits: ${beforeTouch.hits.length} → ${afterTouch.hits.length}`,
    `- gate: ${polished.humanizeReport.gatePassed}, refined: ${polished.humanizeReport.refinedBlocks}`,
    `- burstiness: ${afterTouch.burstiness.toFixed(2)}`,
    "",
    "## Generation",
    genReport
      ? [
          `- AI-tell: **${genReport.scoreBefore} → ${genReport.scoreAfter}**`,
          `- scenes: ${genReport.scenesGenerated}, mode: ${genReport.mode}`,
          `- gate: ${genReport.gatePassed}`,
          `- burstiness: ${(genScore?.burstiness ?? 0).toFixed(2)}`,
        ].join("\n")
      : "- failed or skipped",
    "",
    `## KPI overall: **${pass ? "PASS" : "REVIEW"}**`,
    "",
    "```json",
    JSON.stringify(kpis, null, 2),
    "```",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "live-verify-summary.md"), md, "utf8");
  console.log(`\nSummary: ${path.join(outDir, "live-verify-summary.md")}`);
  console.log(pass ? "KPI: PASS" : "KPI: REVIEW (see summary)");
  if (!pass) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
