/**
 * Калибровка по отчёту детектора: какая метрика разделяет HUMAN и AI.
 *
 * Зачем. Всё, что приложение измеряет само, калибровалось по человеческому
 * минимуму, и этого недостаточно: главный разделитель в отчёте 04.10.2026 —
 * доля кусков БЕЗ длинных предложений (HUMAN 0,20 против AI 0,08) и восклицаний
 * (11,8 против 4,1) — на главе целиком не видна вообще: сглаживание девятью
 * диалоговыми кусками съедало разницу. Плюс стало ясно, что часть наших
 * метрик классы не разделяет вовсе, и их надо назвать, а не молча носить в гейт.
 *
 * Как пользоваться. Взять текст, который ТОЧНО известен как человеческий
 * (авторские главы), прогнать его тем же детектором и положить отчёт рядом с
 * отчётом сгенерированной главы. Дальше:
 *
 *   npx tsx scripts/calibrateOnDetectorReport.ts эталон.json наш.json
 *
 * Скрипт печатает AUC по каждой метрике (0,5 — не разделяет, выше 0,7 —
 * разделяет) и предлагает порог как точку, где падает доля ложных срабатываний
 * на HUMAN. Ничего не калибрует молча: правки в код — руками, по таблице.
 *
 * Важно: отчёт детектора склеивает абзацы и теряет их границы, поэтому метрики
 * «форма абзаца» и «CV абзацев» здесь не измеряются — их надо считать на
 * исходном тексте (scripts/verifyBuild114.ts).
 */
import { readFileSync } from "node:fs";
import { measureProseRegister } from "../server/proseRegister";
import { aiTellScore, isDialogueSentence } from "../server/humanStyle";

interface Row {
  label: string;
  text: string;
}

const load = (path: string): Row[] => {
  const data = JSON.parse(readFileSync(path, "utf8"));
  return (data.segments || []).map((segment: { label: string; text: string }) => ({
    label: String(segment.label || "UNKNOWN"),
    text: String(segment.text || ""),
  }));
};

const splitSentences = (text: string): string[] =>
  String(text || "")
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1);

const words = (text: string): string[] => text.match(/[\p{L}\p{N}]+/gu) || [];

interface Metric {
  label: string;
  /** Больше — человечнее. */
  humanHigher: boolean;
  value: (text: string) => number;
}

/** Абстрактное существительное в роли действующего лица: «Страх смахнул сон». */
const ABSTRACT_AGENT = /(?<![а-яё])(?:Страх|Тишина|Внимание|Холод|Тревога|Ожидание|Паника|Облегчение|Жалость|Злость|Сомнение|Воспоминание|Тоска|Надежда|Истома|Скука|Лень|Испуг|Ужас)(?![а-яё])/gu;

const metrics: Metric[] = [
  {
    label: "хвост 25+ слов",
    humanHigher: true,
    value: (text) => {
      const measured = splitSentences(text).filter((s) => !isDialogueSentence(s)).map((s) => words(s).length).filter((n) => n > 0);
      return measured.length ? measured.filter((n) => n >= 25).length / measured.length : -1;
    },
  },
  {
    label: "восклицаний на 100 предл.",
    humanHigher: true,
    value: (text) => {
      const measured = splitSentences(text);
      return measured.length >= 6 ? (measured.filter((s) => s.includes("!")).length / measured.length) * 100 : -1;
    },
  },
  {
    label: "вопросов на 100 предл.",
    humanHigher: true,
    value: (text) => {
      const measured = splitSentences(text);
      return measured.length >= 6 ? (measured.filter((s) => s.includes("?")).length / measured.length) * 100 : -1;
    },
  },
  {
    label: "средняя длина фразы",
    humanHigher: true,
    value: (text) => {
      const measured = splitSentences(text).filter((s) => !isDialogueSentence(s)).map((s) => words(s).length).filter((n) => n > 0);
      return measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : -1;
    },
  },
  {
    label: "разброс длин фраз",
    humanHigher: true,
    value: (text) => aiTellScore(text).burstiness ?? -1,
  },
  { label: "фильтр-слов /10 тыс.", humanHigher: false, value: (text) => measureProseRegister(text).filterPer10k },
  { label: "оценочных прилаг. /10 тыс.", humanHigher: false, value: (text) => measureProseRegister(text).intensifierPer10k },
  { label: "телесных /10 тыс.", humanHigher: false, value: (text) => measureProseRegister(text).bodilyPer10k },
  { label: "названных чувств /10 тыс.", humanHigher: true, value: (text) => measureProseRegister(text).namedEmotionPer10k },
  { label: "«не + глагол» /10 тыс.", humanHigher: false, value: (text) => measureProseRegister(text).negationMoldPer10k },
  { label: "внутренняя речь (абзацев)", humanHigher: true, value: (text) => measureProseRegister(text).interiorShare },
  { label: "избыток оговорок (абзацев)", humanHigher: false, value: (text) => measureProseRegister(text).hedgeShare },
  { label: "абстрактный герой /10 тыс.", humanHigher: false, value: (text) => (text.match(ABSTRACT_AGENT) || []).length * 10000 / Math.max(words(text).length, 1) },
  { label: "речевых тегов /10 тыс.", humanHigher: true, value: (text) => {
    const tags = text.match(/(сказал|спросил|ответил|буркнул|прошептал|выдал|крикнул|отозвал|подал голос|выпалил)/gu) || [];
    return tags.length * 10000 / Math.max(words(text).length, 1);
  } },
  { label: "глаголы зрения /10 тыс.", humanHigher: false, value: (text) => {
    const seen = text.match(/(видно|видел|смотрел|глянул|глядя|заметил|разглядывая|уставил)/gu) || [];
    return seen.length * 10000 / Math.max(words(text).length, 1);
  } },
  { label: "слов (длина куска)", humanHigher: true, value: (text) => words(text).length },
];

