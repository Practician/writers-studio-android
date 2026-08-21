import fs from "node:fs";
const p = "server/chapterGenerate.ts";
let t = fs.readFileSync(p, "utf8");
const re = /systemInstruction:\s*"[^"]*сценарист-структуралист[^"]*"/u;
if (!re.test(t)) {
  console.error("pattern not found");
  process.exit(1);
}
t = t.replace(
  re,
  'systemInstruction: "Ты сценарист-структуралист. Составляешь только биты сцены, без художественной прозы. Все формулировки строго на русском, без английских слов."',
);
fs.writeFileSync(p, t);
console.log("patched");
