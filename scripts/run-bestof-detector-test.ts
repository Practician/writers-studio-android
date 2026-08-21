/**
 * Live: best-of-N gen + detector AI-only rewrite + Yandex.
 * npx tsx scripts/run-bestof-detector-test.ts
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { aiTellScore } from "../server/humanStyle";
import { generateHumanizedChapter, rewriteDetectorAiSegments } from "../server/chapterGenerate";
import { llmGenerate } from "../server/llmProvider";

dotenv.config({ override: true });

const outDir = path.resolve(process.cwd(), "..", "тест-очеловечивание");
const samplePath = path.resolve(process.cwd(), "..", "лабиринт_.txt");
const model = process.env.NVIDIA_DEFAULT_MODEL || "meta/llama-3.1-70b-instruct";

const generate = async (params: any) => {
  const r = await llmGenerate({ ...params, model: params.model || model });
  console.log(`  [llm ${r.provider}/${r.model}]`);
  return r.text;
};

async function yandex(name: string, text: string) {
  const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://yandex.ru",
      Referer: "https://yandex.ru/lab/neurodetector",
    },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  const report = data.results || data;
  fs.writeFileSync(path.join(outDir, `яндекс-bestof-${name}.json`), JSON.stringify(report, null, 2), "utf8");
  const st = report.stats || {};
  let aiChars = 0;
  let total = 0;
  for (const s of report.segments || []) {
    total += s.len || 0;
    if (s.label === "AI" || s.label === "LIKELY_AI") aiChars += s.len || 0;
  }
  const pct = total ? (100 * aiChars) / total : 0;
  console.log(
    `  Yandex ${name}: AI/LAI=${(st.AI_count || 0) + (st.LIKELY_AI_count || 0)} HUM=${(st.HUMAN_count || 0) + (st.LIKELY_HUMAN_count || 0)} AI%=${pct.toFixed(1)}`,
  );
  return report;
}

async function main() {
  console.log("=== Best-of-N + detector AI rewrite ===\n");
  console.log("model", model);
  const sample = fs.existsSync(samplePath) ? fs.readFileSync(samplePath, "utf8") : "";

  console.log("\n1) Generate chapter best-of-2…");
  const generated = await generateHumanizedChapter({
    title: "Лабиринт. Путь домой",
    genre: "триллер",
    description: "Лабиринт, смартфон, ключи.",
    currentChapterTitle: "Глава 2. Протокол",
    currentChapterSummary: "Разметка пути, шаги, жажда, 3% заряда, правило левой руки, ответвление.",
    previousChapter: sample.slice(0, 2000),
    worldBible: "Метки синие. Уровень 1. Правило левой руки.",
    bookPlan: "Глава 2 — протокол.",
    canonDossier: "Один герой. Смартфон, ключи. Без магии.",
    customPrompt: "Коротко 450–700 слов. Тон как в образце.",
    authorSample: sample.slice(0, 7000),
    voicePreset: "conversational",
    humanizeDepth: "balanced",
    chapterCandidates: 2,
    model,
  }, generate);

  const genScore = aiTellScore(generated.text);
  console.log("  chosen", generated.humanizeReport.chosenCandidate, "of", generated.humanizeReport.candidatesTried);
  console.log("  scores", generated.humanizeReport.candidateScores);
  console.log("  after touchup", genScore.score, "burst", genScore.burstiness.toFixed(2), "gate", generated.humanizeReport.gatePassed);
  fs.writeFileSync(path.join(outDir, "live-bestof-gen.txt"), generated.text, "utf8");
  fs.writeFileSync(
    path.join(outDir, "live-bestof-gen.report.json"),
    JSON.stringify({ score: genScore, report: generated.humanizeReport }, null, 2),
    "utf8",
  );

  console.log("\n2) Yandex on gen…");
  const yandexGen = await yandex("gen", generated.text);

  console.log("\n3) Rewrite AI segments only…");
  const segments = (yandexGen.segments || []).map((s: any) => ({ text: s.text, label: s.label }));
  const aiCount = segments.filter((s: any) => s.label === "AI" || s.label === "LIKELY_AI").length;
  console.log("  AI segments:", aiCount, "/", segments.length);

  const rewritten = await rewriteDetectorAiSegments(segments, generate, {
    model,
    personaBlock: "Инженер, 1 лицо, сухо, конкретно, как глава 1 Лабиринта.",
    humanizeDepth: "balanced",
  });
  const after = aiTellScore(rewritten.text);
  console.log(
    "  rewritten",
    rewritten.rewrittenCount,
    "AI-tell",
    rewritten.humanizeReport.scoreBefore,
    "→",
    after.score,
    "burst",
    after.burstiness.toFixed(2),
    "gate",
    rewritten.humanizeReport.gatePassed,
  );
  fs.writeFileSync(path.join(outDir, "live-bestof-detector.txt"), rewritten.text, "utf8");
  fs.writeFileSync(
    path.join(outDir, "live-bestof-detector.report.json"),
    JSON.stringify({ after, report: rewritten.humanizeReport }, null, 2),
    "utf8",
  );

  console.log("\n4) Yandex after detector rewrite…");
  await yandex("detector", rewritten.text);

  const summary = [
    `# Best-of-N + detector ${new Date().toISOString()}`,
    "",
    `- candidates: ${generated.humanizeReport.candidateScores?.join(", ")} → #${(generated.humanizeReport.chosenCandidate ?? 0) + 1}`,
    `- gen AI-tell after: ${genScore.score}, burst ${genScore.burstiness.toFixed(2)}, gate ${generated.humanizeReport.gatePassed}`,
    `- detector rewritten: ${rewritten.rewrittenCount}`,
    `- after detector AI-tell: ${after.score}, burst ${after.burstiness.toFixed(2)}, gate ${rewritten.humanizeReport.gatePassed}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "live-bestof-summary.md"), summary, "utf8");
  console.log("\n=== DONE ===");
  console.log(summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
