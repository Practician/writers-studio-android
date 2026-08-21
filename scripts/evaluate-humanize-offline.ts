// Офлайн-регрессия очеловечивания: AI-tell score + gate по текстам из тест-очеловечивание.
// npx tsx scripts/evaluate-humanize-offline.ts
import fs from "node:fs";
import path from "node:path";
import { aiTellScore, humanizeGatePassed, resolveHumanizeDepth } from "../server/humanStyle";

const root = path.resolve(process.cwd(), "..", "тест-очеловечивание");
const files = [
  "1-оригинал-человек.txt",
  "2-ии-текст-до.txt",
  "3-очеловеченный-после.txt",
  "4-генерация-в-голосе.txt",
];

console.log("=== Offline humanize metrics ===\n");
for (const file of files) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    console.log(`SKIP ${file} (not found)`);
    continue;
  }
  const text = fs.readFileSync(full, "utf8");
  const score = aiTellScore(text);
  const balanced = resolveHumanizeDepth("balanced");
  const maximum = resolveHumanizeDepth("maximum");
  console.log(`${file}`);
  console.log(`  chars=${text.length} score=${score.score} burst=${score.burstiness.toFixed(2)} density=${score.patternDensity.toFixed(1)} hits=${score.hits.length}`);
  console.log(`  gate@balanced(${balanced.scoreGate})=${humanizeGatePassed(score, balanced.scoreGate)} gate@max(${maximum.scoreGate})=${humanizeGatePassed(score, maximum.scoreGate)}`);
  if (score.hits.length) {
    console.log(`  stamps: ${[...new Set(score.hits.map((hit) => hit.label))].slice(0, 8).join("; ")}`);
  }
  console.log("");
}
