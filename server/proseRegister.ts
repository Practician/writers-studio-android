/**
 * Регистр прозы: что человек делает иначе, чем модель — по эталону ТОГО ЖЕ автора.
 *
 * Зачем отдельный слой. `humanStyle.ts` (сборки 105–113) чинит ритм, оформление и
 * штампы, и всё это после калибровки действительно лежит внутри человеческого
 * диапазона: доля фраз ≤6 слов 0,25 при эталонных 0,07–0,56, хвост 12–17 % при
 * 18–30 %, зачины 10–14 % при пороге 16, кавычки 0. При этом внешний детектор на
 * том же отчёте даёт 21 сегмент AI из 22. То есть откалиброванные метрики перестали
 * различать классы — и это не совпадение.
 *
 * По StoryScope (arXiv:2604.03136, на который ссылается сам скилл sepia) признаки
 * ПОВЕСТВАТЕЛЬНОЙ АРХИТЕКТУРЫ дают классификатору macro-F1 93,2 %, а в условии
 * LAMP, где редакторы переписали только поверхностный стиль, обнаружение падает
 * лишь с 95,5 % до 93,9 %. Правка слов и синтаксиса детектор почти не двигает.
 *
 * Этот модуль закрывает то, что осталось незамеченным, и всё, что в нём, отмерено
 * на одном и том же материале: авторский текст `Вася.txt` (38 145 знаков,
 * 100 % HUMAN по отчёту нейродетектора от 01.10.2026) против сгенерированной главы 4
 * той же книги. Модуль НЕ решает, AI текст или нет: он меряет регистр и говорит,
 * где конкретно текст дальше от человека, чем нужно.
 *
 * Каждый порог внизу помечен источником. Общее правило проекта (docs/SEPIA.md, §2):
 * порог обязан быть не выше человеческого значения, иначе гейт начинает ронять
 * живую прозу; наша глава 4 и есть пример — гейт «Максимума» не проходит даже
 * эталон автора.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Эталон автора. Значения сняты scripts/measureProseRegister.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Плотность телесных реакций на 10 000 слов. Эталон — 0, наша глава — 22,3. */
export const HUMAN_BODILY_PER_10K = 0;
/**
 * Порог «эмоция дана только телом». Эталон 0, наша глава 22,3 — берём 9.
 * Порог ВЫШЕ человеческого значения и это сознательно: метрика не блокирует
 * приёмку, а только называет модеди цифру. Блокирующий порог ниже эталонного
 * сделал бы замечание мёртвым.
 */
export const BODILY_PER_10K_LIMIT = 9;

/**
 * Плотность фильтр-слов на 10 000 слов («словно», «казалось», «вроде»,
 * «как будто»). Это класс, который sepia style-pass §3 называет filter words и
 * велит вычищать, а §4 велит заменить простыми связками. Отдельно от оценочных
 * прилагательных: «идеально» и «аккуратно» — обычные слова, и в эталоне автора
 * они есть, «словно» там нет ни разу.
 */
export const HUMAN_FILTER_PER_10K = 34;
/** Порог давления фильтр-слов. Эталон 34,3, наша глава 108,7 — берём 62. */
export const FILTER_PER_10K_LIMIT = 62;

/**
 * Плотность оценочных прилагательных, заменяющих наблюдение
 * («идеально», «аккуратно», «необычно», «заметно»). Эталон — 46,3,
 * наша глава — 133,8.
 */
export const HUMAN_INTENSIFIER_PER_10K = 46;
/** Порог давления оценочных прилагательных. Эталон 46,3, наша глава 133,8 — берём 95. */
export const INTENSIFIER_PER_10K_LIMIT = 95;

/**
 * Плотность одной синтаксической формы «не + глагол» («не ответил»,
 * «не оборачиваясь», «не шевелился») на 10 000 слов. Эталон — 10,3, наша глава — 41,8.
 * Это не клише, а заготовка конструкции: повтор одного каркаса читается как
 * машинная грамматика, даже когда слова разные.
 */
export const HUMAN_NEGATION_MOLD_PER_10K = 10;
/** Порог повтора одного отрицательного каркаса. Эталон 10,3, наша глава 41,8 — берём 26. */
export const NEGATION_MOLD_PER_10K_LIMIT = 26;

