/**
 * Архитектурная диагностика повествования.
 *
 * Зачем отдельный слой. StoryScope (arXiv:2604.03136, 61 608 историй, человек + 5
 * передовых моделей) даёт классификатору по признакам СТРУКТУРЫ ПОВЕСТВОВАНИЯ
 * macro-F1 93,2 %, а в условии LAMP, где редакторы переписали только поверхностный
 * стиль, обнаружение падает лишь с 95,5 % до 93,9 %. То есть правка слов и синтаксиса
 * почти не двигает детектор — движет его архитектура.
 *
 * До этого файла чек-лист StoryScope жил только строкой текста в промпте: модель
 * читала девять пунктов и ни один из них не проверялся на выходе. Здесь те же
 * признаки превращены в измеримые величины с порогами, чтобы дефект архитектуры
 * попадал в тот же контур приёмки, что и штампы.
 *
 * Честность метрик. Признаки «объяснение темы», «плотность сети отношений» и
 * «разнообразие эмоциональных модулей» не выводятся из текста однозначно — здесь
 * они отлавливаются по поверхностным следам (рефлексивный хвост абзаца, цепочка
 * «одумал → решил → понял», перечисление телесных реакций). Это индикаторы
 * направления, а не приговор: поэтому у каждого есть вес в баллах, а не флаг,
 * и порог общий, а не поимённый.
 */

export interface ArchitectureFinding {
  id: string;
  /** Короткая формулировка для журнала и интерфейса. */
  label: string;
  /** Насколько-finding выражен: 0 — чисто, 1 — выражено. */
  severity: number;
  /** Что делать с этим в правке. */
  advice: string;
}

export interface ArchitectureDiagnostics {
  /** Рефлексивные хвосты абзацев: «это значило, что…», «он понял, что…». */
  explanatoryTails: number;
  /** Доля абзацев, заканчивающихся таким хвостом. */
  explanatoryTailShare: number;
  /** Развязка по схеме «осознал → принял → вырос». */
  growthEnding: boolean;
  /** Решения, отданные случаю или другим людям, а не воле героя. */
  agencyShift: number;
  /** Конкретных деталей мира на 1000 слов (марка, название, число, бытовая вещь). */
  concreteAnchorsPer1k: number;
  /** Плотные телесные реакции подряд без поступка и без названного чувства. */
  bodilyReactionChains: number;
  /** Абзацы, открытые состоянием/сенсором вместо действия. */
  stateOpeners: number;
  /** Доля сцен, закрытых одним и тем же ходом (действие с «и»-хвостом). */
  uniformEndingShare: number;
  /** Итоговый балл 0–100: чем выше, тем ближе к машинной архитектуре. */
  score: number;
  findings: ArchitectureFinding[];
}

// ── Рефлексивный хвост абзаца ────────────────────────────────────────────────
// Авторский вывод в конце абзаца. В живой прозе такое бывает, но в каждом абзаце —
// уже объяснение, а не событие.
const EXPLANATORY_TAIL = /(?:это\s+(?:было|значило|оказалось|говорило)|этим\s+(?:всё|вот)\s+(?:объясняется|сказано)|получа(?:ется|лось)|значит,|то\s+есть,|и\s+вот\s+что|в\s+том\s+и\s+дело|оказалось,|как\s+и\s+ожидалось|вот\s+почему|вот\s+и\s+выходит)\s*[^.!?…]{0,120}[.!?…]?\s*$/iu;

// ── Развязка «герой выбрал → принял → вырос» ─────────────────────────────────
const GROWTH_ENDING = /(?:он\s+(?:наконец\s+)?(?:понял|осознал|решил|принял)|(?:понял|осознал|принял),?\s+что\s+всё\s+это\s+значит|теперь\s+он\s+понимал|он\s+вырос|это\s+было\s+его\s+новое\s+я)/iu;

