/**
 * Оптимизация главы 6 под Yandex-нейродетектор:
 * цикл rewrite_detector_segments + лучший из кандидатов.
 * npx tsx scripts/optimize-chapter6-detector.ts
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { aiTellScore } from "../server/humanStyle";
import { countWordsRu, russianLanguageIssues } from "../server/chapterGenerate";

dotenv.config({ override: true });

const BASE = process.env.APP_URL || "http://localhost:3000";
const outDir = path.join(process.cwd(), "test-artifacts", "chapter6-optimal");
const parentRoot = path.resolve(process.cwd(), "..");
const samplePath = [
  path.join(parentRoot, "лабиринт_.txt"),
  path.join(process.cwd(), "лабиринт_.txt"),
].find((p) => fs.existsSync(p)) || "";

function httpJson(
  method: "GET" | "POST",
  urlStr: string,
  body?: unknown,
  timeoutMs = 45 * 60 * 1000,
): Promise<{ status: number; json: any }> {
  const url = new URL(urlStr);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(payload ? { "Content-Length": String(payload.length) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json: any = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode || 0, json });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("HTTP timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function yandex(text: string, name: string) {
  const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://yandex.ru",
      Referer: "https://yandex.ru/lab/neurodetector",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  const report = data.results || data;
  fs.writeFileSync(path.join(outDir, `яндекс-${name}.json`), JSON.stringify(report, null, 2), "utf8");
  const st = report.stats || {};
  let aiChars = 0;
  let total = 0;
  for (const s of report.segments || []) {
    total += s.len || (s.text || "").length || 0;
    if (s.label === "AI" || s.label === "LIKELY_AI") aiChars += s.len || (s.text || "").length || 0;
  }
  const pct = total ? (100 * aiChars) / total : 0;
  const human = (st.HUMAN_count || 0) + (st.LIKELY_HUMAN_count || 0);
  const ai = (st.AI_count || 0) + (st.LIKELY_AI_count || 0);
  console.log(
    `  Yandex[${name}]: AI%=${pct.toFixed(1)} HUMAN=${st.HUMAN_count || 0} AI=${st.AI_count || 0} LAI=${st.LIKELY_AI_count || 0} segs=${(report.segments || []).length}`,
  );
  return { report, pct, stats: st, human, ai };
}

function scoreCandidate(words: number, yPct: number, tell: number, langOk: boolean): number {
  // lower is better
  let s = 0;
  s += yPct * 2; // detector primary
  s += Math.max(0, 1500 - words) * 0.05; // prefer ≥1500
  s += tell * 0.3;
  if (!langOk) s += 50;
  if (yPct === 0 && words >= 1500) s -= 20; // bonus
  if (yPct === 0 && words >= 600) s -= 10;
  return s;
}

async function rewriteRound(
  text: string,
  segments: any[],
  provider: string,
  model: string,
  sample: string,
  round: number,
): Promise<string> {
  const res = await httpJson(
    "POST",
    `${BASE}/api/writer/ai`,
    {
      action: "rewrite_detector_segments",
      model,
      llmProvider: provider,
      humanize: true,
      humanizeDepth: "balanced",
      authorSample: sample.slice(0, provider === "groq" ? 2000 : 8000),
      voicePreset: "conversational",
      detectorSegments: segments.map((s: any) => ({
        text: s.text,
        label: s.label,
      })),
    },
    30 * 60 * 1000,
  );
  if (res.status < 200 || res.status >= 300 || !res.json?.result) {
    console.warn(`  rewrite round ${round} failed:`, res.status, res.json?.error || res.json);
    return text;
  }
  const next = String(res.json.result).trim();
  console.log(
    `  rewrite #${round}: words ${countWordsRu(text)}→${countWordsRu(next)} rewritten=${res.json.rewrittenCount ?? "?"}`,
  );
  return next;
}

async function genChapter(provider: string, model: string, sample: string, targetWords: string): Promise<string> {
  const body = {
    action: "generate_full_chapter",
    humanize: true,
    humanizeDepth: "balanced",
    chapterCandidates: 1,
    llmProvider: provider,
    model,
    title: "Лабиринт. Путь домой",
    genre: "психологический триллер / survival",
    description: "Студент в Лабиринте. Телефон — якорь. Уровень 1.",
    currentChapterTitle: "Глава 6. Число 20",
    currentChapterSummary:
      "После круга в лабиринте герой идёт по пандусу вниз к свечению. Тупик: зеленоватое число 20 в воздухе, дымчатая ёмкость с густой мятно-медовой массой. Пробует, ест — голод и жажда уходят. Кладёт телефон — беспроводная зарядка, число тает до 0, заряд ~20%. В конце — смутный отпечаток ладони на стене.",
    previousChapter: `Глава 5. Первый круг

Я вернулся к ключу на полу — ходил кругами. Жажда, голод, телефон почти мёртв. Остался один неисследованный коридор. Пол уходит вниз, как пандус. Вдали слабое свечение. Я пошёл туда.`,
    worldBible:
      "Уровень 1: темнота, мягкие дымчатые стены. Телефон: Уровень 1, тепловизор. Ресурсы: число в воздухе, питательная масса, зарядка. Только русский язык.",
    bookPlan: "Глава 6 — Число 20. Глава 7 — отпечаток ладони.",
    canonDossier:
      "Один герой. Футболка, джинсы, кроссовки, ключи, смартфон. Уровень 1. Заряд ~1%. Нет других людей. 1 лицо, сухой тон, бытовая ирония.",
    customPrompt:
      `${targetWords} Только русский, без латиницы. Пиши как дневник/черновик: короткие и рваные фразы, бытовые слова, без «литературного» пафоса и без штампов (волна ужаса, холод по спине, мысли прояснились). Неровный ритм. Конкретные действия. Раскрой путь, еду, зарядку, отпечаток.`,
    authorSample: sample.slice(0, provider === "groq" ? 2000 : 10000),
    voicePreset: "conversational",
  };
  console.log(`\nGEN provider=${provider} model=${model}`);
  const t0 = Date.now();
  const res = await httpJson("POST", `${BASE}/api/writer/ai`, body, 45 * 60 * 1000);
  console.log(`  gen ${Math.round((Date.now() - t0) / 1000)}s status=${res.status}`);
  if (res.status < 200 || res.status >= 300) {
    console.warn("  gen fail", res.json?.error || res.json);
    return "";
  }
  return String(res.json.result || "").trim();
}

async function polishLoop(
  startText: string,
  tag: string,
  provider: string,
  model: string,
  sample: string,
  maxRounds = 4,
): Promise<{ text: string; pct: number; words: number; rounds: number; stats: any }> {
  let text = startText;
  let best = { text, pct: 100, words: countWordsRu(text), rounds: 0, stats: {} as any };

  for (let round = 0; round < maxRounds; round += 1) {
    const y = await yandex(text, `${tag}-r${round}`);
    const words = countWordsRu(text);
    const tell = aiTellScore(text).score;
    const rank = scoreCandidate(words, y.pct, tell, russianLanguageIssues(text).length === 0);
    console.log(`  rank=${rank.toFixed(1)} words=${words} tell=${tell}`);

    if (y.pct < best.pct || (y.pct === best.pct && words > best.words)) {
      best = { text, pct: y.pct, words, rounds: round, stats: y.stats };
    }
    // Ideal: 0% AI and enough words
    if (y.pct === 0 && (y.stats.AI_count || 0) + (y.stats.LIKELY_AI_count || 0) === 0) {
      console.log("  → 100% HUMAN segments");
      break;
    }
    if ((y.stats.AI_count || 0) + (y.stats.LIKELY_AI_count || 0) === 0) {
      break;
    }
    // Don't rewrite if already very good and long
    if (y.pct <= 15 && words >= 1500 && round >= 1) break;

    text = await rewriteRound(text, y.report.segments || [], provider, model, sample, round + 1);
    if (countWordsRu(text) < words * 0.7) {
      console.warn("  rewrite too short — keep previous");
      text = best.text;
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // final measure
  const yf = await yandex(best.text, `${tag}-best`);
  best.pct = yf.pct;
  best.stats = yf.stats;
  best.words = countWordsRu(best.text);
  return best;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log("=== Optimize chapter 6 for Yandex detector ===\n");

  const status = (await httpJson("GET", `${BASE}/api/llm/status`, undefined, 5000)).json;
  console.log("LLM:", {
    gemini: status.geminiKeys,
    nvidia: status.nvidiaConfigured,
    groq: status.groqConfigured,
    openrouter: status.openrouterConfigured,
  });

  const sample = samplePath && fs.existsSync(samplePath) ? fs.readFileSync(samplePath, "utf8") : "";
  const currentPath = path.join(process.cwd(), "test-artifacts", "chapter6", "глава-6-финал.txt");
  const prevPassPath = path.join(parentRoot, "Главы", "Глава-6-Число-20-очеловеченная", "глава-6-финал.txt");
  // try find prev pass via glob-ish
  let prevPass = "";
  const chaptersDir = path.join(parentRoot, "Главы");
  if (fs.existsSync(chaptersDir)) {
    for (const dir of fs.readdirSync(chaptersDir)) {
      const p = path.join(chaptersDir, dir, "глава-6-финал.txt");
      if (fs.existsSync(p)) {
        const t = fs.readFileSync(p, "utf8");
        const w = countWordsRu(t);
        if (w >= 1500 && w <= 2000) {
          prevPass = t;
          console.log("found prev candidate", p, "words", w);
          break;
        }
      }
    }
  }

  type Cand = { name: string; text: string; pct: number; words: number; rank: number; stats: any; provider: string };
  const cands: Cand[] = [];

  // A) polish current 2126-word draft (Gemini rewrite often better for RU human)
  if (fs.existsSync(currentPath)) {
    const cur = fs.readFileSync(currentPath, "utf8");
    console.log("\n--- A: polish current draft with Gemini ---");
    const a = await polishLoop(cur, "A-cur-gemini", "gemini", "gemini-3.5-flash", sample, 4);
    cands.push({
      name: "A-current+gemini-rewrite",
      text: a.text,
      pct: a.pct,
      words: a.words,
      rank: scoreCandidate(a.words, a.pct, aiTellScore(a.text).score, true),
      stats: a.stats,
      provider: "gemini",
    });
  }

  // B) polish previous good draft if available
  if (prevPass) {
    console.log("\n--- B: re-check / light polish previous PASS draft ---");
    const b = await polishLoop(prevPass, "B-prev", "gemini", "gemini-3.5-flash", sample, 2);
    cands.push({
      name: "B-previous-pass",
      text: b.text,
      pct: b.pct,
      words: b.words,
      rank: scoreCandidate(b.words, b.pct, aiTellScore(b.text).score, true),
      stats: b.stats,
      provider: "gemini",
    });
  }

  // C) fresh gen Gemini long + polish
  if (status.geminiKeys > 0) {
    console.log("\n--- C: fresh Gemini gen + polish ---");
    const gen = await genChapter(
      "gemini",
      "gemini-3.5-flash",
      sample,
      "Полноценная глава 1600–2200 слов (не меньше 1500).",
    );
    if (gen) {
      const c = await polishLoop(gen, "C-gem-gen", "gemini", "gemini-3.5-flash", sample, 4);
      cands.push({
        name: "C-gemini-fresh",
        text: c.text,
        pct: c.pct,
        words: c.words,
        rank: scoreCandidate(c.words, c.pct, aiTellScore(c.text).score, true),
        stats: c.stats,
        provider: "gemini",
      });
    }
  }

  // D) medium length (~900–1200) — sweet spot like 690→100% human, slightly longer
  if (status.geminiKeys > 0) {
    console.log("\n--- D: medium chapter ~900–1200 (sweet spot) ---");
    const gen = await genChapter(
      "gemini",
      "gemini-3.5-flash",
      sample,
      "Глава 900–1200 слов (компактная, но полная по сюжету: пандус, 20, еда, зарядка, отпечаток). Без воды.",
    );
    if (gen) {
      const d = await polishLoop(gen, "D-med", "gemini", "gemini-3.5-flash", sample, 3);
      cands.push({
        name: "D-medium-900-1200",
        text: d.text,
        pct: d.pct,
        words: d.words,
        rank: scoreCandidate(d.words, d.pct, aiTellScore(d.text).score, true),
        stats: d.stats,
        provider: "gemini",
      });
    }
  }

  // E) Groq polish of current if gemini not enough
  if (status.groqConfigured && fs.existsSync(currentPath)) {
    console.log("\n--- E: polish current with Groq ---");
    const cur = fs.readFileSync(currentPath, "utf8");
    const e = await polishLoop(cur, "E-groq", "groq", "llama-3.3-70b-versatile", sample, 3);
    cands.push({
      name: "E-current+groq-rewrite",
      text: e.text,
      pct: e.pct,
      words: e.words,
      rank: scoreCandidate(e.words, e.pct, aiTellScore(e.text).score, true),
      stats: e.stats,
      provider: "groq",
    });
  }

  cands.sort((a, b) => a.rank - b.rank);
  console.log("\n=== RANKING (best first) ===");
  for (const c of cands) {
    console.log(
      `${c.rank.toFixed(1).padStart(7)}  ${c.name}  words=${c.words} AI%=${c.pct.toFixed(1)} HUMAN=${c.stats?.HUMAN_count ?? "?"} AI=${c.stats?.AI_count ?? "?"} LAI=${c.stats?.LIKELY_AI_count ?? "?"}`,
    );
  }

  const best = cands[0];
  if (!best) {
    console.error("No candidates");
    process.exit(1);
  }

  fs.writeFileSync(path.join(outDir, "глава-6-optimal.txt"), best.text, "utf8");
  // also copy to chapter6
  fs.writeFileSync(path.join(process.cwd(), "test-artifacts", "chapter6", "глава-6-optimal.txt"), best.text, "utf8");
  fs.writeFileSync(
    path.join(outDir, "ranking.json"),
    JSON.stringify(
      cands.map((c) => ({
        name: c.name,
        words: c.words,
        aiPct: c.pct,
        rank: c.rank,
        stats: c.stats,
        provider: c.provider,
        tell: aiTellScore(c.text).score,
        lang: russianLanguageIssues(c.text),
      })),
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, "отчёт-optimal.txt"),
    [
      `best=${best.name}`,
      `provider=${best.provider}`,
      `words=${best.words}`,
      `yandex_ai_pct=${best.pct.toFixed(1)}`,
      `HUMAN=${best.stats?.HUMAN_count ?? 0}`,
      `AI=${best.stats?.AI_count ?? 0}`,
      `LIKELY_AI=${best.stats?.LIKELY_AI_count ?? 0}`,
      `ai-tell=${aiTellScore(best.text).score}`,
      `lang=${russianLanguageIssues(best.text).join("|") || "OK"}`,
      `kpi=${best.pct === 0 && best.words >= 1500 ? "PASS_LONG" : best.pct === 0 ? "PASS_SHORT" : best.pct <= 20 && best.words >= 1500 ? "GOOD_LONG" : "REVIEW"}`,
    ].join("\n"),
    "utf8",
  );

  console.log("\nBEST:", best.name, "words=", best.words, "AI%=", best.pct.toFixed(1));
  console.log("saved", path.join(outDir, "глава-6-optimal.txt"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
