/**
 * Берёт live yandex-*.json + текст, переписывает только AI/LIKELY_AI через LLM, снова шлёт в Яндекс.
 * npx tsx scripts/yandex-rewrite-ai-segments.ts ch7|ch8
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import dotenv from "dotenv";
dotenv.config({ override: false });

import { rewriteDetectorAiSegments } from "../server/chapterGenerate";
import { llmGenerate, runWithProviderPreference } from "../server/llmProvider";
import { LABYRINTH_AUTHOR_SAMPLE, LABYRINTH_VOICE_SHEET } from "../src/data/labyrinthCanon";

const which = process.argv[2] || "ch8";
const outDir = path.join(process.cwd(), "test-artifacts", "yandex-recal");
const reportPath = path.join(outDir, `yandex-${which}-seed.json`);
const textPath = path.join(process.cwd(), "src", "data", "labyrinth", which === "ch7" ? "chapter-7.txt" : "chapter-8.txt");

function postYandex(text: string, name: string): Promise<any> {
  return new Promise((resolve, reject) => {
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
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            const j = JSON.parse(raw);
            resolve(j.results || j);
          } catch (e) {
            reject(new Error(`Yandex ${res.statusCode}: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function aiPct(report: any): number {
  let ai = 0;
  let tot = 0;
  for (const s of report.segments || []) {
    tot += s.len || (s.text || "").length;
    if (s.label === "AI" || s.label === "LIKELY_AI") ai += s.len || (s.text || "").length;
  }
  return tot ? (100 * ai) / tot : 0;
}

async function main() {
  if (!fs.existsSync(reportPath)) throw new Error(`no report ${reportPath}`);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  let text = fs.readFileSync(textPath, "utf8");
  console.log("base", which, "segs", report.segments?.length, "AI%", aiPct(report).toFixed(1));

  const generate = async (params: any) => {
    const r = await llmGenerate({
      model: params.model || process.env.NVIDIA_DEFAULT_MODEL || "deepseek-ai/deepseek-v4-flash",
      contents: params.contents,
      systemInstruction: params.systemInstruction,
      temperature: params.temperature,
      responseMimeType: params.responseMimeType,
      responseSchema: params.responseSchema,
      maxOutputTokens: params.maxOutputTokens,
    });
    console.log(`  llm ${r.provider}/${r.model}`);
    return r.text;
  };

  // Extra system nudge in persona
  const persona =
    LABYRINTH_VOICE_SHEET.summary
    + "\n"
    + LABYRINTH_VOICE_SHEET.voiceRules.join("\n")
    + "\nПиши как гл.1 «Лабиринт»: длинные бытовые фразы, «однако», «ну», самоирония, без квест-лога и без рубленых «Сел. Встал. Пошёл.»";

  const result = await runWithProviderPreference("nvidia", () =>
    rewriteDetectorAiSegments(
      (report.segments || []).map((s: any) => ({ text: s.text, label: s.label })),
      generate,
      {
        model: process.env.NVIDIA_DEFAULT_MODEL || "deepseek-ai/deepseek-v4-flash",
        personaBlock: persona,
        humanizeDepth: "maximum",
      },
    ),
  );

  // Reassemble: replace AI segments in original by matching text; if fail use result.text as whole
  let next = text;
  for (const seg of report.segments || []) {
    if (seg.label !== "AI" && seg.label !== "LIKELY_AI") continue;
    // result.text is full reassembly of all segments in order
  }
  // Prefer full reassembly from pipeline
  if (result.text && result.text.length > text.length * 0.5) {
    next = result.text;
  }

  // Soft anti-ui
  next = next
    .replace(/\bNFC\b/g, "метка")
    .replace(/обнаружена\s+новая\s+метка/giu, "телефон коротко бзикнул")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";

  fs.writeFileSync(path.join(outDir, `${which}-rewritten.txt`), next, "utf8");
  const chapterFile = which === "ch7" ? "chapter-7" : "chapter-8";
  fs.writeFileSync(path.join(process.cwd(), "src", "data", "labyrinth", `${chapterFile}.txt`), next, "utf8");
  fs.writeFileSync(
    path.join(process.cwd(), "src", "data", "labyrinth", `${chapterFile}.content.ts`),
    `const text = ${JSON.stringify(next)};\nexport default text;\n`,
    "utf8",
  );
  console.log("rewritten words", next.split(/\s+/).filter(Boolean).length, "refined", result.rewrittenCount);

  const y2 = await postYandex(next, `${which}-after-rewrite`);
  fs.writeFileSync(path.join(outDir, `yandex-${which}-after-rewrite.json`), JSON.stringify(y2, null, 2), "utf8");
  console.log(
    `Yandex after: AI%=${aiPct(y2).toFixed(1)} H=${y2.stats?.HUMAN_count} AI=${y2.stats?.AI_count} LA=${y2.stats?.LIKELY_AI_count}`,
  );
  for (const s of y2.segments || []) {
    if (s.label === "AI" || s.label === "LIKELY_AI") {
      console.log(" still", s.label, s.text.slice(0, 160).replace(/\n/g, " "));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