// ── Решение отдано случаю / другому человеку / обстоятельствам ───────────────
const AGENCY_SHIFT = /(?:случай\s+(?:оказался|всё\s+решил|привёл)|вместо\s+него|не\s+он\s+решил|решил\s+не\s+он|это\s+сделал\s+не\s+он|вышло\s+не\s+так,?\s+как\s+(?:он\s+)?(?:думал|планировал|ожидал))/iu;

// ── Конкретная деталь мира: числа, названия, брендовые формы ────────────────
// «Бирюса», «КПК», «1978», «второй этаж» — то, чего нет в абстрактной прозе.
// Границы слова для кириллицы. `\b` в JS опирается на `\w`, а `\w` — только
// ASCII: «^в\s+животе\b» не срабатывает ни на одном русском слове. Поэтому все
// границы здесь и в регулярках ниже заданы явно через lookaround по [а-яё].
const WORD_END = "(?![а-яё])";

const CONCRETE_ANCHOR = new RegExp(
  "(?:"
  + "\\d{2,}"                                    // числа: 1978, 300, 42
  + "|\\d+(?:[.,]\\d+)?\\s*(?:метр\\w*|м|см|кг|градус\\w*|литр\\w*|рубл\\w*|копейк\\w*|шаг\\w*|минут\\w*|час\\w*|года|лет|раз|человека|процент\\w*)"
  + "|«[^»]{3,40}»"                             // название: «Бирюса»
  + "|[А-ЯЁ][а-яё]{2,}(?:ъ|ье|ов|ев|ин|ын|ий|ая|ое|ые|ый)" + WORD_END
  + ")",
  "gu",
);

// ── Телесная реакция ────────────────────────────────────────────────────────
const BODILY = /(?:холод(?:ок|а|ом)?\s+(?:по\s+)?(?:спине|телу|ногам)|капля\s+(?:пота|холодного\s+пота)|по\s+спине\s+прошёл\s+озноб|мурашки|(?:внутри|в\s+груди)\s+всё\s+сжалось|горло\s+(?:сжалось|пересохло)|костяшки\s+побелели|дрожь\s+прошла|сердце\s+(?:забилось|kolotilo|заколотило)|запахло\s+холодом)/iu;

// ── Названное чувство (альтернатива телесному) ───────────────────────────────
const NAMED_EMOTION = /(?:было\s+(?:страшно|тревожно|обидно|страшно\s+за\s+него)|он\s+(?:боялся|трусил|злился|обиделся|верил|не\s+верил|устал)|ей\s+было\s+(?:страшно|тревожно|стыдно|надоело)|мне\s+(?:было\s+)?(страшно|надоело|жаль|смешно))/iu;

// ── Абзац, открытый состоянием или сенсором, а не действием ─────────────────
const STATE_OPENER = new RegExp(
  "^(?:"
  + "в\\s+(?:животе|груди|голове|спине|нуме|теле)" + WORD_END
  + "|(?:по\\s+)?(?:спине|телу|рукам|ногам)\\s+(?:прошёл|прошла|полз|ледит|замер)[а-яё]*"
  + "|(?:воздух|пахло|запах|свет|тишина|темнота|пол|стены|стена|потолок|шум|гул|холод|жар|озон)" + WORD_END
  + "|ему\\s+(?:было|казалось|хотелось|не\\s+хотелось|пришлось)"
  + "|на\\s+сердце|в\\s+пасти|по\\s+телу"
  + ")",
  "iu",
);

const ACTION_OPENER = new RegExp(
  "^(?:[А-ЯЁ][а-яё]+\\s+)?(?:"
  + "сказал\\w*|спросил\\w*|ответил\\w*|буркнул\\w*|прошептал\\w*|прорычал\\w*|выкрикнул\\w*"
  + "|закричал\\w*|выдохнул\\w*|вдохнул\\w*|потянулся|присел|встал|пошёл|шагнул|повернулся"
  + "|вытащил|достал|закрыл|открыл|протянул|опустил|поднял|схватил|тронул|нащупал|замер\\w*"
  + "|остановил\\w*|развернул\\w*|ввалил\\w*|выбежал\\w*|вышел|вошёл|сел|лез|лезет"
  + ")",
  "iu",
);

