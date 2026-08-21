import { aiTellScore, sentenceBurstiness, shortSentenceStats } from "../server/humanStyle";
import { countWordsRu } from "../server/chapterGenerate";
import fs from "fs";

const seed = fs.readFileSync("src/data/labyrinth/chapter-8.txt", "utf8");
const generated = fs.readFileSync("test-artifacts/ch78-app/ch8-generated-v2.txt", "utf8");
const old = fs.readFileSync("test-artifacts/ch78-app/ch8-llm-human.txt", "utf8");

function analyze(name: string, text: string) {
  const s = aiTellScore(text);
  const b = sentenceBurstiness(text);
  const sh = shortSentenceStats(text, 4);
  const w = countWordsRu(text);
  console.log(`${name}:`);
  console.log(`  Слов: ${w}  Score: ${s.score}  Burst: ${b.toFixed(2)}  Short: ${(sh.share * 100).toFixed(0)}%  Chain: ${sh.maxChain}  Hits: ${s.hits.length}`);
  for (const h of s.hits) console.log(`    [${h.category}] ${h.label}`);
}

console.log("=== Сравнение версий главы 8 ===\n");
analyze("SEED (chapter-8.txt)", seed);
console.log();
analyze("СГЕНЕРИРОВАННАЯ v2 (Groq)", generated);
console.log();
analyze("ЛУЧШАЯ ИЗ ПРИЛОЖЕНИЯ (ch8-llm-human)", old);
