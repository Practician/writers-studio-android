/**
 * Итоговая сверка главы: что осталось нечеловеческим ПОСЛЕ всех проходов.
 *
 * Зачем. Потолки главы (`MAX_SILENT_REACTIONS`, `MAX_FREEZE_REACTIONS`, счёт
 * сравнений) считались только внутри петли написания сцен. Финальная сборка —
 * склейка сцен, детерминированная склейка коротких фраз, доработка тире,
 * микродефекты, гигиена — ни разу не сверялась с этими потолками, и ни одна
 * метрика регистра на собранном тексте не вычислялась. Живой результат: в
 * готовой главе 4 оказалось 5 «не ответил/промолчал» при потолке 2, а отчёт
 * детектора давал 21 сегмент AI из 22. Потолок, который не проверяется на выходе,
 * не является потолком.
 *
 * Модуль ничего не правит: он меряет и говорит. Правкой занимаются проходы, а
 * этот отчёт попадает в журнал, в отчёт и в блок «АРХИТЕКТУРА» для последней
 * архитектурной итерации.
 */

import { aiTellScore, heavyStampHits, humanizeGatePassed, HUMANIZE_DEPTHS, type HumanizeDepthConfig } from "./humanStyle";
import { paragraphLengthCV, sentenceLengthSpread, humanProfileScore } from "./humanStyleEnhanced";
import { EMPTY_CHUNK_SHARE_LIMIT, emptyChunkShare, measureProseRegister, proseRegisterFindings, type ProseRegister } from "./proseRegister";
import { architectureDiagnostics } from "./architectureAudit";
import { punctuationHygieneNote } from "./textHygiene";

/** Границы слова для кириллицы: `\b` в JS опирается на `\w` (ASCII). */
const END = "(?![а-яё])";
const START = "(?<![а-яё])";

/** Молчание вместо ответа — тот же каркас, что и в chapterGenerate, но свой. */
const SILENT_MOLD = new RegExp(
  `${START}не\\s+(?:ответил|отозвал|сказал|произнёс|выдал|выдал[аи]?сь|промолчал)` +
  `|${START}(?:промолчал|не ответил)${END}`,
  "giu",
);

/** Реакция «замер/остолбенел» вместо действия. */
const FREEZE_MOLD = new RegExp(`${START}(?:замер|застыл|остолбенел)\\p{L}*`, "giu");

/** Сравнение — по числу союзов «словно», «как будто», «будто», «как», «точь-в-точь». */
const SIMILE_MARK = new RegExp(`${START}(?:словно|как будто|будто|точь-в-точь|как)\\p{L}*`, "giu");

export interface ChapterCapCheck {
  id: string;
  label: string;
  /** Сколько получилось. */
  actual: number;
  /** Сколько допустимо. */
  limit: number;
  /** Превышение нормы. */
  ok: boolean;
  /** Что делать, если превышено. */
  advice: string;
}

export interface ChapterVerdict {
  /** Человеческий балл, которому калиброваны гейты (эталон автора = 9). */
  score: number;
  /** Гейт прошёл по калиброванным порогам. */
  gatePassed: boolean;
  /** Причина провала, если он был. */
  gateReason: string;
  /** Насколько текст ближе к человеческому распределению, чем к машинному. */
  humanProfileScore: number;
  /** Равномерность длины абзацев — главный разделитель проекта (порог 0,60). */
  paragraphCV: number;
  /** Разброс длин предложений (порог 0,46). */
  sentenceSpread: number;
  /** Доля предложений 25+ слов. */
  longTailShare: number;
  /** Регистр прозы. */
  register: ProseRegister;
  /** Кусков детектора без длинных фраз: `empty` из `total`. */
  emptyChunks: { share: number; total: number; empty: number };
  /** Нарушения потолков главы. */
  caps: ChapterCapCheck[];
  /** Находки регистра. */
  registerFindings: ReturnType<typeof proseRegisterFindings>;
  /** Балл архитектуры 0–100 (чем выше, тем ближе к машинной архитектуре). */
  architectureScore: number;
  /** Строки для журнала. */
  notes: string[];
  /** Находки для блока правки. */
  findings: Array<{ label: string; advice: string }>;
}

/** Сколько «молчаний» в тексте: одна форма считается один раз на место. */
export function countSilentMolds(text: string): number {
  return [...text.matchAll(SILENT_MOLD)].length;
}

/** Сколько реакций «замер/застыл». */
export function countFreezeMolds(text: string): number {
  return [...text.matchAll(FREEZE_MOLD)].length;
}

/** Сколько сравнительных оборотов. */
export function countSimileMarks(text: string): number {
  return [...text.matchAll(SIMILE_MARK)].length;
}

/**
 * Сплошная проверка главы. `depth` задаёт порог гейта; `punctuationNote`
 * приходит из отчёта гигиены, чтобы строка о пунктуации была в одном месте.
 */
