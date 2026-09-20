/**
 * Офлайн-проверка патчей очеловечивания (без вызовов модели):
 * 1) пересчёт аудита двух прежних глав новым кодом — gate-оценка vs диагностика;
 * 2) триггер доводки: чистый ровный текст не должен звать модель, ровный ритм — должен.
 */
import fs from "node:fs";
import { aiTellScore, humanizeGatePassed, HUMANIZE_DEPTHS } from "../server/humanStyle.ts";
import { runTouchupPipeline, type GenerateFn } from "../server/chapterGenerate.ts";

const depth = HUMANIZE_DEPTHS.maximum;
const files = [
  ["/home/user/uploaded_files/glava4_82.txt", "глава сборки 82 (внешний детектор 21/21 AI)"],
  ["/home/user/workspace/verify-app82/chapter82.txt", "глава прокси-прогона (прежний код)"],
];
for (const [f, label] of files) {
  if (!fs.existsSync(f)) { console.log("нет файла", f); continue; }
  const t = fs.readFileSync(f, "utf8");
  const a = aiTellScore(t);
  const long = `${label}: ${JSON.stringify({
    gateScore: a.score,
    diagnosticScore: a.diagnosticScore,
    staccato: a.staccatoComponent,
    thoughtPenalty: a.thoughtPenalty,
    hits: a.hits.length,
    shortShare: +(a.shortShare ?? 0).toFixed(3),
    maxShortChain: a.maxShortChain,
    dialogueShare: +(a.dialogueShare ?? 0).toFixed(3),
    burstiness: +a.burstiness.toFixed(3),
    gatePassed: humanizeGatePassed(a, depth.scoreGate, depth.minBurstiness),
  })}`;
  console.log(long);
}

// --- Триггер доводки ---
const flat = Array.from({ length: 26 }, (_, i) => `Он шагнул вперёд и посмотрел на стену ещё раз, потому что хотел понять ровно это ${i + 1}.`).join(" ");
const varied = Array.from({ length: 26 }, (_, i) => i % 3 === 0
  ? `Шаг.`
  : i % 3 === 1
    ? `Он шёл вдоль стены и слушал, как под ногами шуршит мелкая каменная крошка.`
    : `Илья остановился, присел на корточки и внимательно осмотрел трещину в плите, которая шла от края к середине и уходила вниз под углом, будто её прорезали не ножом, а чем-то тяжёлым и очень точным.`).join(" ");

async function probeTags(name: string, text: string) {
  let calls = 0;
  const stub: GenerateFn = async (p: any) => {
    calls += 1;
    const m = /<DATA role="priority-blocks">\n([\s\S]*?)\n<\/DATA>/.exec(p.contents);
    const targets = m ? JSON.parse(m[1]) : [];
    return JSON.stringify({ blocks: targets.map((t: any) => t.text) });
  };
  const a = aiTellScore(text);
  const res = await runTouchupPipeline(text, stub, { model: "stub", personaBlock: "", depth });
  console.log(`${name}: words ${a.words}, burstiness ${a.burstiness.toFixed(3)}, openers ${a.openerRepetition.toFixed(3)}, gateScore ${a.score}, hits ${a.hits.length} → вызовов модели ${calls}, passesRun ${res.passesRun}, refinedBlocks ${res.refinedBlocks}, note: ${res.cleanNote ?? "—"}`);
}
await probeTags("ровный ритм (все предложения одной длины)", flat);
await probeTags("живой ритм (длины разные)", varied);