/**
 * Доля абзацев из одной фразы среди абзацев без прямой речи.
 * Эталон — 0,55, наша глава — 0,05. У человека абзац часто состоит из одной фразы
 * (sepia discourse-pass §3: «ragged — including a one-sentence paragraph»).
 */
export const HUMAN_ONE_SENTENCE_PARAGRAPH_SHARE = 0.55;
/** Порог однотипной формы абзаца. Срабатывает, когда однофразных почти нет. */
export const ONE_SENTENCE_SHARE_LIMIT = 0.22;

/**
 * Доля абзацев с прямой мыслью героя («подумал», «решил», «решил, что…»).
 * Эталон — 7 %, наша глава — 0 %. Это «глубина внутреннего доступа», которую
 * StoryScope считает по шкале 1–5 (человек 3,67, модель 3,93): при нулевой
 * интерьерности персонаж не решает ничего внутри, и глава читается как рапорт
 * о происходящем снаружи. Обратная сторона медали: главная 4 — 15 телесных
 * реакций и ни одного названного чувства, то есть интерьер вытеснен в тело.
 */
export const HUMAN_INTERIOR_SHARE = 0.07;
/** Порог полного отсутствия внутренней речи. Срабатывает от 0,035. */
export const INTERIOR_SHARE_FLOOR = 0.035;

/**
 * Доля абзацев с оговоркой или сомнением («может», «наверное», «вроде»,
 * «похоже», «казалось»). Эталон — 8 %, наша глава — 24 %.
 * Здесь наоборот: избыток оговорок читается как неуверенность машины, которая
 * боится показать, что не знает. sepia narrative-pass §5 требует наоборот —
 * прямого называния чувства, а не постоянного «казалось».
 */
export const HUMAN_HEDGE_SHARE = 0.08;
/** Порог избытка оговорок. Эталон 8 %, наша глава 24 % — берём 16 %. */
export const HEDGE_SHARE_LIMIT = 0.16;

/**
 * Плотность дословных повторов четырёхсловного оборота на 10 000 слов.
 * Эталон — 34,3, наша глава — 55,7. StoryScope измеряет «drop ratio» — долю
 * элементов, которые не возвращаются при перегенерации: человек 3,7 %,
 * модели 9–11 %. Повтор одного оборота двумя способами — прямой замер этого
 * же: у человека проза повторяет слова («Илья ни как не мог»), у модели
 * пересказывает синонимами и теряет общность.
 */
export const HUMAN_VERBATIM_REPEAT_PER_10K = 34;
/** Порог обеднения повторами. Эталон 34,3 — берём 75. */
export const VERBATIM_REPEAT_PER_10K_LIMIT = 75;

// ─────────────────────────────────────────────────────────────────────────────
// Регулярные выражения. Широкие каркасы, а не списки клише.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Телесная реакция — ВАЗДУШНЫЙ каркас, а не список штампов.
 *
 * Прежняя проверка (architectureAudit.ts, `BODILY`) перечисляла двенадцать клише
 * («холодок по спине», «мурашки», «костяшки побелели»). Наша глава написана
 * разнообразной телесной лексикой — «гул отозвался в позвоночнике резкой дрожью»,
 * «пальцы дрожали», «кожа саднила», «горло пересохло» — и не давала ни одного
 * попадания, при плотности в восемь раз выше author's. Режим «показать вместо
 * назвать» надо ловить по каркасу, а не по словарю.
 */