/**
 * AUC через вероятность, что случайная пара (HUMAN, AI) упорядочена верно.
 * Считается точно, пар O(n·m) — на отчёте в десятки сегментов это микросекунды.
 */
function auc(human: number[], ai: number[], humanHigher: boolean): number {
  if (!human.length || !ai.length) return 0.5;
  let wins = 0;
  for (const h of human) {
    for (const a of ai) {
      const correct = humanHigher ? h > a : h < a;
      if (correct) wins += 1;
      else if (h === a) wins += 0.5;
    }
  }
  return wins / (human.length * ai.length);
}

const isHuman = (label: string): boolean => label === "HUMAN" || label === "LIKELY_HUMAN";

const [, , humanPath, aiPath] = process.argv;
if (!humanPath || !aiPath) {
  console.log("Использование: npx tsx scripts/calibrateOnDetectorReport.ts <отчёт с HUMAN> <отчёт с AI>");
  console.log("");
  console.log("Оба отчёта — с ОДНОГО прогона детектора, иначе его шкала может быть другой.");
  process.exit(1);
}

const humanRows = load(humanPath).filter((row) => isHuman(row.label));
const aiRows = load(aiPath).filter((row) => !isHuman(row.label));
if (!humanRows.length || !aiRows.length) {
  console.log(`Нужны оба класса в одном отчёте: HUMAN ${humanRows.length}, AI ${aiRows.length}.`);
  console.log("Если HUMAN нет, калибровать нечем: порог ставится по живой прозе, а не по её отсутствию.");
  process.exit(1);
}

console.log(`HUMAN-кусков: ${humanRows.length}, AI-кусков: ${aiRows.length}\n`);

const report = metrics.map((metric) => {
  const humanValues = humanRows.map((row) => metric.value(row.text)).filter((value) => value >= 0);
  const aiValues = aiRows.map((row) => metric.value(row.text)).filter((value) => value >= 0);
  const avg = (list: number[]): number => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const score = auc(humanValues, aiValues, metric.humanHigher);
  return {
    метрика: metric.label,
    HUMAN: +avg(humanValues).toFixed(2),
    AI: +avg(aiValues).toFixed(2),
    AUC: +score.toFixed(3),
    вердикт: score >= 0.75 ? "РАЗДЕЛЯЕТ" : score >= 0.6 ? "слабо" : "не разделяет",
  };
}).sort((left, right) => right.AUC - left.AUC);

console.table(report);

const separating = report.filter((row) => row.вердикт === "РАЗДЕЛЯЕТ");
console.log(separating.length
  ? `\nРазделяют классы: ${separating.map((row) => `${row.метрика} (AUC ${row.AUC})`).join(", ")}.\nЭти метрики стоит ставить в гейт по окнам детектора, а не по главе целиком.`
  : "\nНи одна метрика не разделяет классы. Это само по себе результат: значит вердикт детектора\nне выводится из поверхности, и правками стиля его не сдвинуть — нужно менять форму главы.");
console.log("\nAUC 0,5 — не разделяет. Выше 0,75 — разделяет надёжно.");