// Живой тест пайплайна очеловечивания.
// 1) Touchup существующего ИИ-текста
// 2) Генерация короткой главы (режим balanced, flash)
//
// node --import tsx scripts/run-humanize-live-test.mjs
// или: npx tsx scripts/run-humanize-live-test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { aiTellScore } from "../server/humanStyle.ts";
import { generateHumanizedChapter, humanizeProseDraft } from "../server/chapterGenerate.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(root, ".env") });

const outDir = path.resolve(root, "..", "тест-очеловечивание");
const samplePath = path.resolve(root, "..", "лабиринт_.txt");
const model = process.env.HUMANIZE_TEST_MODEL || "gemini-2.5-flash";

function keys() {
  return [...new Set(
    [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3]
      .filter(Boolean)
      .join(",")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  )];
}

function makeGenerate(ai) {
  return async (params) => {
    const response = await ai.models.generateContent({
      model: params.model,
      contents: params.contents,
      config: {
        systemInstruction: params.systemInstruction,
        temperature: params.temperature,
        responseMimeType: params.responseMimeType,
        responseSchema: params.responseSchema,
        maxOutputTokens: params.maxOutputTokens ?? 8192,
        ...(params.model.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });
    const text = response.text;
    if (!text?.trim()) throw new Error("empty model response");
    return text;
  };
}

function report(label, before, after, meta = {}) {
  console.log(`\n=== ${label} ===`);
  console.log(`AI-tell: ${before.score} → ${after.score} (Δ ${before.score - after.score})`);
  console.log(`burst: ${before.burstiness.toFixed(2)} → ${after.burstiness.toFixed(2)}`);
  console.log(`hits: ${before.hits.length} → ${after.hits.length}`);
  if (after.hits.length) {
    console.log(`remaining: ${[...new Set(after.hits.map((h) => h.label))].join("; ")}`);
  }
  if (meta.depth) console.log(`depth=${meta.depth} mode=${meta.mode} scenes=${meta.scenesGenerated} refined=${meta.refinedBlocks} gate=${meta.gatePassed}`);
}

async function main() {
  const apiKeys = keys();
  if (!apiKeys.length) {
    console.error("No GEMINI_API_KEY");
    process.exit(1);
  }
  const ai = new GoogleGenAI({ apiKey: apiKeys[0] });
  const generate = makeGenerate(ai);
  const sample = fs.existsSync(samplePath) ? fs.readFileSync(samplePath, "utf8") : "";
  console.log(`Model: ${model}`);
  console.log(`Author sample: ${sample.length} chars`);

  // --- 1. Touchup AI draft ---
  const aiDraftPath = path.join(outDir, "2-ии-текст-до.txt");
  if (fs.existsSync(aiDraftPath)) {
    const draft = fs.readFileSync(aiDraftPath, "utf8");
    // Use first ~3500 chars to save quota / time
    const slice = draft.slice(0, 3500);
    const before = aiTellScore(slice);
    console.log("\nRunning touchup on AI draft slice...");
    const polished = await humanizeProseDraft(slice, generate, {
      model,
      personaBlock: "Рассказчик — инженер от первого лица, сухо, конкретно, с лёгкой иронией.",
      humanizeDepth: "balanced",
    });
    const after = aiTellScore(polished.text);
    report("Touchup 2-ии-текст-до (slice)", before, after, polished.humanizeReport);
    fs.writeFileSync(path.join(outDir, "live-touchup-ai-slice.txt"), polished.text, "utf8");
    fs.writeFileSync(
      path.join(outDir, "live-touchup-ai-slice.report.json"),
      JSON.stringify({ before, after, report: polished.humanizeReport }, null, 2),
      "utf8",
    );
  }

  // --- 2. Generate short chapter with scenes ---
  console.log("\nGenerating chapter (balanced / scenes)...");
  const generated = await generateHumanizedChapter({
    title: "Лабиринт. Путь домой",
    genre: "психологический триллер / выживание",
    description: "Герой просыпается в тёмном лабиринте с почти разряженным смартфоном.",
    currentChapterTitle: "Глава 2. Протокол",
    currentChapterSummary:
      "После зарядки и киселя герой осознаёт, что нужно системно размечать путь. Он процарапывает стрелку, запускает протокол, считает шаги, находит ответвление, но следует правилу левой руки. Жажда и 3% заряда.",
    previousChapter: sample.slice(0, 2500) || "Герой в темноте, уровень 1, тепловизор, заряд низкий.",
    worldBible: "Лабиринт меняет геометрию. Смартфон показывает уровень. Метки ключом светятся синим. Правило левой руки — земной алгоритм, не всегда работает.",
    bookPlan: "Глава 2 — протокол и первый круг разметки.",
    canonDossier: "Герой один. Смартфон, связка ключей. Заряд ~3–20%. Уровень 1. Нет магии, нет других людей в сцене.",
    customPrompt: "Коротко, ~600–900 слов. Без новых технологий. Тон как в образце автора.",
    authorSample: sample.slice(0, 8000),
    voicePreset: "conversational",
    humanizeDepth: "balanced",
    model,
  }, generate);

  const genScore = aiTellScore(generated.text);
  report("Generated chapter", { score: generated.humanizeReport.scoreBefore, burstiness: 0, hits: [] }, genScore, generated.humanizeReport);
  fs.writeFileSync(path.join(outDir, "live-gen-chapter2.txt"), generated.text, "utf8");
  fs.writeFileSync(
    path.join(outDir, "live-gen-chapter2.report.json"),
    JSON.stringify({ score: genScore, report: generated.humanizeReport }, null, 2),
    "utf8",
  );
  console.log(`\nSaved outputs to ${outDir}`);
  console.log(`Final gen score: ${genScore.score}/100, gate=${generated.humanizeReport.gatePassed}, scenes=${generated.humanizeReport.scenesGenerated}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