const BODILY_REACTION = new RegExp(
  "(?:"
  + "дрож\\p{L}*|озноб\\p{L}*|мурашк\\p{L}*"
  + "|холод(?:ок|а|ом|е)?\\s+(?:по\\s+)?(?:спине|телу|ногам|рукам|костям|хребту|руке)"
  + "|внутри\\s+(?:вс[её]|это|его|её)?\\s*\\p{L}{0,12}?(?:сжал\\p{L}*|сжима\\p{L}*|перевернул\\p{L}*"
  + "|вздрог\\p{L}*|перехватил\\p{L}*|защемило|щемит|задрожал\\p{L}*|сдавил\\p{L}*|нехорош\\p{L}*)"
  + "|костяшк\\p{L}*\\s+побел\\p{L}*"
  + "|сердц\\p{L}*\\s+(?:забил\\p{L}*|колот\\p{L}*|замер\\p{L}*|ускор\\p{L}*|пропустил)"
  + "|горл(?:о|а|у|ом)\\s+(?:сжал\\p{L}*|пересох\\p{L}*|перехват\\p{L}*)"
  + "|в\\s+ушах\\s+звен\\p{L}*"
  + "|по\\s+позвоночник\\p{L}*\\s+\\p{L}{3,}"
  + "|пальц\\p{L}*\\s+(?:дрож\\p{L}*|подраг\\p{L}*|скользн\\p{L}*)"
  + "|шрам\\s+ж[её]г|щ[её]к\\p{L}*\\s+гор\\p{L}*"
  + "|кож\\p{L}*\\s+(?:гор\\p{L}*|жгл|саднил|покрыл)"
  + "|живот\\s+(?:свело|скрутил)|тошнот|подкатил\\p{L}*\\s+тошнот"
  + "|волна\\s+(?:холод|тепла|жара|обид)|жар(?:ом)?\\s+обдал|холодом\\s+обдал"
  + "|ноги\\s+(?:подкос\\p{L}*|стали\\s+ватн)"
  + "|во\\s+рту\\s+(?:попал|пересох)|слюн\\p{L}*\\s+произвол|дрожь\\s+прошл"
  + ")",
  "giu",
);

/** Названное чувство — «было страшно», «он боялся», «её злило». */
const NAMED_EMOTION = new RegExp(
  "(?:"
  + "(?:было|был[аи]?|становил[аио]?|становилось)\\s+"
  + "(?:страшн\\p{L}*|тревожн\\p{L}*|обидн\\p{L}*|стыдн\\p{L}*|тревог\\p{L}*|патн\\p{L}*"
  + "|неловк\\p{L}*|растерянн\\p{L}*|злобн\\p{L}*|устал[аи]?|весел[аио]?|хорошо|плохо"
  + "|скучн\\p{L}*|тоскливо|надеждн\\p{L}*|досадно|голодн\\p{L}*|стыдно|радостн\\p{L}*|любопытн\\p{L}*)"
  + "|\\p{L}{2,}\\s+(?:боял[аи]?|боит\\p{L}*|трусил[аи]?|злил[аи]?|зло|обидел[аи]?|недоволен\\p{L}*"
  + "|растерял[аи]?|обрадова\\p{L}*|удивил[аи]?|удивля\\p{L}*|испугал[аи]?|успокоил[аи]?|над\\p{L}*)"
  + "|чувств\\p{L}*\\s+(?:было|был)|(?:было|был)\\s+(?:чувство|жаль|смешн[ао]?|весел[ао]?|устал[аи]?)"
  + ")",
  "giu",
);

/**
 * Фильтр-слова — класс, который sepia style-pass §3 перечисляет отдельно
 * («filter words: felt, seemed, realized, noticed, knew — delete the filter»):
 * слово сообщает не о предмете, а о том, что автор хочет, чтобы читатель это
 * заметил. В эталоне автора их 34,3 на 10 000 слов, в нашей главе 108,7 —
 * «словно» там не встречается ни разу. Ни одна из сборок 105–113 их не считала.
 */
const FILTER_WORD = new RegExp(
  "(?:"
  + "словно|как будто|будто бы|как-то|каким-то|каким образом|кто знает"
  + "|казалось|казалось бы|похоже на|похоже,|вроде бы|вроде|выходит,|получа(?:ется|лось)"
  + "|едва|чуть-чуть|более или менее|наверное|пожалуй|как-никак"
  + "|незаметно|неощутимо|неопределённо|неразличимо"
  + ")",
  "giu",
);

/**
 * Оценочные прилагательные и усилители, заменяющие наблюдение. В эталоне автора
 * они есть и их не следует вычищать (46,3 на 10 000 слов) — порог стоит выше
 * эталонного, ловит только давление: в нашей главе 173,2.
 */
const INTENSIFIER_WORD = new RegExp(
  "(?:"
  + "идеальн|аккуратн|необычн|неожиданн|странн|заметн|печальн|тревожн"
  + "|ровн|глух|слаб|чётк|четк|безупречн|изящн|точен"
  + "|очень|весьма|крайне|чрезвычайно|бесконечно|бесчисленно|невероятно|чудовищн"
  + "|буквально|практически|фактически|действительно|поистине|абсолютно"
  + ")",
  "giu",
);

