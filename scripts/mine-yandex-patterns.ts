/**
 * Добыча паттернов Яндекс-нейродетектора: AI vs HUMAN сегменты из test-artifacts.
 * npx tsx scripts/mine-yandex-patterns.ts
 */
import fs from "node:fs";
import path from "node:path";
import { aiTellScore, detectAiTells } from "../server/humanStyle";
import { computeStyleStats } from "../src/lib/authorAudit";

const root = process.cwd();
const outDir = path.join(root, "test-artifacts", "yandex-patterns");
fs.mkdirSync(outDir, { recursive: true });

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/яндекс|yandex|detector/i.test(entry.name) && entry.name.endsWith(".json")) {
      acc.push(full);
    }
  }
  return acc;
}

type Seg = { text: string; file: string; label: string };

const human: Seg[] = [];
const ai: Seg[] = [];

for (const file of walk(path.join(root, "test-artifacts"))) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const segs = (raw.results || raw).segments || [];
    for (const s of segs) {
      if (!s?.text || s.text.length < 80) continue;
      const item = { text: s.text as string, file: path.basename(file), label: String(s.label) };
      if (s.label === "HUMAN" || s.label === "LIKELY_HUMAN") human.push(item);
      if (s.label === "AI" || s.label === "LIKELY_AI") ai.push(item);
    }
  } catch {
    /* skip */
  }
}

function listStats(list: Seg[]) {
  const scores = list.map((x) => aiTellScore(x.text));
  const styles = list.map((x) => computeStyleStats(x.text));
  const avg = <T extends object>(arr: T[], key: keyof T) =>
    arr.reduce((a, s) => a + Number(s[key]), 0) / (arr.length || 1);
  return {
    n: list.length,
    aiTell: Number(avg(scores, "score").toFixed(1)),
    burst: Number(avg(scores, "burstiness").toFixed(2)),
    opener: Number(avg(scores, "openerRepetition").toFixed(2)),
    density: Number(avg(scores, "patternDensity").toFixed(2)),
    avgSent: Number(avg(styles, "averageSentenceWords").toFixed(1)),
    shortShare: Number(avg(styles, "shortSentenceShare").toFixed(2)),
    particles: Number(avg(styles, "particlesPerThousandWords").toFixed(1)),
    excl: Number(avg(styles, "exclamationsPerThousandWords").toFixed(1)),
    ellip: Number(avg(styles, "ellipsesPerThousandWords").toFixed(1)),
    dialogue: Number(avg(styles, "dialogueLineShare").toFixed(2)),
  };
}

function countHits(list: Seg[]) {
  const map = new Map<string, number>();
  for (const x of list) {
    for (const hit of detectAiTells(x.text)) {
      map.set(hit.id, (map.get(hit.id) || 0) + 1);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
}

function ratePer1kChars(list: Seg[], re: RegExp): number {
  let hits = 0;
  let total = 0;
  for (const x of list) {
    total += x.text.length;
    const m = x.text.match(re);
    if (m) hits += m.length;
  }
  return total ? Number(((hits * 1000) / total).toFixed(2)) : 0;
}

const markers: Array<[RegExp, string]> = [
  [/что\s+дальше/giu, "что дальше"],
  [/я\s+понял/giu, "я понял"],
  [/я\s+чувствовал/giu, "я чувствовал"],
  [/важно\s+понять|стоит\s+отметить|в\s+современном/giu, "bureaucratic"],
  [/обнаружен|новая\s+метка/giu, "ui-mark"],
  [/\b\d+\.\s/g, "numbered-list"],
  [/\b(CW|CCW|NFC|OK|level|Risks|think)\b/gi, "latin-ui"],
  [/не\s+просто/giu, "не просто"],
  [/волна\s+/giu, "волна"],
  [/приближаюсь\s+к\s+пониманию|ключ\s+к\s+пониманию/giu, "понимание"],
  [/механизм/giu, "механизм"],
  [/эксперимент/giu, "эксперимент"],
  [/вдруг/giu, "вдруг"],
  [/однако/giu, "однако"],
  [/\bну\b/giu, "ну"],
  [/подумал/giu, "подумал"],
  [/решил/giu, "решил"],
  [/достал/giu, "достал"],
  [/начал/giu, "начал"],
  [/продолж/giu, "продолж"],
  [/с\s+одной\s+стороны|с\s+другой/giu, "с одной стороны"],
  [/это\s+был\s+не\s+просто|это\s+было\s+не/giu, "это было не"],
  [/[/]{2,}|не\s+найдено/giu, "quest-log"],
];

const humanStats = listStats(human);
const aiStats = listStats(ai);
const markerRows = markers.map(([re, name]) => {
  const h = ratePer1kChars(human, re);
  const a = ratePer1kChars(ai, re);
  const ratio = h > 0 ? a / h : a > 0 ? 99 : 1;
  return { name, human: h, ai: a, ratio: Number(ratio.toFixed(2)), lean: a > h * 1.25 ? "AI+" : h > a * 1.25 ? "H+" : "~" };
}).filter((r) => r.lean !== "~" || r.ai > 0.05 || r.human > 0.05);

// Sample distinctive AI segments (high aiTell) and HUMAN (low)
const aiRanked = [...ai].map((s) => ({ ...s, score: aiTellScore(s.text).score }))
  .sort((a, b) => b.score - a.score);
const humanRanked = [...human].map((s) => ({ ...s, score: aiTellScore(s.text).score }))
  .sort((a, b) => a.score - b.score);

const report = {
  createdAt: new Date().toISOString(),
  counts: { human: human.length, ai: ai.length },
  humanStats,
  aiStats,
  topAiStamps: countHits(ai),
  topHumanStamps: countHits(human),
  markers: markerRows.sort((a, b) => b.ratio - a.ratio),
  insights: [
    "AI чаще: абстрактное «понимание/механизм/эксперимент», UI-лог, латиница, «что дальше»-петли, канцелярит.",
    "HUMAN чаще: «подумал/решил/достал», частицы «ну/однако», бытовой дневник, умеренное «я».",
    "Цель 100% HUMAN: убрать AI-маркеры, держать ритм гл.1/seed-ch7, без UI-таблиц и без тройных петель.",
  ],
  aiExamplesHighTell: aiRanked.slice(0, 3).map((s) => ({
    file: s.file,
    label: s.label,
    score: s.score,
    excerpt: s.text.slice(0, 280),
  })),
  humanExamplesLowTell: humanRanked.slice(0, 3).map((s) => ({
    file: s.file,
    label: s.label,
    score: s.score,
    excerpt: s.text.slice(0, 280),
  })),
};

fs.writeFileSync(path.join(outDir, "patterns-report.json"), JSON.stringify(report, null, 2), "utf8");

console.log("=== Yandex pattern mine ===");
console.log("segments HUMAN", human.length, "AI", ai.length);
console.log("HUMAN stats", humanStats);
console.log("AI stats", aiStats);
console.log("\nMarkers AI+ / H+:");
for (const row of report.markers.slice(0, 18)) {
  console.log(`  ${row.lean.padEnd(3)} ${row.name}: H=${row.human} AI=${row.ai} x${row.ratio}`);
}
console.log("\nTop AI stamps:", report.topAiStamps.slice(0, 10));
console.log("Top HUMAN stamps:", report.topHumanStamps.slice(0, 8));
console.log("\nReport:", path.join(outDir, "patterns-report.json"));
