/** npx tsx scripts/analyze-yandex-patterns-live.ts */
import fs from "node:fs";
import path from "node:path";
import { aiTellScore, detectAiTells } from "../server/humanStyle";
import { computeStyleStats } from "../src/lib/authorAudit";

const outDir = path.join("test-artifacts", "yandex-patterns");
fs.mkdirSync(outDir, { recursive: true });

type Seg = { file: string; label: string; text: string; len: number };

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".json") && /yandex|яндекс|detector/i.test(e.name)) acc.push(p);
  }
  return acc;
}

const human: Seg[] = [];
const ai: Seg[] = [];

for (const file of walk("test-artifacts")) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const segs = (j.results || j).segments || [];
    for (const s of segs) {
      if (!s?.text || s.text.length < 60) continue;
      const item = { file: path.basename(file), label: String(s.label), text: s.text, len: s.len || s.text.length };
      if (s.label === "HUMAN" || s.label === "LIKELY_HUMAN") human.push(item);
      if (s.label === "AI" || s.label === "LIKELY_AI") ai.push(item);
    }
  } catch { /* */ }
}

function sentLens(text: string): number[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.match(/[а-яёa-z0-9]+/giu) || []).length)
    .filter((n) => n > 0);
}

function structural(text: string) {
  const lens = sentLens(text);
  const words = (text.match(/[а-яёa-z0-9]+/giu) || []).length;
  const short = lens.filter((n) => n <= 4).length / (lens.length || 1);
  const micro = lens.filter((n) => n <= 2).length / (lens.length || 1);
  const avg = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  // chains of 3+ short sentences
  let chain = 0;
  let maxChain = 0;
  for (const n of lens) {
    if (n <= 5) {
      chain += 1;
      maxChain = Math.max(maxChain, chain);
    } else chain = 0;
  }
  const statusUi = (text.match(/(?:статус\s*:|шаги\s*:|шаги\s*[—–-]|на\s+экране|на\s+линии|усик|диск-якорь|риск[аи]?)/giu) || []).length;
  const thought = (text.match(/подумал|решил|однако|ну\b|чтож|вспомнил/giu) || []).length;
  const ya = (text.match(/(?:^|[^\p{L}])я(?:[^\p{L}]|$)/giu) || []).length;
  const nomark = (text.match(/(?:^|[.!?…]\s*)(?:Пол|Стены|Риски|Карта|Телефон|Заряд|Диск|Линия)\b/gmu) || []).length;
  const factList = (text.match(/(?:^|[.!?…]\s*)[А-ЯЁ][^.!?]{0,40}[.!?]\s*[А-ЯЁ][^.!?]{0,40}[.!?]\s*[А-ЯЁ]/gmu) || []).length;
  return {
    avgSent: avg,
    shortShare: short,
    microShare: micro,
    maxShortChain: maxChain,
    statusUiPer1k: (statusUi / Math.max(words, 1)) * 1000,
    thoughtPer1k: (thought / Math.max(words, 1)) * 1000,
    yaPer100w: (ya / Math.max(words, 1)) * 100,
    nounStartPer1k: (nomark / Math.max(words, 1)) * 1000,
    factListHits: factList,
    words,
    sents: lens.length,
  };
}

function mean(list: Seg[], key: keyof ReturnType<typeof structural>) {
  const vals = list.map((s) => structural(s.text)[key] as number);
  return vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
}

const keys: (keyof ReturnType<typeof structural>)[] = [
  "avgSent", "shortShare", "microShare", "maxShortChain", "statusUiPer1k",
  "thoughtPer1k", "yaPer100w", "nounStartPer1k", "factListHits",
];

const table = keys.map((k) => {
  const h = mean(human, k);
  const a = mean(ai, k);
  return {
    feature: k,
    human: +h.toFixed(3),
    ai: +a.toFixed(3),
    ratio: h > 0 ? +(a / h).toFixed(2) : a > 0 ? 99 : 1,
    lean: a > h * 1.2 ? "AI+" : h > a * 1.2 ? "H+" : "~",
  };
});

