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

/**
 * Потолок доли абзацев-реплик.
 *
 * Эталон автора — 37 % (`Вася.txt`, главы 1–3: 63 реплики из 170 блоков).
 * Глава 4 сборки 119 дала 55 % (54 из 99). Порог 0,50 — выше человеческого:
 * реплик у автора не мало, и требовать меньше было бы ровно тем ловушечным
 * «улучшением», которым уже страдал проект (см. комментарий у `simile`).
 */
const SPEECH_SHARE_LIMIT = 0.5;

/**
 * Блоки текста для сверки формы: абзацы, а если в тексте почти нет пустых строк
 * (так устроены авторские рукописи: `Вася.txt` — 170 строк и всего 8 пустых) —
 * то непустые строки.
 *
 * Без второй ветки доля реплик у самого автора считалась как 0 %: девять блоков
 * по 100–700 слов, ни один не начинается со знака реплики, и метрика уезжала
 * врать именно на том тексте, с которым сверялась.
 */
function formBlocks(text: string): string[] {
  const source = String(text || "");
  const paragraphs = source.split(/\n{2,}/u).map((block) => block.trim()).filter(Boolean);
  if (paragraphs.length >= 8) return paragraphs;
  const lines = source.split(/\n/u).map((line) => line.trim()).filter(Boolean);
  return lines.length > paragraphs.length ? lines : paragraphs;
}

/** Доля абзацев, начинающихся со знака реплики (тире или дефис), 0…1. */
export function speechParagraphShare(text: string): number {
  const blocks = formBlocks(text);
  if (!blocks.length) return 0;
  const speech = blocks.filter((block) => /^[ \t]*[—–―-]\s/u.test(block)).length;
  return speech / blocks.length;
}

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
  const speechShare = Math.round(speechParagraphShare(text) * 100);

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
    {
      // Доля абзацев-реплик. Эталон 37 % (`Вася.txt`, главы 1–3), глава 4
      // сборки 119 дала 55 %. Метрика не была в потолках вовсе, хотя
      // `dialogueShare` считывался и печатался в отчёте: раздутый диалог
      // проходил незамеченным. Порог выше человеческого — отнимать у автора
      // право на диалог нельзя, но и за пределами эталонного коридора это
      // уже «роуминг реплик», а не сцена.
      id: "speech-share",
      label: "реплик среди абзацев",
      actual: speechShare,
      limit: Math.round(SPEECH_SHARE_LIMIT * 100),
      ok: speechShare <= Math.round(SPEECH_SHARE_LIMIT * 100),
      advice: "собери две соседние реплики в один абзац и добавь между ними одно действие",
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