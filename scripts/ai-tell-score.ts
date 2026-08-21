// Локальная оценка текста на генеративные признаки (без внешних детекторов).
// Использование: npx tsx scripts/ai-tell-score.ts <файл.txt> [ещё файлы...]
import fs from "node:fs";
import path from "node:path";
import { aiTellScore } from "../server/humanStyle";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Укажите хотя бы один текстовый файл.");
  process.exit(1);
}

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const score = aiTellScore(text);
  console.log(`\n=== ${path.basename(file)} (${text.length} знаков)`);
  console.log(`AI-tell score: ${score.score}/100 (0 — человечно)`);
  console.log(`  burstiness (вариативность длин предложений): ${score.burstiness.toFixed(2)} (живая проза ≥ 0.55)`);
  console.log(`  плотность штампов: ${score.patternDensity.toFixed(1)} на 1000 слов`);
  console.log(`  повторы зачинов подряд: ${(score.openerRepetition * 100).toFixed(0)}%`);
  const labels = [...new Set(score.hits.map((hit) => hit.label))];
  console.log(`  найденные штампы (${score.hits.length}): ${labels.slice(0, 12).join("; ") || "нет"}`);
}