// markers
const markers: [RegExp, string][] = [
  [/(?:^|[.!?…]\s*)[А-ЯЁ][^.!?]{1,25}[.!?]\s*[А-ЯЁ][^.!?]{1,25}[.!?]\s*[А-ЯЁ]/u, "triple-short-sents"],
  [/статус\s*:/giu, "status-colon"],
  [/шаги\s*[:—–-]/giu, "steps-colon"],
  [/на\s+экране/giu, "on-screen"],
  [/на\s+линии/giu, "on-line"],
  [/усик/giu, "usik-map"],
  [/подумал/giu, "podumal"],
  [/однако/giu, "odnako"],
  [/\bну\b/giu, "nu"],
  [/решил/giu, "reshil"],
  [/Пол\s+твёрже|Стены\s+гладкие|Риски\s+/giu, "space-inventory"],
  [/Сел\.|Встал\.|Пошёл\.|Пошел\./gu, "one-word-sent"],
  [/День\s+тянулся|стол,\s*кухня/giu, "day-summary"],
  [/квест-лог|не\s+список\.\s*не\s+таблица/giu, "anti-ui-meta"],
];

function rate(list: Seg[], re: RegExp) {
  let hits = 0;
  let chars = 0;
  for (const s of list) {
    chars += s.text.length;
    hits += (s.text.match(re) || []).length;
  }
  return chars ? (hits * 1000) / chars : 0;
}

const markerRows = markers.map(([re, name]) => {
  const h = rate(human, re);
  const a = rate(ai, re);
  return {
    name,
    human: +h.toFixed(3),
    ai: +a.toFixed(3),
    ratio: h > 0 ? +(a / h).toFixed(2) : a > 0 ? 99 : 1,
    lean: a > h * 1.25 ? "AI+" : h > a * 1.25 ? "H+" : "~",
  };
}).sort((x, y) => y.ratio - x.ratio);

// local detector miss analysis on AI segments
let aiMiss = 0;
let aiHit = 0;
const missExamples: Array<{ file: string; tell: number; excerpt: string }> = [];
for (const s of ai) {
  const score = aiTellScore(s.text);
  if (score.score < 12) {
    aiMiss += 1;
    if (missExamples.length < 6) {
      missExamples.push({
        file: s.file,
        tell: score.score,
        excerpt: s.text.slice(0, 220).replace(/\s+/g, " "),
      });
    }
  } else aiHit += 1;
}

const report = {
  createdAt: new Date().toISOString(),
  counts: { human: human.length, ai: ai.length },
  structural: table,
  markers: markerRows,
  localMissOnYandexAi: {
    lowTellAiSegments: aiMiss,
    highTellAiSegments: aiHit,
    missRate: ai.length ? aiMiss / ai.length : 0,
    examples: missExamples,
  },
  whyNot100: [
    "Яндекс — чёрный ящик: сегментирует ~1k chars и классифицирует по latent style, не по нашему каталогу.",
    "Много AI-сегментов без штампов (tell<12): рубленый ритм, inventory локации, «экран/линия/статус», summary дня.",
    "HUMAN гл.1/6 тоже содержит «однако/ну» и короткие фразы — нельзя жёстко банить без FP.",
    "Adaptive centroid ловит средний стиль, не каждый ~1000-символьный кусок; fusion thr=55 ≠ Yandex thr.",
    "Цель 100% match с Yandex нереалистична: даже LOO ~76%; 100% HUMAN в тексте ≠ 100% accuracy детектора.",
  ],
  recommendedLocalPatterns: [
    "staccato-chain: 3+ подряд предложений ≤5 слов",
    "status-ui-colon: «статус:» / «шаги:»",
    "space-inventory: «Пол твёрже. Стены гладкие. Риски…»",
    "one-word-sents: «Сел. Встал. Пошёл.»",
    "map-line-jargon: усик/линия-карта в квест-тоне",
    "day-summary: «День тянулся. Стол, кухня…»",
  ],
};

fs.writeFileSync(path.join(outDir, "live-pattern-analysis.json"), JSON.stringify(report, null, 2), "utf8");

console.log("HUMAN", human.length, "AI", ai.length);
console.log("\nStructural:");
for (const row of table) console.log(`  ${row.lean} ${row.feature}: H=${row.human} AI=${row.ai} x${row.ratio}`);
console.log("\nMarkers:");
for (const row of markerRows.slice(0, 14)) console.log(`  ${row.lean} ${row.name}: H=${row.human} AI=${row.ai} x${row.ratio}`);
console.log("\nLocal miss on Yandex-AI:", aiMiss, "/", ai.length, `(${(100 * aiMiss / ai.length).toFixed(0)}% low tell)`);
console.log("examples:", missExamples.map((e) => `${e.file} tell=${e.tell}`).join("; "));
console.log("\nWrote", path.join(outDir, "live-pattern-analysis.json"));
