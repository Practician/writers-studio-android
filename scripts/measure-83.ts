import fs from "node:fs";
import { aiTellScore, shortSentenceStats, isDialogueSentence } from "../server/humanStyle.ts";
function m(t: string) {
  const body = t.replace(/^.*?Синопсис:[^\n]*\n?/s, "");
  const sents = body.split(/(?<=[.!?…])\s+/).filter((s) => s.trim());
  const lens = sents.map((s) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length);
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(lens.length, 1);
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(lens.length, 1));
  const c = (re: RegExp) => (body.match(re) ?? []).length;
  const short = shortSentenceStats(body, 4, isDialogueSentence);
  const a = aiTellScore(body);
  return {
    words: (body.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length, sentences: sents.length,
    avgSentence: +avg.toFixed(2), sdSentence: +sd.toFixed(2),
    shortUnder5: +(100 * lens.filter((l) => l < 5).length / Math.max(lens.length, 1)).toFixed(1),
    long25plus: lens.filter((l) => l >= 25).length,
    dialogueShare: +(100 * sents.filter(isDialogueSentence).length / Math.max(sents.length, 1)).toFixed(1),
    narrativeShortShare: +(short.share * 100).toFixed(1), narrativeMaxChain: short.maxChain,
    similes: c(/словно|будто|похоже на|наподобие|как будто/giu),
    silence: c(/не ответил|промолчал|молчал(?:а|и)?\b|вместо ответа/giu),
    freeze: c(/замер|застыл|замира/giu), plita: c(/плит/giu),
    ilyaPer1000: +(1000 * c(/Илья|Илье|Илью|Ильи|Илюх/giu) / Math.max(1, (body.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length)).toFixed(1),
    auditGateScore: a.score, auditDiagnostic: a.diagnosticScore, hits: a.hits.length,
    staccato: a.staccatoComponent, thoughtPenalty: a.thoughtPenalty, burstiness: +a.burstiness.toFixed(3),
  };
}
for (const [f, label] of [
  ["/home/user/workspace/verify-app83/chapter83.txt", "НОВЫЙ прогон: патчи + шлюз"],
  ["/home/user/workspace/verify-app83/chapter83.txt", "НОВЫЙ прогон (патчи + шлюз)"],
  ["/home/user/workspace/verify-app82/chapter82.txt", "прежний прокси-прогон (код 82)"],
  ["/home/user/uploaded_files/glava4_82.txt", "глава сборки 82 (внешний детектор 21/21 AI)"],
]) {
  if (!fs.existsSync(f)) { console.log(`НЕТ ФАЙЛА ${f}`); continue; }
  console.log(label + ": " + JSON.stringify(m(fs.readFileSync(f, "utf8"))));
}