export function verifyChapter(text: string, depth: HumanizeDepthConfig = HUMANIZE_DEPTHS.maximum, punctuationNote = ""): ChapterVerdict {
  const score = aiTellScore(text);
  const words = score.words ?? 0;
  const gatePassed = humanizeGatePassed(score, depth.scoreGate, depth.minBurstiness);
  const reasons: string[] = [];
  if (score.score > depth.scoreGate) reasons.push(`балл ${score.score} выше порога ${depth.scoreGate}`);
  const heavy = heavyStampHits(score).length;
  if (heavy > 1) reasons.push(`тяжёлых штампов ${heavy} (эталон — 1)`);
  const measurable = words >= 200;
  if (measurable && (score.burstiness ?? 0) < depth.minBurstiness) {
    reasons.push(`разброс фраз ${(score.burstiness ?? 0).toFixed(2)} ниже порога ${depth.minBurstiness}`);
  }

  const register = measureProseRegister(text);
  const registerFindings = proseRegisterFindings(text);
  const profile = humanProfileScore(text);
  const paragraphCV = paragraphLengthCV(text);
  const spread = sentenceLengthSpread(text);
  const architecture = architectureDiagnostics(text);
  const chunks = emptyChunkShare(text);

  const caps: ChapterCapCheck[] = [
    {
      id: "silence",
      label: "молчаний вместо ответа",
      actual: countSilentMolds(text),
      limit: 2,
      ok: countSilentMolds(text) <= 2,
      advice: "на третьем молчании дай персонажу ответ, вопрос или перебивание",
    },
    {
      id: "freeze",
      label: "реакций «замер/застыл»",
      actual: countFreezeMolds(text),
      limit: 3,
      ok: countFreezeMolds(text) <= 3,
      advice: "замени реакцию на ошибку, злость, насмешку или усталость",
    },
    {
      // Порог выше человеческого (эталон 12,2 на 1000 слов): метрика слабая и
      // разделяет классы плохо — наша глава даёт 15,0. Поэтому это ориентир в
      // отчёте, а не замечание правке; ловушка была бы обратной — начать требовать
      // «меньше сравнений», чем пишет живой автор.
      id: "simile",
      label: "сравнительных оборотов на 1000 слов",
      actual: words ? Math.round((countSimileMarks(text) * 1000) / words) : 0,
      limit: 20,
      ok: words ? (countSimileMarks(text) * 1000) / words <= 20 : true,
      advice: "сравнение должно быть редким; проверь, не подменяет ли оно наблюдение",
    },
  ];

  const notes: string[] = [];
  notes.push(
    `профиль ${profile.toFixed(2)} (эталон 2,41), `
    + `CV абзацев ${paragraphCV.toFixed(2)} (порог 0,60), `
    + `разброс фраз ${spread.toFixed(2)} (порог 0,46), `
    + `хвост 25+ слов ${Math.round((score.longTailShare ?? 0) * 100)} % (человек 18–30 %), `
    + `кусков без длинных фраз ${chunks.empty} из ${chunks.total} (${Math.round(chunks.share * 100)} %, `
    + `норма ≤${Math.round(EMPTY_CHUNK_SHARE_LIMIT * 100)} %; эталон автора 29 %)`,
  );
  const breached = caps.filter((cap) => !cap.ok);
  if (breached.length) {
    notes.push(
      `потолки главы превышены: ${breached.map((cap) => `${cap.label} ${cap.actual} при норме ${cap.limit}`).join(", ")}`,
    );
  }
  if (registerFindings.length) {
    notes.push(
      `регистр: ${registerFindings.slice(0, 4).map((finding) => finding.label).join("; ")}`,
    );
  }
  if (architecture.findings.length) {
    notes.push(`архитектура ${architecture.score}/100: ${architecture.findings.slice(0, 3).map((f) => f.label).join("; ")}`);
  }
  if (punctuationNote) notes.push(punctuationNote);
  if (!gatePassed) notes.push(`гейт: не пройден — ${reasons.join("; ")}`);

  const findings = [
    ...registerFindings.map((finding) => ({ label: finding.label, advice: finding.advice })),
    ...architecture.findings.slice(0, 3).map((finding) => ({ label: finding.label, advice: finding.advice })),
    ...breached.map((cap) => ({ label: `${cap.label}: ${cap.actual} при норме ${cap.limit}`, advice: cap.advice })),
  ];

  return {
    score: score.score,
    gatePassed,
    gateReason: reasons.join("; "),
    humanProfileScore: profile,
    paragraphCV,
    sentenceSpread: spread,
    longTailShare: score.longTailShare ?? 0,
    register,
    emptyChunks: chunks,
    caps,
    registerFindings,
    architectureScore: architecture.score,
    notes,
    findings,
  };
}

/** Блок промпта: что именно чинить в последнем проходе. */
export function chapterVerdictFixBlock(verdict: ChapterVerdict): string {
  if (!verdict.findings.length) return "";
  return `ГЛАВА ЦЕЛИКОМ (найдено в финальном тексте, поправь по списку, не всё сразу):\n${
    verdict.findings.slice(0, 6).map((finding) => `- ${finding.label}. ${finding.advice}.`).join("\n")
  }`;
}