// ── Концовка сцены одним и тем же ходом ─────────────────────────────────────
// «Он сделал X, и Y, всем своим видом показывая…» — закрытие главы action-clause с
// длинным «и»-хвостом. Само по себе нормально, но когда так закрыты почти все сцены,
// глава становится перечнем одинаковых кадров.
const SAME_SHAPE_ENDING = new RegExp(
  "(?:^|\\s)и\\s+[\\p{L}]+(?:\\s+[\\p{L}]+){1,3}[^.!?…]{0,80}[.!?…]?\\s*$"
  + "|[\\p{L}]+,\\s+(?:показав|сказав|не\\s+говоря|будто|как\\s+будто|словно)[^.!?…]{0,80}[.!?…]?\\s*$",
  "iu",
);

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1);
}

function paragraphsOf(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length >= 4) return paragraphs;
  // Текст без единого перевода строки — сам по себе брак формата, но он не должен
  // обнулять архитектурные метрики: в отчёте по главе 4 абзацев был один, и все
  // проверки, считавшие по абзацам, молчали. Единицей измерения становится сцена —
  // три последовательных предложения, что примерно равно объёму живой сцены.
  const sentences = sentencesOf(text);
  const scenes: string[] = [];
  for (let index = 0; index < sentences.length; index += 3) {
    scenes.push(sentences.slice(index, index + 3).join(" "));
  }
  return scenes;
}

function countMatches(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  return [...text.matchAll(global)].length;
}

/**
 * Диагностика архитектуры повествования.
 *
 * @param text проза главы
 * @param words фактическое число слов — для пересчёта плотностей на 1000 слов
 */