/**
 * Отрицательный каркас «не + глагол». Считается не по словарю, а по форме:
 * отрицание при глаголе («не ответил», «не оборачиваясь», «не шевелился»,
 * «не отрывая взгляда»). Одна конструкция, повторённая пять раз подряд,
 * читается как грамматика конечного автомата.
 */
const NEGATION_MOLD = new RegExp(
  "(?<![\\p{L}])не\\s+(?:"
  + "ответил\\p{L}*|промолчал\\p{L}*|сказал\\p{L}*|сказала\\p{L}*|говорил\\p{L}*"
  + "|оборачива\\p{L}*|оберну\\p{L}*|двига\\p{L}*|двинул\\p{L}*|шевел\\p{L}*|шевелил\\p{L}*"
  + "|отрыв\\p{L}*|отрыва\\p{L}*|смотрел\\p{L}*|смотр\\p{L}*|повернул\\p{L}*|поверн\\p{L}*"
  + "|подал\\p{L}*|вздраг\\p{L}*|вздрог\\p{L}*|замер\\p{L}*|застыл\\p{L}*"
  + "|шелохнул\\p{L}*|повел\\p{L}*|повело|заметил\\p{L}*|замеча\\p{L}*|показал\\p{L}*|показалось"
  + "|тронул\\p{L}*|пошел\\p{L}*|пошёл\\p{L}*|пошла\\p{L}*|пошли\\p{L}*|подумал\\p{L}*|решил\\p{L}*"
  + "|коснул\\p{L}*|успел\\p{L}*|смог\\p{L}*"
  + ")(?![\\p{L}])",
  "giu",
);

/** Прямая мысль героя — «подумал», «решил», «считал». */
const INTERIOR_MOVE = new RegExp(
  "(?<![\\p{L}])(?:подумал|подумала|решил|решила|считал|считала|решил, что|подумал, что"
  + "|мыслил|задумался|прикинул|вспомнил, что|помнил, что)(?![\\p{L}])",
  "giu",
);

/** Оговорка или сомнение — «может», «наверное», «вроде», «похоже». */
const HEDGE_MOVE = new RegExp(
  "(?<![\\p{L}])(?:может|может быть|наверное|вроде|вроде бы|похоже|похоже на"
  + "|казалось|казалось бы|как будто|едва ли|вряд ли|на случай|вроде бы)(?![\\p{L}])",
  "giu",
);

// ─────────────────────────────────────────────────────────────────────────────
// Замеры
// ─────────────────────────────────────────────────────────────────────────────

export interface ProseRegister {
  /** Телесных реакций на 10 000 слов. */
  bodilyPer10k: number;
  /** Названных эмоций на 10 000 слов. */
  namedEmotionPer10k: number;
  /** Режим эмоции: 0 — нет чувства вовсе, 1 — только названные, >1 — тело доминирует. */
  emotionMode: number;
  /** Фильтр-слов на 10 000 слов («словно», «казалось», «вроде»). */
  filterPer10k: number;
  /** Оценочных прилагательных и усилителей на 10 000 слов. */
  intensifierPer10k: number;
  /** Отрицательных каркасов «не + глагол» на 10 000 слов. */
  negationMoldPer10k: number;
  /** Абзацы без прямой речи: их число, доля однофразных, мода фразы. */
  narrativeParagraphs: number;
  oneSentenceParagraphShare: number;
  /** Мода числа фраз в абзаце и её доля. */
  modalSentenceCount: number;
  modalSentenceCountShare: number;
  /** Доля абзацев с прямой мыслью героя. */
  interiorShare: number;
  /** Доля абзацев с оговоркой или сомнением. */
  hedgeShare: number;
  /** Повторов оборота из 5+ слов на 10 000 слов. */
  verbatimRepeatPer10k: number;
  /** Примеры дословных повторов (для журнала и промпта правки). */
  verbatimSamples: string[];
  /** Реплик всего, из них с длинным тире и с коротким дефисом. */
  speechLines: number;
  speechEmDash: number;
  speechHyphen: number;
  /** Слов в тексте. */
  words: number;
}

