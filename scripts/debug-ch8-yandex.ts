import { aiTellScore, sentenceBurstiness, shortSentenceStats, detectAiTells } from "../server/humanStyle";
import { computeStyleStats, splitSentences, wordsOf } from "../src/lib/authorAudit";
import fs from "fs";

const text = fs.readFileSync("src/data/labyrinth/chapter-8.txt", "utf8");
const sentences = splitSentences(text);

console.log("=== Детальный анализ главы 8 ===\n");
console.log("Слов:", wordsOf(text).length);
console.log("Предложений:", sentences.length);

// Sentence lengths
const lens = sentences.map((s) => wordsOf(s).length);
const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
const short = lens.filter((l) => l <= 4).length;
const veryLong = lens.filter((l) => l >= 15).length;
console.log("\nДлина предложений:");
console.log("  Средняя:", avg.toFixed(1));
console.log("  Коротких (≤4):", short, "(" + ((short / lens.length) * 100).toFixed(0) + "%)");
console.log("  Длинных (≥15):", veryLong, "(" + ((veryLong / lens.length) * 100).toFixed(0) + "%)");
console.log("  Мин:", Math.min(...lens), "  Макс:", Math.max(...lens));

// Repeated patterns
console.log("\nПовторы:");
const lower = text.toLowerCase();
const patterns: Array<[string, number]> = [
  ["тепловизор", (lower.match(/тепловизор/g) || []).length],
  ["на экране", (lower.match(/на экране/g) || []).length],
  ["в телефоне", (lower.match(/в телефоне/g) || []).length],
  ["на стене", (lower.match(/на стене/g) || []).length],
  ["пошёл/продолжил", (lower.match(/пошёл|продолжил|двигался|шагнул/g) || []).length],
  ["риски", (lower.match(/риск[аиуе]?/g) || []).length],
  ["линия на экране", (lower.match(/линия на экране|на экране.*линия/g) || []).length],
  ["процентов", (lower.match(/процент/g) || []).length],
];

for (const [name, count] of patterns) {
  if (count >= 2) console.log("  " + name + ": " + count + " раз");
}

// Openings
console.log("\nЗачины предложений:");
const openers = new Map<string, number>();
for (const s of sentences) {
  const first = wordsOf(s)[0]?.toLowerCase();
  if (first) openers.set(first, (openers.get(first) || 0) + 1);
}
const repeated = [...openers.entries()].filter(([_, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
for (const [word, count] of repeated) {
  console.log("  «" + word + "»: " + count + " раз");
}

// Short sentence chains
console.log("\nЦепочки коротких (≤4 слов):");
let chain = 0;
let maxChain = 0;
let chains = 0;
for (const l of lens) {
  if (l <= 4) {
    chain += 1;
    if (chain >= 3) chains += 1;
    maxChain = Math.max(maxChain, chain);
  } else {
    chain = 0;
  }
}
console.log("  MaxChain:", maxChain);
console.log("  Цепочки ≥3:", chains);

// Inventory
console.log("\nИнвентарь (описания физики):");
const inventoryPatterns = text.match(/(?:стен[аыу]|пол[ау]|потолок|дверь|коридор)[аы]?\s+[^.!?]{0,30}(?:гладк|твёрд|тёпл|холодн|сыр|влаж|сух)/gi) || [];
console.log("  Совпадений:", inventoryPatterns.length);
for (const m of inventoryPatterns.slice(0, 5)) console.log("    " + m);

// UI patterns
console.log("\nUI-элементы:");
const uiPatterns = [
  text.match(/на экране/gi) || [],
  text.match(/телефон.*(?:дрогнул|бзикнул|мигнул|показал)/gi) || [],
  text.match(/(?:линия|точка|значок|схема).*экран/gi) || [],
];
const uiCount = uiPatterns.reduce((s, p) => s + p.length, 0);
console.log("  Всего UI-элементов:", uiCount);
for (const p of uiPatterns) {
  for (const m of p.slice(0, 3)) console.log("    " + m);
}

// Verdict
console.log("\n=== ВЫВОД ===");
console.log("Основные проблемы для Яндекса:");
console.log("1. Тепловизор упоминается 3 раза — систематическое чтение приборов");
console.log("2. «На экране» — UI-описание (~6 раз)");
console.log("3. Линия/точка на экране — карта как интерфейс");
console.log("4. Цепочки коротких фраз — стаккато");
console.log("5. Инвентарь: стены/пол/риски — повторяющееся описание");