export function architectureDiagnostics(text: string, words?: number): ArchitectureDiagnostics {
  const wordCount = words && words > 0
    ? words
    : (text.match(/[\p{L}\p{N}]+/gu) || []).length;
  const paragraphs = paragraphsOf(text);
  const sentences = sentencesOf(text);
  const findings: ArchitectureFinding[] = [];

  // 1. Рефлексивные хвосты абзацев.
  const explanatoryTails = paragraphs.filter((paragraph) => {
    const lastSentence = sentencesOf(paragraph).slice(-1)[0] || paragraph;
    return EXPLANATORY_TAIL.test(lastSentence);
  }).length;
  const explanatoryTailShare = paragraphs.length ? explanatoryTails / paragraphs.length : 0;
  if (explanatoryTailShare > 0.25) {
    findings.push({
      id: "explanatory-tails",
      label: `вывод в конце абзаца (${explanatoryTailShare.toFixed(0)} %)`,
      severity: explanatoryTailShare,
      advice: "замени авторский вывод действием или предметом, меняющим смысл",
    });
  }

  // 2. Развязка по схеме «осознал → принял → вырос».
  const growthEnding = GROWTH_ENDING.test(text.slice(-1400));
  const agencyShift = countMatches(text, AGENCY_SHIFT);
  if (growthEnding && agencyShift === 0) {
    findings.push({
      id: "growth-ending",
      label: "развязка сводится к «герой принял и вырос»",
      severity: 0.8,
      advice: "отдай часть решения случаю, другому человеку или обстоятельствам",
    });
  }

  // 3. Заземление: конкретные детали мира.
  const concreteAnchors = countMatches(text, CONCRETE_ANCHOR);
  const concreteAnchorsPer1k = wordCount ? (concreteAnchors / wordCount) * 1000 : 0;
  if (wordCount > 600 && concreteAnchorsPer1k < 3) {
    findings.push({
      id: "no-grounding",
      label: `мало конкретных деталей мира (${concreteAnchorsPer1k.toFixed(1)} на 1000 слов)`,
      severity: Math.min((3 - concreteAnchorsPer1k) / 3, 1),
      advice: "назови что-то по-настоящему конкретное: марку, число, место, бытовую мелочь",
    });
  }

  // 4. Эмоции только телесные: плотная цепочка реакций без поступка и без названного чувства.
  const bodily = countMatches(text, BODILY);
  const named = countMatches(text, NAMED_EMOTION);
  const bodilyOnly = named === 0 && wordCount > 400 && bodily / Math.max(wordCount / 1000, 1) > 4;
  const bodilyReactionChains = bodilyOnly ? 1 : 0;
  if (bodilyOnly) {
    findings.push({
      id: "bodily-only",
      label: "эмоции даны только телесными реакциями",
      severity: Math.min(bodily / 12, 1),
      advice: "часть чувства назови словом или покажи поступком",
    });
  }

  // 5. Абзацы, открытые состоянием вместо действия.
  const stateOpeners = paragraphs.filter((paragraph) => {
    const opener = sentencesOf(paragraph)[0] || paragraph;
    return STATE_OPENER.test(opener) && !ACTION_OPENER.test(opener);
  }).length;
  const stateOpenerShare = paragraphs.length ? stateOpeners / paragraphs.length : 0;
  if (stateOpenerShare > 0.2) {
    findings.push({
      id: "state-openers",
      label: `сцены открываются состоянием, а не действием (${stateOpenerShare.toFixed(0)} %)`,
      severity: stateOpenerShare,
      advice: "начни сцену с действия или реплики, а не с ощущения героя",
    });
  }

  // 6. Однотипные концовки сцен. В отчёте по главе 4 детектора 21 сцена из 22
  // заканчивалась одной и той же фигурой «герой сделал X, и Y» — глава читалась как
  // перечень кадров. Считаем долю сцен, закрытых одним из двух ходов: действие
  // с «и»-хвостом либо вывод. Настоящая форма живой главы их смешивает.
  let sameShapeEndings = 0;
  for (const scene of paragraphs) {
    const last = sentencesOf(scene).slice(-1)[0] || scene;
    if (SAME_SHAPE_ENDING.test(last)) sameShapeEndings += 1;
  }
  const uniformEndingShare = paragraphs.length ? sameShapeEndings / paragraphs.length : 0;
  if (uniformEndingShare > 0.5) {
    findings.push({
      id: "uniform-endings",
      label: `сцены закрываются одним и тем же ходом (${(uniformEndingShare * 100).toFixed(0)} %)`,
      severity: uniformEndingShare,
      advice: "закрой часть сцен на реплике, на предмете или на паузе, а не на действии с «и»",
    });
  }

  // Балл: каждый признак даёт долю своего потолка. Сумма потолков — 100.
  const score = Math.round(Math.min(100,
    explanatoryTailShare * 22
    + (growthEnding && agencyShift === 0 ? 16 : 0)
    + (wordCount > 600 ? Math.max(0, (3 - concreteAnchorsPer1k) / 3) * 14 : 0)
    + (bodilyOnly ? Math.min(bodily / 12, 1) * 16 : 0)
    + stateOpenerShare * 16
    + Math.max(0, uniformEndingShare - 0.5) / 0.5 * 16,
  ));

  return {
    explanatoryTails,
    explanatoryTailShare,
    growthEnding,
    agencyShift,
    concreteAnchorsPer1k,
    bodilyReactionChains,
    stateOpeners,
    uniformEndingShare,
    score,
    findings: findings.sort((left, right) => right.severity - left.severity),
  };
}

/** Короткая строка для журнала конвейера. */
export function architectureNote(diagnostics: ArchitectureDiagnostics): string {
  if (!diagnostics.findings.length) return "";
  return `архитектура: ${diagnostics.findings.slice(0, 3).map((finding) => finding.label).join("; ")}`;
}

/** Блок с инструкциями правки — по одной на каждый найденный признак. */
export function architectureFixBlock(diagnostics: ArchitectureDiagnostics): string {
  if (!diagnostics.findings.length) return "";
  const lines = diagnostics.findings
    .slice(0, 4)
    .map((finding) => `- ${finding.label}. ${finding.advice}.`);
  return `АРХИТЕКТУРА (найдено в текущем тексте, поправь именно это, не всё сразу):\n${lines.join("\n")}`;
}