export interface ProseRegisterFinding {
  id: string;
  label: string;
  /** 0 — чисто, 1 — предел коридора человека. */
  severity: number;
  /** Что делать в правке. */
  advice: string;
}

export interface ProseRegisterReport {
  metrics: ProseRegister;
  findings: ProseRegisterFinding[];
}

function words(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) || []).length;
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 1);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1);
}

function isSpeechLine(paragraph: string): boolean {
  return /^[ \t]*(?:—|–|-)\s+\S/u.test(paragraph);
}

function matchCount(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].length;
}

/** Обороты из 5+ слов, встретившиеся в тексте больше одного раза. */
function repeatedPhrases(text: string, minWords = 4, minCount = 2): string[] {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const grams = new Map<string, number>();
  for (let index = 0; index + minWords <= tokens.length; index += 1) {
    const gram = tokens.slice(index, index + minWords).join(" ");
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  return [...grams.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([gram]) => gram);
}

/**
 * Полный замер регистра. Чистая функция: на одном тексте всегда один и тот же
 * результат, поэтому её можно звать и в петле сцен, и на собранной главе, и в
 * отчёте, и в тестах.
 */
export function measureProseRegister(text: string): ProseRegister {
  const body = text.replace(/\r/gu, "");
  const wordCount = Math.max(words(body), 1);
  const per10k = (value: number): number => Math.round((value * 10000) / wordCount * 10) / 10;

  const bodily = matchCount(body, BODILY_REACTION);
  const named = matchCount(body, NAMED_EMOTION);
  const filters = matchCount(body, FILTER_WORD);
  const intensifiers = matchCount(body, INTENSIFIER_WORD);
  const molds = matchCount(body, NEGATION_MOLD);

  const paragraphsList = paragraphs(body);
  const narrative = paragraphsList.filter((paragraph) => !isSpeechLine(paragraph));
  const perParagraph = narrative.map((paragraph) => sentences(paragraph).length).filter((n) => n > 0);
  const oneSentence = perParagraph.filter((n) => n === 1).length;
  const histogram = new Map<number, number>();
  perParagraph.forEach((n) => histogram.set(n, (histogram.get(n) || 0) + 1));
  const modal = [...histogram.entries()].sort((left, right) => right[1] - left[1])[0] || [0, 0];
  const interior = narrative.filter((paragraph) => INTERIOR_MOVE.test(paragraph)).length;
  const hedged = narrative.filter((paragraph) => HEDGE_MOVE.test(paragraph)).length;

  const repeats = repeatedPhrases(body);

  const speechLines = paragraphsList.filter(isSpeechLine);
  const speechEmDash = speechLines.filter((paragraph) => /^[ \t]*—/u.test(paragraph)).length;
  const speechHyphen = speechLines.length - speechEmDash;

  return {
    bodilyPer10k: per10k(bodily),
    namedEmotionPer10k: per10k(named),
    emotionMode: named === 0 ? (bodily > 0 ? 2 : 0) : Math.round((bodily / named) * 10) / 10,
    filterPer10k: per10k(filters),
    intensifierPer10k: per10k(intensifiers),
    negationMoldPer10k: per10k(molds),
    narrativeParagraphs: narrative.length,
    oneSentenceParagraphShare: narrative.length ? Math.round((oneSentence / narrative.length) * 100) / 100 : 0,
    modalSentenceCount: modal[0],
    modalSentenceCountShare: narrative.length ? Math.round((modal[1] / narrative.length) * 100) / 100 : 0,
    interiorShare: narrative.length ? Math.round((interior / narrative.length) * 100) / 100 : 0,
    hedgeShare: narrative.length ? Math.round((hedged / narrative.length) * 100) / 100 : 0,
    verbatimRepeatPer10k: per10k(repeats.length * 4),
    verbatimSamples: repeats,
    speechLines: speechLines.length,
    speechEmDash,
    speechHyphen,
    words: wordCount,
  };
}

/**
 * Замечания по регистру: строки для промпта и журнала. Каждое замечание называет
 * измеренную величину и эталон — по правилу sepia «no quote — no signal» без
 * цифры замечание не считается.
 */
export function proseRegisterIssues(text: string, options: { minParagraphs?: number } = {}): string[] {
  const metrics = measureProseRegister(text);
  const issues: string[] = [];
  if (metrics.words < 120) return issues;
  const minParagraphs = options.minParagraphs ?? 6;

  if (metrics.bodilyPer10k >= BODILY_PER_10K_LIMIT) {
    issues.push(
      `эмоция дана только телом: телесных реакций ${metrics.bodilyPer10k} на 10 тыс. слов против ${HUMAN_BODILY_PER_10K} у человека, `
      + `названных чувств ${metrics.namedEmotionPer10k} — назови чувство словом там, где сейчас только ощущение `
      + `(холодок, дрожь, сжалось внутри), и оставь телесным не больше двух пиков`,
    );
  }
  if (metrics.filterPer10k >= FILTER_PER_10K_LIMIT) {
    issues.push(
      `фильтр-слов ${metrics.filterPer10k} на 10 тыс. слов против ${HUMAN_FILTER_PER_10K} у человека `
      + `(«словно», «казалось», «вроде», «похоже», «едва») — убери фильтр и покажи предмет или поступок; `
      + `верни простые связки «потому что», «так», «ну», «просто»`,
    );
  }
  if (metrics.intensifierPer10k >= INTENSIFIER_PER_10K_LIMIT) {
    issues.push(
      `давление оценочных прилагательных ${metrics.intensifierPer10k} на 10 тыс. слов `
      + `против ${HUMAN_INTENSIFIER_PER_10K} у человека («идеально», «аккуратно», «необычно», «заметно») — `
      + `замени треть из них конкретным наблюдением: что именно видно и чем это отличается`,
    );
  }
  if (metrics.negationMoldPer10k >= NEGATION_MOLD_PER_10K_LIMIT) {
    issues.push(
      `повтор одного отрицательного каркаса «не + глагол»: ${metrics.negationMoldPer10k} на 10 тыс. слов `
      + `против ${HUMAN_NEGATION_MOLD_PER_10K} у человека — третьему такому месту дай другое действие, `
      + `а не ещё одно молчание`,
    );
  }
  if (metrics.narrativeParagraphs >= minParagraphs) {
    if (metrics.oneSentenceParagraphShare <= ONE_SENTENCE_SHARE_LIMIT && metrics.modalSentenceCountShare >= 0.45) {
      issues.push(
        `форма абзаца однотипна: однофразных абзацев ${Math.round(metrics.oneSentenceParagraphShare * 100)} % `
        + `против ${Math.round(HUMAN_ONE_SENTENCE_PARAGRAPH_SHARE * 100)} % у человека, `
        + `у ${Math.round(metrics.modalSentenceCountShare * 100)} % абзацев ровно ${metrics.modalSentenceCount} фразы — `
        + `часть абзацев оставь из одной фразы, часть разбей`,
      );
    }
    if (metrics.interiorShare < INTERIOR_SHARE_FLOOR) {
      issues.push(
        `нет внутренней речи: мысль героя («подумал», «решил») стоит в `
        + `${Math.round(metrics.interiorShare * 100)} % абзацев против ${Math.round(HUMAN_INTERIOR_SHARE * 100)} % у человека — `
        + `дай герою одно решение внутри, которое он не озвучивает`,
      );
    }
    if (metrics.hedgeShare >= HEDGE_SHARE_LIMIT) {
      issues.push(
        `избыток оговорок: «может», «вроде», «похоже», «казалось» в `
        + `${Math.round(metrics.hedgeShare * 100)} % абзацев против ${Math.round(HUMAN_HEDGE_SHARE * 100)} % у человека — `
        + `убери оговорку там, где автор знает, что происходит`,
      );
    }
  }
  if (metrics.verbatimRepeatPer10k >= VERBATIM_REPEAT_PER_10K_LIMIT && metrics.verbatimSamples.length) {
    issues.push(
      `дословный повтор одного образа: ${metrics.verbatimRepeatPer10k} на 10 тыс. слов `
      + `(«${metrics.verbatimSamples[0]}») — второй раз эта картинка не нужна, дай другое наблюдение`,
    );
  }
  return issues;
}

/** Находки для блока «АРХИТЕКТУРА» и для журнала: то же, что issues, но с баллом. */
export function proseRegisterFindings(text: string): ProseRegisterFinding[] {
  const metrics = measureProseRegister(text);
  const findings: ProseRegisterFinding[] = [];
  const push = (id: string, label: string, severity: number, advice: string) => {
    if (severity > 0.15) findings.push({ id, label, severity: Math.min(severity, 1), advice });
  };

  if (metrics.bodilyPer10k >= BODILY_PER_10K_LIMIT) {
    push(
      "emotion-embodied",
      `эмоция только телесная (${metrics.bodilyPer10k} на 10 тыс. слов против ${HUMAN_BODILY_PER_10K})`,
      (metrics.bodilyPer10k - BODILY_PER_10K_LIMIT) / Math.max(BODILY_PER_10K_LIMIT, 1),
      "назови чувство словом в двух-трёх местах, оставь телесным только пик",
    );
  }
  if (metrics.filterPer10k >= FILTER_PER_10K_LIMIT) {
    push(
      "filter-words",
      `фильтр-слов ${metrics.filterPer10k} против ${HUMAN_FILTER_PER_10K}`,
      (metrics.filterPer10k - FILTER_PER_10K_LIMIT) / Math.max(FILTER_PER_10K_LIMIT, 1),
      "убери фильтр, покажи предмет или поступок",
    );
  }
  if (metrics.intensifierPer10k >= INTENSIFIER_PER_10K_LIMIT) {
    push(
      "intensifier-pressure",
      `давление оценочных прилагательных (${metrics.intensifierPer10k} против ${HUMAN_INTENSIFIER_PER_10K})`,
      (metrics.intensifierPer10k - INTENSIFIER_PER_10K_LIMIT) / Math.max(INTENSIFIER_PER_10K_LIMIT, 1),
      "замени оценивание наблюдением",
    );
  }
  if (metrics.negationMoldPer10k >= NEGATION_MOLD_PER_10K_LIMIT) {
    push(
      "negation-mold",
      `повтор каркаса «не + глагол» (${metrics.negationMoldPer10k} против ${HUMAN_NEGATION_MOLD_PER_10K})`,
      (metrics.negationMoldPer10k - NEGATION_MOLD_PER_10K_LIMIT) / Math.max(NEGATION_MOLD_PER_10K_LIMIT, 1),
      "на третий такой молчаний дай поступок, вопрос или перебивание",
    );
  }
  if (metrics.narrativeParagraphs >= 6) {
    if (metrics.oneSentenceParagraphShare <= ONE_SENTENCE_SHARE_LIMIT && metrics.modalSentenceCountShare >= 0.45) {
      push(
        "uniform-paragraph-shape",
        `однотипная форма абзаца (однофразных ${Math.round(metrics.oneSentenceParagraphShare * 100)} % против ${Math.round(HUMAN_ONE_SENTENCE_PARAGRAPH_SHARE * 100)} %)`,
        (0.45 - metrics.oneSentenceParagraphShare) / 0.45,
        "оставь часть абзацев из одной фразы, часть разбей",
      );
    }
    if (metrics.interiorShare < INTERIOR_SHARE_FLOOR) {
      push(
        "no-interior-voice",
        `нет внутренней речи (${Math.round(metrics.interiorShare * 100)} % абзацев против ${Math.round(HUMAN_INTERIOR_SHARE * 100)} %)`,
        Math.min(1 - metrics.interiorShare / Math.max(HUMAN_INTERIOR_SHARE, 0.01), 1),
        "дай герою одно неозвученное решение",
      );
    }
    if (metrics.hedgeShare >= HEDGE_SHARE_LIMIT) {
      push(
        "hedge-overload",
        `избыток оговорок (${Math.round(metrics.hedgeShare * 100)} % абзацев против ${Math.round(HUMAN_HEDGE_SHARE * 100)} %)`,
        (metrics.hedgeShare - HEDGE_SHARE_LIMIT) / Math.max(HEDGE_SHARE_LIMIT, 0.01),
        "убери оговорку, где автор знает",
      );
    }
  }
  if (metrics.verbatimRepeatPer10k >= VERBATIM_REPEAT_PER_10K_LIMIT) {
    push(
      "verbatim-image-repeat",
      `образ повторён дословно (${metrics.verbatimSamples[0] || "—"})`,
      (metrics.verbatimRepeatPer10k - VERBATIM_REPEAT_PER_10K_LIMIT) / Math.max(VERBATIM_REPEAT_PER_10K_LIMIT, 1),
      "замени второе вхождение другим наблюдением",
    );
  }
  return findings.sort((left, right) => right.severity - left.severity);
}

/**
 * Замечания по регистру для ОДНОЙ СЦЕНЫ (сборка 114).
 *
 * Отдельная точка входа не из упрямства: плотности на куске в 300 слов шумны, и
 * общий список на сцене давал бы то ложные срабатывания, то пропуски. Поэтому
 * здесь меньше признаков и не больше двух замечаний за раз — иначе перезапрос
 * превращается в переписывание сцены по списку и стоит дороже, чем даёт.
 */
export function proseRegisterSceneIssues(text: string, maxIssues = 2): string[] {
  // Минимум замера — общий (120 слов, см. proseRegisterIssues). Отдельный порог
  // для сцены был лишним: он молчал там, где общий замер уже давал верный ответ,
  // и проверка на сцене расходилась с проверкой на собранной главе.
  return proseRegisterIssues(text, { minParagraphs: 4 }).slice(0, maxIssues);
}

/** Короткая строка для журнала: «регистр: тело 42/10тыс (человек 5), наречия 25 (7)». */
export function proseRegisterNote(text: string): string {
  const metrics = measureProseRegister(text);
  return `регистр: телесных реакций ${metrics.bodilyPer10k}/10тыс (человек ${HUMAN_BODILY_PER_10K}), `
    + `фильтр-слов ${metrics.filterPer10k} (${HUMAN_FILTER_PER_10K}), `
    + `оценочных прилаг. ${metrics.intensifierPer10k} (${HUMAN_INTENSIFIER_PER_10K}), `
    + `«не + глагол» ${metrics.negationMoldPer10k} (${HUMAN_NEGATION_MOLD_PER_10K}), `
    + `однофразных абзацев ${Math.round(metrics.oneSentenceParagraphShare * 100)} % `
    + `(${Math.round(HUMAN_ONE_SENTENCE_PARAGRAPH_SHARE * 100)} %), `
    + `внутренней речи ${Math.round(metrics.interiorShare * 100)} % `
    + `(${Math.round(HUMAN_INTERIOR_SHARE * 100)} %), `
    + `оговорок ${Math.round(metrics.hedgeShare * 100)} % (${Math.round(HUMAN_HEDGE_SHARE * 100)} %), `
    + `повторов образа ${metrics.verbatimRepeatPer10k}`;
}

/**
 * Знак тире, которым автор пишет реплики. Калибровка сборки 108 зафиксировала:
 * в авторских главах 63 реплики на 38 000 знаков и ни одного длинного тире —
 * дефис. Проход расстановки тире сборки 113 требовал от модели «—», то есть вносил
 * в текст чужой отпечаток. Здесь знак берётся из образца автора.
 */
export function authorSpeechMark(sample: string): { mark: "—" | "-"; long: number; short: number } {
  const lines = paragraphs(sample).filter(isSpeechLine);
  // Образца нет — сравнение 0 >= 0 объявляло бы знаком автора дефис, которого в
  // образце нет. При отсутствии данных поведение по умолчанию — длинное тире,
  // как пишет живая русская проза вообще.
  if (!lines.length) return { mark: "—", long: 0, short: 0 };
  const short = lines.filter((paragraph) => /^[ \t]*-(?!-)/u.test(paragraph)).length;
  const long = lines.length - short;
  return { mark: short > long ? "-" : "—", long, short };
}

/** Промпт-требование к знаку реплики: совпадает с author's, а не с привычкой модели. */
export function speechMarkDirective(sample: string): string {
  const { mark, long, short } = authorSpeechMark(sample);
  if (!long && !short) {
    return "РЕПЛИКИ: каждая прямая речь начинается с тире «—». Кавычки-ёлочки не ставить.";
  }
  const example = mark === "-" ? "- Погоди! - сказал Васька." : "— Погоди, — сказал Васька.";
  return `РЕПЛИКИ: каждая прямая речь начинается со знака «${mark}» — так пишет автор `
    + `(в образце ${short} реплик дефисом и ${long} длинным тире). `
    + `Кавычки-ёлочки не ставить. Вид: ${example}`;
}