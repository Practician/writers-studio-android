/**
 * npx tsx scripts/optimize-chapter7-pass2.ts
 * Продолжает rewrite_detector_segments с лучшего текста гл.7.
 */
import dotenv from "dotenv";
dotenv.config({ override: true });
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { countWordsRu } from "../server/chapterGenerate";

const outDir = path.join("test-artifacts", "chapter7");
const sample = fs.readFileSync(
  path.join("test-artifacts", "chapter6-optimal", "глава-6-optimal.txt"),
  "utf8",
);

function httpJson(body: unknown, timeoutMs = 30 * 60 * 1000): Promise<{ status: number; json: any }> {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: 3000,
        path: "/api/writer/ai",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": payload.length },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(raw || "{}") });
          } catch {
            resolve({ status: res.statusCode || 0, json: { raw: raw.slice(0, 300) } });
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(payload);
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
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  const report = data.results || data;
  fs.writeFileSync(path.join(outDir, `яндекс-${name}.json`), JSON.stringify(report, null, 2), "utf8");
  const st = report.stats || {};
  let ai = 0;
  let tot = 0;
  for (const s of report.segments || []) {
    const len = s.len || (s.text || "").length;
    tot += len;
    if (s.label === "AI" || s.label === "LIKELY_AI") ai += len;
  }
  const pct = tot ? (100 * ai) / tot : 0;
  console.log(
    `Yandex[${name}] AI%=${pct.toFixed(1)} H=${st.HUMAN_count || 0} AI=${st.AI_count || 0} LAI=${st.LIKELY_AI_count || 0} LH=${st.LIKELY_HUMAN_count || 0}`,
  );
  return { report, pct, stats: st };
}

async function rewrite(text: string, segments: any[], provider: string, model: string) {
  const res = await httpJson({
    action: "rewrite_detector_segments",
    llmProvider: provider,
    model,
    humanize: true,
    humanizeDepth: "maximum",
    authorSample: sample.slice(0, provider === "groq" ? 2500 : 10000),
    voicePreset: "conversational",
    detectorSegments: segments.map((s: any) => ({ text: s.text, label: s.label })),
  });
  console.log(`  ${provider} status=${res.status} rewritten=${res.json?.rewrittenCount} err=${res.json?.error || ""}`);
  if (res.json?.result) return String(res.json.result).trim();
  return text;
}

async function main() {
  let text = fs.readFileSync(path.join(outDir, "глава-7-maximum.txt"), "utf8");
  // Keep НФС for Russian-only; restore NFC display in final if needed
  text = text.replace(/\bNFC\b/g, "НФС");

  let best = { text, pct: 100, stats: {} as any, words: countWordsRu(text) };

  for (let round = 0; round < 6; round++) {
    const y = await yandex(text, `p2-r${round}`);
    const words = countWordsRu(text);
    if (y.pct < best.pct || (y.pct === best.pct && words > best.words)) {
      best = { text, pct: y.pct, stats: y.stats, words };
      fs.writeFileSync(path.join(outDir, "глава-7-best.txt"), text, "utf8");
    }
    if (y.pct === 0) break;

    const segs = y.report.segments || [];
    const aiN = segs.filter((s: any) => s.label === "AI" || s.label === "LIKELY_AI").length;
    if (!aiN) break;

    // Alternate providers
    const provider = round % 2 === 0 ? "groq" : "gemini";
    const model = provider === "groq" ? "llama-3.3-70b-versatile" : "gemini-2.0-flash";
    console.log(`rewrite #${round} via ${provider}, aiSegs=${aiN}`);
    const next = await rewrite(text, segs, provider, model);
    if (next === text || next.length < 400) {
      // try other
      const p2 = provider === "groq" ? "gemini" : "groq";
      const m2 = p2 === "groq" ? "llama-3.3-70b-versatile" : "gemini-2.0-flash";
      console.log(`  fallback ${p2}`);
      const next2 = await rewrite(text, segs, p2, m2);
      if (next2 === text || next2.length < 400) break;
      text = next2.replace(/\bNFC\b/g, "НФС");
    } else {
      text = next.replace(/\bNFC\b/g, "НФС");
    }
    // restore plot word NFC for phone UI feel in one place
    text = text.replace(/НФС-метк/g, "NFC-метк").replace(/список НФС/g, "список NFC");
    fs.writeFileSync(path.join(outDir, `глава-7-p2-r${round + 1}.txt`), text, "utf8");
    console.log("  words", countWordsRu(text));
  }

  // Final score on best
  const yf = await yandex(best.text, "maximum-final");
  best = { text: best.text, pct: yf.pct, stats: yf.stats, words: countWordsRu(best.text) };
  fs.writeFileSync(path.join(outDir, "глава-7-maximum.txt"), best.text, "utf8");
  const report = {
    time: new Date().toISOString(),
    filename: "глава-7-maximum.txt",
    words: best.words,
    ai_pct_by_chars: best.pct,
    stats: best.stats,
    segments: yf.report.segments || [],
  };
  fs.writeFileSync(path.join(outDir, "яндекс-maximum.json"), JSON.stringify(report, null, 2), "utf8");
  const dl = path.join(
    process.env.USERPROFILE || "",
    "Downloads",
    `result_chapter7_maximum_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`,
  );
  fs.writeFileSync(dl, JSON.stringify(report, null, 2), "utf8");
  console.log("\nBEST AI%=", best.pct.toFixed(1), "words=", best.words, "stats=", best.stats);
  console.log("report", dl);

  const { spawnSync } = await import("node:child_process");
  spawnSync("npx", ["tsx", "scripts/export-chapter7-maximum-docx.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
