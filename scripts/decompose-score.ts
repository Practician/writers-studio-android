/** Разложение локального аудита на составляющие: чем именно набран score. */
import fs from "node:fs";
import {
  aiTellScore, detectAiTells, sentenceBurstiness, repeatedOpenerShare,
  interfaceTellShare, shortSentenceStats, heavyStampHits,
} from "../server/humanStyle.ts";

function splitSents(t: string) {
  return t.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "utf8");
  const a = aiTellScore(text);
  const wc = a.words || 1;
  const burst = sentenceBurstiness(text);
  const opener = repeatedOpenerShare(text);
  const iface = interfaceTellShare(text);
  const short = shortSentenceStats(text, 4);
  const hits = detectAiTells(text);
  const weightById = new Map((await import("../server/humanStyle.ts")).AI_TELL_CATALOG.map((e) => [e.id, e.weight]));
  const weighted = hits.reduce((s, h) => s + (weightById.get(h.id) ?? 1), 0);
  const patternDensity = (weighted / wc) * 1000;
  const patternComponent = Math.min(patternDensity * 4, 45);
  const interfaceComponent = Math.min(iface * 4000, 15);
  let staccato = 0;
  if (short.total >= 6) {
    if (short.share >= 0.28) staccato += Math.min((short.share - 0.24) * 70, 12);
    if (short.maxChain >= 3) staccato += Math.min((short.maxChain - 2) * 4, 10);
  }
  staccato = Math.min(staccato, 20);
  const rhythmComponent = burst >= 0.5 ? 0 : Math.min(((0.5 - burst) / 0.5) * 15, 15);
  const openerComponent = Math.min(opener * 50, 10);
  const tv = (text.match(/\b(?:подумал|подумала|решил|решила|понял|поняла|осознал|осознала|вспомнил|вспомнила|представил|представила|казались?|показалось?)\b/giu) || []).length;
  const thoughtPerK = (tv / wc) * 1000;
  const thoughtPenalty = wc > 200 && thoughtPerK < 2 ? Math.min((2 - thoughtPerK) * 3, 6) : 0;
  const sents = splitSents(text);
  const lens = sents.map((s) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length);
  const long25 = lens.filter((l) => l >= 25).length;
  const noVerb = sents.filter((s) => !/[а-яё]{2,}(?:л|ла|ли|ет|ит|ют|ал|ил)\b/iu.test(s)).length;
  console.log(JSON.stringify({
    file,
    score: a.score, hits: hits.length, hitIds: hits.slice(0, 8).map((h) => h.id),
    heavy: heavyStampHits(a).map((h) => h.id),
    words: a.words, sentences: sents.length,
    patternComponent: +patternComponent.toFixed(2), patternDensity: +patternDensity.toFixed(2),
    interfaceComponent: +interfaceComponent.toFixed(2),
    staccato: +staccato.toFixed(2), shortShare: +short.share.toFixed(3), shortChain: short.maxChain,
    rhythmComponent: +rhythmComponent.toFixed(2), burstiness: +burst.toFixed(3),
    openerComponent: +openerComponent.toFixed(2), openerRep: +opener.toFixed(3),
    thoughtPenalty: +thoughtPenalty.toFixed(2), thoughtPerK: +thoughtPerK.toFixed(2),
    long25plus: long25, sentWithoutVerb: noVerb,
    sumComponents: +(patternComponent + interfaceComponent + staccato + rhythmComponent + openerComponent + thoughtPenalty).toFixed(2),
  }, null, 1));
}
