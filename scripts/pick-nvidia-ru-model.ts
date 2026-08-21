/**
 * Короткий бенч NVIDIA-моделей для русской прозы.
 * npx tsx scripts/pick-nvidia-ru-model.ts
 */
import dotenv from "dotenv";
import { russianLanguageIssues, countWordsRu } from "../server/chapterGenerate";
import { aiTellScore } from "../server/humanStyle";

dotenv.config({ override: true });

const MODELS = [
  "qwen/qwen3-next-80b-a3b-instruct",
  "qwen/qwen3.5-122b-a10b",
  "google/gemma-4-31b-it",
  "google/gemma-3-12b-it",
  "nvidia/llama-3.3-nemotron-super-49b-v1",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "meta/llama-3.3-70b-instruct",
  "deepseek-ai/deepseek-v4-flash",
  "mistralai/mistral-large-2-instruct",
  "meta/llama-3.1-70b-instruct", // baseline
];

const PROMPT = `Напиши фрагмент художественной прозы от первого лица на русском (350–450 слов).
Студент в тёмном лабиринте находит зеленоватое число 20 и мятно-медовую массу, ест, кладёт телефон на зарядку.
Жёстко: только русский язык, без английских слов и латиницы. Без markdown. Без заголовка.`;

async function call(model: string): Promise<{ text: string; ms: number; error?: string }> {
  const key = process.env.NVIDIA_API_KEY!;
  const t0 = Date.now();
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Ты русский писатель. Пиши только по-русски. Запрещены английские слова и латиница. Цифры допустимы.",
          },
          { role: "user", content: PROMPT },
        ],
        temperature: 0.85,
        max_tokens: 4096,
        stream: false,
      }),
    });
    const raw = await res.text();
    if (!res.ok) return { text: "", ms: Date.now() - t0, error: `${res.status} ${raw.slice(0, 120)}` };
    const data = JSON.parse(raw);
    const text = (data.choices?.[0]?.message?.content || "").trim();
    return { text, ms: Date.now() - t0 };
  } catch (e: any) {
    return { text: "", ms: Date.now() - t0, error: String(e.message || e).slice(0, 120) };
  }
}

function scoreText(text: string) {
  const words = countWordsRu(text);
  const lang = russianLanguageIssues(text);
  const tell = aiTellScore(text);
  // rank: lower better for lang issues; higher words good; lower ai-tell good
  const rank =
    lang.length * 40
    + Math.max(0, 320 - words) * 0.15
    + tell.score * 0.5
    + (tell.burstiness < 0.4 ? 10 : 0);
  return { words, lang, tell, rank };
}

async function main() {
  console.log("=== NVIDIA RU prose benchmark ===\n");
  const rows: any[] = [];
  for (const model of MODELS) {
    process.stdout.write(`… ${model}\n`);
    const r = await call(model);
    if (r.error || !r.text) {
      console.log(`  FAIL ${r.error || "empty"} (${r.ms}ms)\n`);
      rows.push({ model, ok: false, error: r.error, ms: r.ms, rank: 9999 });
      continue;
    }
    const s = scoreText(r.text);
    console.log(
      `  words=${s.words} lang=${s.lang.length ? s.lang[0] : "OK"} ai-tell=${s.tell.score} burst=${s.tell.burstiness.toFixed(2)} rank=${s.rank.toFixed(1)} ${r.ms}ms`,
    );
    console.log(`  sample: ${r.text.replace(/\s+/g, " ").slice(0, 140)}…\n`);
    rows.push({
      model,
      ok: true,
      words: s.words,
      langIssues: s.lang.length,
      aiTell: s.tell.score,
      burst: s.tell.burstiness,
      rank: s.rank,
      ms: r.ms,
      sample: r.text.slice(0, 200),
    });
  }
  rows.sort((a, b) => a.rank - b.rank);
  console.log("=== RANKING (best first) ===");
  for (const row of rows) {
    if (!row.ok) {
      console.log(`FAIL  ${row.model} — ${row.error}`);
    } else {
      console.log(
        `${row.rank.toFixed(1).padStart(6)}  ${row.model}  w=${row.words} langIss=${row.langIssues} tell=${row.aiTell} burst=${row.burst.toFixed(2)}`,
      );
    }
  }
  const best = rows.find((r) => r.ok);
  if (best) {
    console.log("\nBEST:", best.model);
    const fs = await import("node:fs");
    fs.writeFileSync(
      "test-artifacts/nvidia-ru-benchmark.json",
      JSON.stringify({ best: best.model, rows, at: new Date().toISOString() }, null, 2),
      "utf8",
    );
  }
}

main().catch(console.error);
