import fs from "node:fs";
import path from "node:path";

const outDir = "test-artifacts/chapter6-optimal";
const parent = path.resolve("..");
const files = [
  path.join(outDir, "глава-6-optimal.txt"),
  path.join(parent, "Главы", "Глава-6-Число-20-очеловеченная", "глава-6.txt"),
  path.join(parent, "Главы", "Глава-6-Число-20-очеловеченная", "глава-6-после-детектор.txt"),
  path.join(parent, "Главы", "Глава-6-Число-20-очеловеченная", "глава-6-чистый-русский.txt"),
  path.join(parent, "Главы", "Глава-6-Число-20-очеловеченная", "глава-6-финал.txt"),
  path.join(parent, "Главы", "Глава-6-через-приложение", "глава-6-финал.txt"),
  path.join("test-artifacts", "chapter6", "глава-6-финал.txt"),
];

async function once(text: string) {
  const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://yandex.ru",
      Referer: "https://yandex.ru/lab/neurodetector",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  const r = data.results || data;
  const st = r.stats || {};
  let ai = 0;
  let tot = 0;
  for (const s of r.segments || []) {
    const len = s.len || (s.text || "").length;
    tot += len;
    if (s.label === "AI" || s.label === "LIKELY_AI") ai += len;
  }
  return { pct: tot ? (100 * ai) / tot : 0, st, report: r };
}

const results: any[] = [];
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log("skip", f);
    continue;
  }
  const text = fs.readFileSync(f, "utf8");
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 400) continue;
  const runs = [];
  for (let i = 0; i < 3; i += 1) {
    runs.push(await once(text));
    await new Promise((r) => setTimeout(r, 700));
  }
  const avg = runs.reduce((a, b) => a + b.pct, 0) / runs.length;
  const zeros = runs.filter((r) => r.pct === 0).length;
  const bestRun = runs.reduce((a, b) => (a.pct <= b.pct ? a : b));
  console.log(
    `${words} avgAI%=${avg.toFixed(1)} zeros=${zeros}/3 best=${bestRun.pct.toFixed(1)} H=${bestRun.st.HUMAN_count || 0} AI=${bestRun.st.AI_count || 0} LAI=${bestRun.st.LIKELY_AI_count || 0} ${path.basename(f)}`,
  );
  results.push({ f, text, words, avg, zeros, bestRun, runs });
}

results.sort((a, b) => b.zeros - a.zeros || a.avg - b.avg || b.words - a.words);
const win = results[0];
if (!win) {
  console.error("no results");
  process.exit(1);
}
console.log("\nWINNER", path.basename(win.f), "words", win.words, "avgAI%", win.avg.toFixed(1), "zeroRuns", win.zeros);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "глава-6-optimal.txt"), win.text, "utf8");
fs.writeFileSync(path.join("test-artifacts", "chapter6", "глава-6-optimal.txt"), win.text, "utf8");
fs.writeFileSync(
  path.join(outDir, "stability.json"),
  JSON.stringify(
    results.map((r) => ({
      file: r.f,
      words: r.words,
      avgAiPct: r.avg,
      zeroRuns: r.zeros,
      bestAiPct: r.bestRun.pct,
      statsBest: r.bestRun.st,
    })),
    null,
    2,
  ),
  "utf8",
);
fs.writeFileSync(
  path.join(outDir, "отчёт-optimal.txt"),
  [
    `best_file=${win.f}`,
    `words=${win.words}`,
    `yandex_avg_ai_pct=${win.avg.toFixed(1)}`,
    `yandex_zero_runs=${win.zeros}/3`,
    `yandex_best_ai_pct=${win.bestRun.pct.toFixed(1)}`,
    `HUMAN=${win.bestRun.st.HUMAN_count || 0}`,
    `LIKELY_HUMAN=${win.bestRun.st.LIKELY_HUMAN_count || 0}`,
    `AI=${win.bestRun.st.AI_count || 0}`,
    `LIKELY_AI=${win.bestRun.st.LIKELY_AI_count || 0}`,
    `kpi=${win.avg === 0 && win.words >= 1500 ? "PASS_STABLE" : win.zeros >= 2 && win.words >= 1500 ? "PASS_MOSTLY" : win.avg <= 15 && win.words >= 1500 ? "GOOD" : "REVIEW"}`,
    `note=Детектор Яндекса нестабилен (разброс между прогонами). Оптимум = макс. нулевых AI% при ≥1500 слов.`,
  ].join("\n"),
  "utf8",
);
console.log("saved", path.join(outDir, "глава-6-optimal.txt"));
