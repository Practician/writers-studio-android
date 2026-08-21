import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { aiTellScore } from "../server/humanStyle";
import { humanizeProseDraft } from "../server/chapterGenerate";
import { llmGenerate } from "../server/llmProvider";

dotenv.config({ override: true });

const out = path.resolve(process.cwd(), "..", "тест-очеловечивание");
const text = fs.readFileSync(path.join(out, "live-verify-gen.txt"), "utf8");
const before = aiTellScore(text);
console.log("before", before.score, before.hits.map((h) => h.label).join("; "), "burst", before.burstiness.toFixed(2));

const model = process.env.NVIDIA_DEFAULT_MODEL || "meta/llama-3.1-70b-instruct";
const generate = async (p: any) => {
  const r = await llmGenerate({ ...p, model: p.model || model });
  console.log("llm", r.provider, r.model);
  return r.text;
};

const polished = await humanizeProseDraft(text, generate, {
  model,
  personaBlock: "Инженер, 1 лицо, сухо, без «Вдруг» и риторики.",
  humanizeDepth: "balanced",
});
const after = aiTellScore(polished.text);
console.log("after", after.score, after.hits.map((h) => h.label).join("; ") || "none", "burst", after.burstiness.toFixed(2));
console.log("gate", polished.humanizeReport.gatePassed, "refined", polished.humanizeReport.refinedBlocks);
fs.writeFileSync(path.join(out, "live-verify-gen-v2.txt"), polished.text, "utf8");
fs.writeFileSync(
  path.join(out, "live-verify-gen-v2.report.json"),
  JSON.stringify({ before, after, report: polished.humanizeReport }, null, 2),
  "utf8",
);

const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://yandex.ru",
    Referer: "https://yandex.ru/lab/neurodetector",
  },
  body: JSON.stringify({ text: polished.text }),
});
const data = await res.json();
const report = data.results || data;
fs.writeFileSync(path.join(out, "яндекс-live-gen-v2.json"), JSON.stringify(report, null, 2), "utf8");
const st = report.stats || {};
let aiChars = 0;
let total = 0;
for (const s of report.segments || []) {
  total += s.len;
  if (s.label === "AI" || s.label === "LIKELY_AI") aiChars += s.len;
}
console.log(
  "yandex",
  "AI/LAI",
  (st.AI_count || 0) + (st.LIKELY_AI_count || 0),
  "HUM",
  (st.HUMAN_count || 0) + (st.LIKELY_HUMAN_count || 0),
  "AI%",
  total ? ((100 * aiChars) / total).toFixed(1) : "?",
);
