/** Сравнение текстов по локальному детектору (адаптивный профиль из сида «Лабиринта»). */
import fs from "node:fs";
import * as D from "../src/lib/adaptiveDetector.ts";
const files = process.argv.slice(2);
let profile: any = null;
for (const call of [
  () => (D as any).resolveSeedAdaptiveProfile(),
  () => (D as any).resolveSeedAdaptiveProfile("story-labyrinth"),
  () => (D as any).createAdaptiveProfile("story-labyrinth"),
]) { try { profile = call(); if (profile) break; } catch {} }
const prof = profile && profile.human ? profile : (profile?.profile ?? profile);
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const feats = (() => { try { return (D as any).extractAdaptiveFeatures(text); } catch (e) { return { err: String(e).slice(0, 80) }; } })();
  const out: any = { file: f, feat: flatten(feats) };
  for (const [label, fn] of [
    ["scoreWithAdaptiveProfile", () => (D as any).scoreWithAdaptiveProfile(text, prof)],
    ["scoreCalibratedLocalDetector", () => (D as any).scoreCalibratedLocalDetector(text, prof)],
    ["scoreCalibratedLocalDetector2", () => (D as any).scoreCalibratedLocalDetector(text, prof, (D as any).DEFAULT_FUSION)],
  ] as Array<[string, () => any]>) {
    try { const r = fn(); out[label] = typeof r === "number" ? r : r; } catch (e) { out[label] = "ERR " + String(e).slice(0, 70); }
  }
  try {
    if (prof?.human && prof?.ai) {
      out.mahalanobisHuman = +(D as any).mahalanobisDistance(feats, prof.human).toFixed(2);
      out.mahalanobisAi = +(D as any).mahalanobisDistance(feats, prof.ai).toFixed(2);
      out.centroidHumanMean = prof.human.mean;
      out.centroidAiMean = prof.ai.mean;
    }
  } catch (e) { out.mahErr = String(e).slice(0, 70); }
  console.log(JSON.stringify(out, null, 1));
}
function flatten(o: any): any {
  if (o && typeof o === "object") {
    const r: any = {};
    for (const k of Object.keys(o)) if (typeof o[k] !== "object") r[k] = typeof o[k] === "number" ? +o[k].toFixed(3) : o[k];
    return r;
  }
  return o;
}
