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

import { LONG_SENTENCE_WORDS } from "./humanStyle";

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

/**
 * Доля кусков детектора, где длинных фраз нет. Главная метрика сборки 115:
 * на отчёте 04.10.2026 — 3 из 8 у HUMAN против 8 из 10 у AI, AUC 0,82,
 * и это единственная из шестнадцати измеренных метрик, которая разделяет
 * классы надёжно. Порог 0,5 взят между классами: на эталоне автора доля 0,22,
 * на главе 4 до покусковой склейки 0,43, после неё 0,14.
 */
export const EMPTY_CHUNK_SHARE_LIMIT = 0.5;

/**
 * Оконные пороги хвоста и восклицаний — по разделителю отчёта 04.10.2026
 * (HUMAN 0,20 хвоста и 11,8 восклицаний против AI 0,08 и 4,1).
 * Стоят МЕЖДУ классами, а не по эталону: в окне детектора колебание нормы
 * слишком велико, чтобы требовать человеческого минимума, но слишком мало,
 * чтобы пропускать 0,08 против 0,20. На эталоне автора оба порога проходят
 * с запасом (0,24 и 13,1), то есть живая проза не пострадает.
 */
export const LONG_TAIL_WINDOW_LIMIT = 0.12;
export const EXCLAMATION_WINDOW_LIMIT = 6;
/**
 * Порог фильтр-слов в окне. Разделитель отчёта — 44,6 (AI) против 14,7
 * (HUMAN), но эталон автора в отдельных окнах даёт до 90: у него «словно» и
 * «как будто» — обычный оборот, и порог ниже нормы ломал бы живую прозу.
 * Поэтому здесь 70: выше эталонного окна, заметно ниже машинного.
 */
export const FILTER_WINDOW_LIMIT = 70;
/**
 * Доля окон, в которых «!» нет ни разу, при которой это уже замечание.
 * Замер отчёта 04.10.2026: 38 % у HUMAN против 60 % у AI; эталон автора 0 %.
 * «Половина окон» попадала в живую прозу и пропускала машину.
 */
export const EXCLAMATION_CALM_SHARE_LIMIT = 0.6;

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
 *
 * Экспортируется для лексической чистки (сборка 120): та ищет не плотность по
 * главе, а конкретные переиспользованные основы («ровн*» 15 раз в главе 4 при
 * одном «ровности» у автора на 38 000 знаков) и разводит их по синонимам
 * наблюдений. Живой прогон 06.10.2026: 131,2 на 10 тыс. слов против 46,3.
 */
export const INTENSIFIER_WORD = new RegExp(
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

/**
 * Прямая мысль героя — «подумал», «решил», «считал».
 *
 * Экспортируется для лексической чистки (сборка 120): та добирает внутреннюю
 * речь, когда её доля по главе ниже пола (живой прогон 06.10.2026 — 2 % против
 * 7 % у автора и у v19, который детектор ставит HUMAN).
 */
export const INTERIOR_MOVE = new RegExp(
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

export interface CalibratedProseBounds {
  bodilyLimit: number;
  filterLimit: number;
  intensifierLimit: number;
  negationMoldLimit: number;
  oneSentenceShareLimit: number;
  interiorShareFloor: number;
  hedgeShareLimit: number;
  verbatimRepeatLimit: number;
  humanBodily: number;
  humanFilter: number;
  humanIntensifier: number;
  humanNegationMold: number;
  humanOneSentenceShare: number;
  humanInteriorShare: number;
  humanHedgeShare: number;
}

/**
 * Динамическая калибровка порогов регистра по образцу автора (`authorSample`).
 * Если образец не передан или слишком короток (< 150 слов), возвращаются
 * базовые константы, откалиброванные на эталоне `Вася.txt`.
 * Если образец передан, пороги адаптируются так, чтобы собственный текст автора
 * гарантированно проходил без замечаний, но превышение его нормы в 1,6–2 раза ловилось.
 */
export function calibrateProseRegisterBounds(authorSample?: string): CalibratedProseBounds {
  const defaults: CalibratedProseBounds = {
    bodilyLimit: BODILY_PER_10K_LIMIT,
    filterLimit: FILTER_PER_10K_LIMIT,
    intensifierLimit: INTENSIFIER_PER_10K_LIMIT,
    negationMoldLimit: NEGATION_MOLD_PER_10K_LIMIT,
    oneSentenceShareLimit: ONE_SENTENCE_SHARE_LIMIT,
    interiorShareFloor: INTERIOR_SHARE_FLOOR,
    hedgeShareLimit: HEDGE_SHARE_LIMIT,
    verbatimRepeatLimit: VERBATIM_REPEAT_PER_10K_LIMIT,
    humanBodily: HUMAN_BODILY_PER_10K,
    humanFilter: HUMAN_FILTER_PER_10K,
    humanIntensifier: HUMAN_INTENSIFIER_PER_10K,
    humanNegationMold: HUMAN_NEGATION_MOLD_PER_10K,
    humanOneSentenceShare: HUMAN_ONE_SENTENCE_PARAGRAPH_SHARE,
    humanInteriorShare: HUMAN_INTERIOR_SHARE,
    humanHedgeShare: HUMAN_HEDGE_SHARE,
  };
  if (!authorSample || typeof authorSample !== "string") return defaults;
  const sampleMetrics = measureProseRegister(authorSample);
  if (sampleMetrics.words < 150) return defaults;

  return {
    bodilyLimit: Math.max(BODILY_PER_10K_LIMIT, Math.round(sampleMetrics.bodilyPer10k * 1.5 + 8)),
    filterLimit: Math.max(FILTER_PER_10K_LIMIT, Math.round(sampleMetrics.filterPer10k * 1.5 + 15)),
    intensifierLimit: Math.max(INTENSIFIER_PER_10K_LIMIT, Math.round(sampleMetrics.intensifierPer10k * 1.5 + 20)),
    negationMoldLimit: Math.max(NEGATION_MOLD_PER_10K_LIMIT, Math.round(sampleMetrics.negationMoldPer10k * 1.6 + 10)),
    oneSentenceShareLimit: sampleMetrics.narrativeParagraphs >= 6
      ? Math.min(ONE_SENTENCE_SHARE_LIMIT, Math.max(0.05, Math.round(sampleMetrics.oneSentenceParagraphShare * 0.4 * 100) / 100))
      : ONE_SENTENCE_SHARE_LIMIT,
    interiorShareFloor: sampleMetrics.narrativeParagraphs >= 6
      ? Math.min(INTERIOR_SHARE_FLOOR, Math.max(0.01, Math.round(sampleMetrics.interiorShare * 0.5 * 1000) / 1000))
      : INTERIOR_SHARE_FLOOR,
    hedgeShareLimit: sampleMetrics.narrativeParagraphs >= 6
      ? Math.max(HEDGE_SHARE_LIMIT, Math.round((sampleMetrics.hedgeShare * 1.5 + 0.04) * 100) / 100)
      : HEDGE_SHARE_LIMIT,
    verbatimRepeatLimit: Math.max(VERBATIM_REPEAT_PER_10K_LIMIT, Math.round(sampleMetrics.verbatimRepeatPer10k * 1.5 + 20)),
    humanBodily: sampleMetrics.bodilyPer10k,
    humanFilter: sampleMetrics.filterPer10k,
    humanIntensifier: sampleMetrics.intensifierPer10k,
    humanNegationMold: sampleMetrics.negationMoldPer10k,
    humanOneSentenceShare: sampleMetrics.oneSentenceParagraphShare || HUMAN_ONE_SENTENCE_PARAGRAPH_SHARE,
    humanInteriorShare: sampleMetrics.interiorShare || HUMAN_INTERIOR_SHARE,
    humanHedgeShare: sampleMetrics.hedgeShare || HUMAN_HEDGE_SHARE,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Фильтр «Слово живое и мёртвое» (Нора Галь): канцелярит, отглагольные
// существительные (-ение/-ание/-ость), цепочки родительного падежа и англицизмы-кальки.
// ─────────────────────────────────────────────────────────────────────────────

/** Цепочка из 3+ существительных в родительном/отглагольном падеже подряд («процесс формирования ощущения безопасности»). */
const NORA_GAL_GENITIVE_CHAIN = new RegExp(
  "(?<![\\p{L}])(?:процесс|уровень|степень|результат|необходимость|возможность|осуществление|формирование|выполнение|обеспечение|состояние|наличие|отсутствие|возникновение|появление|проявление|сохранение|изменение|достижение)\\p{L}*\\s+"
  + "[а-яё]{4,}(?:ия|ения|ания|тия|ости|ести|ства|ации|яции)\\s+"
  + "[а-яё]{4,}(?:ия|ения|ания|тия|ости|ести|ства|ов|ев|ей|ам|ами)(?![\\p{L}])",
  "giu",
);

/** Канцелярские связки с отглагольными существительными вместо живого глагола. */
const NORA_GAL_VERBAL_NOUN_CLUTTER = new RegExp(
  "(?<![\\p{L}])(?:"
  + "(?:прив[её]л[аои]?|приводит|способствовал[аои]?)\\s+к\\s+[а-яё]{4,}(?:ению|анию|тию|ости)"
  + "|(?:осуществля\\p{L}*|производ\\p{L}*|проводил\\p{L}*|выполня\\p{L}*)\\s+[а-яё]{4,}(?:ение|ание|тие|ость|ку)"
  + "|(?:появление|возникновение|формирование|наличие|отсутствие)\\s+(?:ощущения|чувства|мысли|понимания|осознания|необходимости|возможности)"
  + ")(?![\\p{L}])",
  "giu",
);

/** Переводные англицизмы-кальки («took a second to», «looked tired», «made sense», «felt like»). */
const NORA_GAL_TRANSLATION_CALQUES = new RegExp(
  "(?<![\\p{L}])(?:"
  + "взял[аи]?\\s+(?:секунду|минуту|момент|паузу)\\s*,?\\s*чтобы"
  + "|выглядел[аои]?\\s+(?:так,\\s*словно|уставш\\p{L}*|испуганн\\p{L}*|растерянн\\p{L}*|обеспокоенн\\p{L}*|бледн\\p{L}*|странн\\p{L}*)"
  + "|звучал[аои]?\\s+(?:убедительн\\p{L}*|неуверенн\\p{L}*|странн\\p{L}*|знаком\\p{L}*|угрожающ\\p{L}*)"
  + "|почувствовал[аи]?\\s+себя\\s+так,\\s*(?:словно|будто)"
  + "|(?:это\\s+)?имело\\s+смысл"
  + "|сделал[аи]?\\s+мысленн(?:ую|ый)\\s+(?:заметку|пометку)"
  + ")(?![\\p{L}])",
  "giu",
);

export interface NoraGalReport {
  genitiveChains: number;
  verbalNounClutter: number;
  translationCalques: number;
  totalPer10k: number;
  samples: string[];
}

export function measureNoraGal(text: string): NoraGalReport {
  const body = String(text || "");
  const wordCount = Math.max(words(body), 1);
  const collect = (pattern: RegExp): string[] => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return [...body.matchAll(new RegExp(pattern.source, flags))].map((m) => m[0]);
  };
  const chains = collect(NORA_GAL_GENITIVE_CHAIN);
  const clutter = collect(NORA_GAL_VERBAL_NOUN_CLUTTER);
  const calques = collect(NORA_GAL_TRANSLATION_CALQUES);
  const all = [...chains, ...clutter, ...calques];
  const totalPer10k = Math.round(((all.length * 10000) / wordCount) * 10) / 10;
  return {
    genitiveChains: chains.length,
    verbalNounClutter: clutter.length,
    translationCalques: calques.length,
    totalPer10k,
    samples: all.slice(0, 5),
  };
}

export function noraGalIssues(text: string): string[] {
  const report = measureNoraGal(text);
  const issues: string[] = [];
  if (report.genitiveChains > 0 || report.verbalNounClutter > 0) {
    const sampleStr = report.samples.slice(0, 3).map((s) => `«${s}»`).join(", ");
    issues.push(
      `канцелярит и отглагольные существительные по Норе Галь (${report.genitiveChains + report.verbalNounClutter} шт.: ${sampleStr}) — `
      + `разомкни цепочки родительного падежа и замени существительные на «-ение/-ание/-ость» живым глаголом (что кто сделал)`,
    );
  }
  if (report.translationCalques > 0) {
    const sampleStr = report.samples.slice(0, 3).map((s) => `«${s}»`).join(", ");
    issues.push(
      `переводные англицизмы-кальки (${report.translationCalques} шт.: ${sampleStr}) — `
      + `замени кальки («выглядел уставшим», «взял секунду, чтобы», «имело смысл») естественным русским оборотом`,
    );
  }
  return issues;
}

/**
 * Замечания по регистру: строки для промпта и журнала. Каждое замечание называет
 * измеренную величину и эталон — по правилу sepia «no quote — no signal» без
 * цифры замечание не считается.
 */
export function proseRegisterIssues(
  text: string,
  options: { minParagraphs?: number; authorSample?: string } = {},
): string[] {
  const metrics = measureProseRegister(text);
  const bounds = calibrateProseRegisterBounds(options.authorSample);
  const issues: string[] = [];
  if (metrics.words < 120) return issues;
  const minParagraphs = options.minParagraphs ?? 6;

  if (metrics.bodilyPer10k >= bounds.bodilyLimit) {
    issues.push(
      `эмоция дана только телом: телесных реакций ${metrics.bodilyPer10k} на 10 тыс. слов против ${bounds.humanBodily} у человека, `
      + `названных чувств ${metrics.namedEmotionPer10k} — назови чувство словом там, где сейчас только ощущение `
      + `(холодок, дрожь, сжалось внутри), и оставь телесным не больше двух пиков`,
    );
  }
  if (metrics.filterPer10k >= bounds.filterLimit) {
    issues.push(
      `фильтр-слов ${metrics.filterPer10k} на 10 тыс. слов против ${bounds.humanFilter} у человека `
      + `(«словно», «казалось», «вроде», «похоже», «едва») — убери фильтр и покажи предмет или поступок; `
      + `верни простые связки «потому что», «так», «ну», «просто»`,
    );
  }
  if (metrics.intensifierPer10k >= bounds.intensifierLimit) {
    issues.push(
      `давление оценочных прилагательных ${metrics.intensifierPer10k} на 10 тыс. слов `
      + `против ${bounds.humanIntensifier} у человека («идеально», «аккуратно», «необычно», «заметно») — `
      + `замени треть из них конкретным наблюдением: что именно видно и чем это отличается`,
    );
  }
  if (metrics.negationMoldPer10k >= bounds.negationMoldLimit) {
    issues.push(
      `повтор одного отрицательного каркаса «не + глагол»: ${metrics.negationMoldPer10k} на 10 тыс. слов `
      + `против ${bounds.humanNegationMold} у человека — третьему такому месту дай другое действие, `
      + `а не ещё одно молчание`,
    );
  }
  if (metrics.narrativeParagraphs >= minParagraphs) {
    if (metrics.oneSentenceParagraphShare <= bounds.oneSentenceShareLimit && metrics.modalSentenceCountShare >= 0.45) {
      issues.push(
        `форма абзаца однотипна: однофразных абзацев ${Math.round(metrics.oneSentenceParagraphShare * 100)} % `
        + `против ${Math.round(bounds.humanOneSentenceShare * 100)} % у человека, `
        + `у ${Math.round(metrics.modalSentenceCountShare * 100)} % абзацев ровно ${metrics.modalSentenceCount} фразы — `
        + `часть абзацев оставь из одной фразы, часть разбей`,
      );
    }
    if (metrics.interiorShare < bounds.interiorShareFloor) {
      issues.push(
        `нет внутренней речи: мысль героя («подумал», «решил») стоит в `
        + `${Math.round(metrics.interiorShare * 100)} % абзацев против ${Math.round(bounds.humanInteriorShare * 100)} % у человека — `
        + `дай герою одно решение внутри, которое он не озвучивает`,
      );
    }
    if (metrics.hedgeShare >= bounds.hedgeShareLimit) {
      issues.push(
        `избыток оговорок: «может», «вроде», «похоже», «казалось» в `
        + `${Math.round(metrics.hedgeShare * 100)} % абзацев против ${Math.round(bounds.humanHedgeShare * 100)} % у человека — `
        + `убери оговорку там, где автор знает, что происходит`,
      );
    }
  }
  if (metrics.verbatimRepeatPer10k >= bounds.verbatimRepeatLimit && metrics.verbatimSamples.length) {
    issues.push(
      `дословный повтор одного образа: ${metrics.verbatimRepeatPer10k} на 10 тыс. слов `
      + `(«${metrics.verbatimSamples[0]}») — второй раз эта картинка не нужна, дай другое наблюдение`,
    );
  }
  for (const noraIssue of noraGalIssues(text)) {
    issues.push(noraIssue);
  }
  return issues;
}

/** Находки для блока «АРХИТЕКТУРА» и для журнала: то же, что issues, но с баллом. */
export function proseRegisterFindings(text: string, authorSample?: string): ProseRegisterFinding[] {
  const metrics = measureProseRegister(text);
  const bounds = calibrateProseRegisterBounds(authorSample);
  const findings: ProseRegisterFinding[] = [];
  const push = (id: string, label: string, severity: number, advice: string) => {
    if (severity > 0.15) findings.push({ id, label, severity: Math.min(severity, 1), advice });
  };

  if (metrics.bodilyPer10k >= bounds.bodilyLimit) {
    push(
      "emotion-embodied",
      `эмоция только телесная (${metrics.bodilyPer10k} на 10 тыс. слов против ${bounds.humanBodily})`,
      (metrics.bodilyPer10k - bounds.bodilyLimit) / Math.max(bounds.bodilyLimit, 1),
      "назови чувство словом в двух-трёх местах, оставь телесным только пик",
    );
  }
  if (metrics.filterPer10k >= bounds.filterLimit) {
    push(
      "filter-words",
      `фильтр-слов ${metrics.filterPer10k} против ${bounds.humanFilter}`,
      (metrics.filterPer10k - bounds.filterLimit) / Math.max(bounds.filterLimit, 1),
      "убери фильтр, покажи предмет или поступок",
    );
  }
  if (metrics.intensifierPer10k >= bounds.intensifierLimit) {
    push(
      "intensifier-pressure",
      `давление оценочных прилагательных (${metrics.intensifierPer10k} против ${bounds.humanIntensifier})`,
      (metrics.intensifierPer10k - bounds.intensifierLimit) / Math.max(bounds.intensifierLimit, 1),
      "замени оценивание наблюдением",
    );
  }
  if (metrics.negationMoldPer10k >= bounds.negationMoldLimit) {
    push(
      "negation-mold",
      `повтор каркаса «не + глагол» (${metrics.negationMoldPer10k} против ${bounds.humanNegationMold})`,
      (metrics.negationMoldPer10k - bounds.negationMoldLimit) / Math.max(bounds.negationMoldLimit, 1),
      "на третий такой молчаний дай поступок, вопрос или перебивание",
    );
  }
  if (metrics.narrativeParagraphs >= 6) {
    if (metrics.oneSentenceParagraphShare <= bounds.oneSentenceShareLimit && metrics.modalSentenceCountShare >= 0.45) {
      push(
        "uniform-paragraph-shape",
        `однотипная форма абзаца (однофразных ${Math.round(metrics.oneSentenceParagraphShare * 100)} % против ${Math.round(bounds.humanOneSentenceShare * 100)} %)`,
        (0.45 - metrics.oneSentenceParagraphShare) / 0.45,
        "оставь часть абзацев из одной фразы, часть разбей",
      );
    }
    if (metrics.interiorShare < bounds.interiorShareFloor) {
      push(
        "no-interior-voice",
        `нет внутренней речи (${Math.round(metrics.interiorShare * 100)} % абзацев против ${Math.round(bounds.humanInteriorShare * 100)} %)`,
        Math.min(1 - metrics.interiorShare / Math.max(bounds.humanInteriorShare, 0.01), 1),
        "дай герою одно неозвученное решение",
      );
    }
    if (metrics.hedgeShare >= bounds.hedgeShareLimit) {
      push(
        "hedge-overload",
        `избыток оговорок (${Math.round(metrics.hedgeShare * 100)} % абзацев против ${Math.round(bounds.humanHedgeShare * 100)} %)`,
        (metrics.hedgeShare - bounds.hedgeShareLimit) / Math.max(bounds.hedgeShareLimit, 0.01),
        "убери оговорку, где автор знает",
      );
    }
  }
  if (metrics.verbatimRepeatPer10k >= bounds.verbatimRepeatLimit) {
    push(
      "verbatim-image-repeat",
      `образ повторён дословно (${metrics.verbatimSamples[0] || "—"})`,
      (metrics.verbatimRepeatPer10k - bounds.verbatimRepeatLimit) / Math.max(bounds.verbatimRepeatLimit, 1),
      "замени второе вхождение другим наблюдением",
    );
  }
  const nora = measureNoraGal(text);
  if (nora.genitiveChains + nora.verbalNounClutter + nora.translationCalques > 0) {
    push(
      "nora-gal-clutter",
      `канцелярит/кальки по Норе Галь (${nora.totalPer10k} на 10 тыс. слов: ${nora.samples[0] || "—"})`,
      Math.min((nora.genitiveChains + nora.verbalNounClutter + nora.translationCalques) * 0.25, 1),
      "замени отглагольные существительные и переводные кальки живым глаголом",
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
export function proseRegisterSceneIssues(text: string, maxIssues = 2, authorSample?: string): string[] {
  // Минимум замера — общий (120 слов, см. proseRegisterIssues). Отдельный порог
  // для сцены был лишним: он молчал там, где общий замер уже давал верный ответ,
  // и проверка на сцене расходилась с проверкой на собранной главе.
  return proseRegisterIssues(text, { minParagraphs: 4, authorSample }).slice(0, maxIssues);
}


/**
 * Длина окна детектора. Отчёт режет рукопись на куски около 1050 знаков
 * (сегменты в живых прогонах — 963–1146), и внутри такого куска разница между
 * живым и машинным текстом видна, а на главе целиком сглаживается.
 *
 * Прямое измерение на отчёте result_2026-10-04T20-27-50.json (18 сегментов,
 * 8 HUMAN против 10 AI, все измерены одним кодом в один день):
 *
 *   хвост 25+ слов     HUMAN 0,20   AI 0,08   (2,6×)
 *   восклицаний /100   HUMAN 11,8   AI 4,1    (2,9×)
 *   фильтр-слов /10 тыс HUMAN 14,7  AI 44,6   (3,0× в другую сторону)
 *
 * На главе целиком те же метрики давали 17 % / 7,5 / 51 — то есть разница
 * съедалась. Причина одна: восемь из восемнадцати сегментов оказались диалогами,
 * а на главе их доля не видна.
 */
export const DETECTOR_WINDOW_CHARS = 1050;

/**
 * Замечания по окнам детектора. Здесь, в отличие от главы целиком, порог
 * ставится ВЫШЕ человеческого и близко к разделителю: в окне слишком короткого
 * текста колебание нормы огромно, поэтому каждое замечание называет и цифру.
 */
export function proseRegisterWindowIssues(text: string, size = DETECTOR_WINDOW_CHARS): string[] {
  // Сознательно пусто. Оконные замечания по фильтрам и оценочным прилагательным
  // были помещены сюда после отчёта 04.10.2026 и сняты тем же отчётом: в окне
  // детектора эталон автора даёт 178 фильтров на 10 тыс. слов, а наша глава —
  // 114. То есть в окне эта метрика переворачивается: живая проза выглядит
  // «грязнее» машинной. Причина — окно в 1050 знаков это 150 слов, а плотности
  // на 150 словах колеблются в разы; на главе целиком (38 000 знаков) та же
  // метрика различает: 46 против 134.
  //
  // Значит в окно можно стави�� только метрики с AUC выше 0,75, а их по
  // шестнадцати измеренным одна. Всё, что слабее, живёт в главных порогах
  // (proseRegisterIssues) и в отчёте, но в правку по окнам не идёт: иначе
  // приложение переписывает живую прозу по ложным следам.
  void text;
  void size;
  return [];
}

/** Окна той же нарезки, что у детектора: по предложениям, без разрывов абзацев. */
function proseWindows(text: string, size = DETECTOR_WINDOW_CHARS): string[] {
  const windows: string[] = [];
  let buffer = "";
  for (const sentence of sentences(text)) {
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
    if (buffer.length >= size) {
      windows.push(buffer);
      buffer = "";
    }
  }
  if (buffer.trim()) windows.push(buffer.trim());
  return windows;
}

/**
 * Хвост и восклицания по окнам детектора. Отдельная функция от регистра, потому
 * что в окне работает иной порог: из отчёта 04.10.2026 разделителем оказалось
 * не отсутствие длинных фраз вообще, а их нехватка ВНУТРИ куска (0,08 против
 * 0,20). На главе целиком порог 0,15 не срабатывал никогда: 17 % на главе —
 * это 0,17 в среднем, и два-три «богатых» куска перебивали пустые.
 */
export function rhythmWindowIssues(text: string, size = DETECTOR_WINDOW_CHARS): string[] {
  const windows = proseWindows(text, size);
  if (!windows.length) return [];
  const issues: string[] = [];
  const lowTail = windows.filter((window) => {
    const stats = longTailShare(window);
    return stats.total >= 6 && stats.share < LONG_TAIL_WINDOW_LIMIT;
  });
  const emptyShare = lowTail.length / windows.length;
  // Замечание — только при превышении порога. Пороговые 50 % взяты между
  // классами: доля пустых кусков 38 % у HUMAN против 80 % у AI на отчёте
  // 04.10.2026, эталон автора даёт 29 %, наша глава после покусковой склейки 12 %.
  if (emptyShare > EMPTY_CHUNK_SHARE_LIMIT) {
    issues.push(
      `длинных фраз нет в ${lowTail.length} кусках из ${windows.length} (${Math.round(emptyShare * 100)} %) `
      + `— порог ${Math.round(EMPTY_CHUNK_SHARE_LIMIT * 100)} %; по разделителю отчёта 38 % у HUMAN против 80 % у AI, `
      + `и доля пустых кусков 3 из 8 против 8 из 10 (AUC 0,82) — `
      + `собери в них предложение в 25–40 слов: срасти соседние фразы через союз или перенеси часть описания в одну длинную`,
    );
  }
  // Порог по доле окон, а не «половина». Замер отчёта: окон без «!» 38 % у
  // HUMAN против 60 % у AI, а на эталоне автора — 0 %. То есть «половина окон»
  // попадала в живую прозу, а машину пропускала; 0,6 стоит на разделителе.
  const calm = windows.filter((window) => exclamationRate(window) < EXCLAMATION_WINDOW_LIMIT);
  if (calm.length >= windows.length * EXCLAMATION_CALM_SHARE_LIMIT) {
    issues.push(
      `в ${calm.length} кусках из ${windows.length} нет ни одного «!» `
      + `(по разделителю отчёта HUMAN 11,8 на 100 предложений против AI 4,1) — `
      + `пусть персонаж хоть где-то вскрикнёт, окрикнуть или удивится вслух`,
    );
  }
  return issues;
}

/**
 * Доля кусков детектора, где нет ни одного предложения 25+ слов.
 *
 * Это главная метрика сборки 115 и единственная из шестнадцати, измеренных на
 * отчёте детектора, которая разделяет классы надёжно (AUC 0,82): кусков совсем
 * без длинных фраз 3 из 8 у HUMAN против 8 из 10 у AI. Остальные — фильтр-слова
 * (0,73), восклицания (0,71), средняя длина фразы (0,71), оценочные прилагательные
 * (0,70) — разделяют слабо, и ставить их в гейт с жёстким порогом значило бы
 * ронять живую прозу.
 */
export function emptyChunkShare(
  text: string,
  size = DETECTOR_WINDOW_CHARS,
): { share: number; total: number; empty: number } {
  const measured = proseWindows(text, size)
    .filter((chunk) => sentences(chunk).length >= 3)
    .map((chunk) => {
      const lengths = sentences(chunk)
        .filter((sentence) => !/^\s*[—–-]\s/u.test(sentence))
        .map((sentence) => words(sentence))
        .filter((value) => value > 0);
      if (!lengths.length) return -1;
      return lengths.filter((value) => value >= LONG_SENTENCE_WORDS).length / lengths.length;
    })
    .filter((value) => value >= 0);
  if (!measured.length) return { share: 0, total: 0, empty: 0 };
  const empty = measured.filter((value) => value < LONG_TAIL_WINDOW_LIMIT).length;
  return { share: empty / measured.length, total: measured.length, empty };
}

/** Доля фраз 25+ слов в куске (без реплик — как в longTailStats). */
function longTailShare(window: string): { share: number; total: number } {
  const measured = sentences(window)
    .filter((sentence) => !/^[\s]*[—–-]\s/u.test(sentence))
    .map((sentence) => (sentence.match(/[\p{L}\p{N}]+/gu) || []).length)
    .filter((value) => value > 0);
  if (!measured.length) return { share: 0, total: 0 };
  return {
    share: measured.filter((value) => value >= LONG_SENTENCE_WORDS).length / measured.length,
    total: measured.length,
  };
}

/** Восклицаний на 100 предложений. */
function exclamationRate(window: string): number {
  const measured = sentences(window);
  if (measured.length < 6) return EXCLAMATION_WINDOW_LIMIT + 1;
  return (measured.filter((sentence) => sentence.includes("!")).length / measured.length) * 100;
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
  const lines = formBlocks(sample).filter(isSpeechLine);
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

/**
 * Блоки для сверки формы. У живого автора абзац — это строка (`Вася.txt`: 170
 * строк, 8 пустых), поэтому делить только по пустым строкам нельзя: на его же
 * тексте это даёт девять блоков по сотне слов и ложную долю реплик.
 */
function formBlocks(text: string): string[] {
  const source = String(text || "");
  const paragraphs = source.split(/\n{2,}/u).map((block) => block.trim()).filter(Boolean);
  if (paragraphs.length >= 8) return paragraphs;
  const lines = source.split(/\n/u).map((line) => line.trim()).filter(Boolean);
  return lines.length > paragraphs.length ? lines : paragraphs;
}

/** Начинается ли абзац со знака реплики (тире или дефис). */
export function startsWithSpeechMark(paragraph: string): boolean {
  return /^[ \t]*[—–―-]\s/u.test(paragraph);
}

/**
 * Реплики, написанные не тем знаком, каким пишет автор.
 *
 * Зачем. `isMarkedSpeech` (humanStyle.ts) считает тире и дефис одинаково
 * размеченной репликой — для проверки «а размечена ли речь» это верно. Но для
 * проверки «это author's манера» — нет: книга, где автор пишет реплики дефисом
 * (63 реплики дефисом и ноль тире в `Вася.txt`), выходит из конвейера с тире
 * на каждой реплике, и гейт этого не видит. Живой случай 05.10.2026: 54 тире
 * и 0 дефисов в готовой главе против 63 дефисов у автора.
 *
 * Молча сменить знак нельзя — это правка текста, а не метрика, — поэтому
 * расхождение возвращается как замечание и в промпт, и в отчёт.
 */
export function speechMarkMismatch(text: string, sample: string): string {
  const expected = authorSpeechMark(sample);
  // Образца нет или в нём нет реплик: сверять не с чем, и это не брак.
  if (!expected.long && !expected.short) return "";
  const wrongMark = expected.mark === "-" ? "—" : "-";
  const blocks = formBlocks(text);
  const wrong = blocks.filter(
    (block) => startsWithSpeechMark(block) && block.trimStart().startsWith(wrongMark),
  ).length;
  const total = blocks.filter(isSpeechLine).length;
  // Расхождение половины и больше — уже не «манера», а другой знак.
  if (total < 3 || wrong < total * 0.5) return "";
  return `знак реплики не тот, что у автора: ${wrong} реплик с «${wrongMark}» и ${total - wrong} с «${expected.mark}», `
    + `а в образце ${expected.short} дефисом и ${expected.long} тире — пиши реплики со знаком «${expected.mark}»`;
}

export interface AuthorQuotePolicy {
  /** Сколько предложений с «» на 100 предложений в образце автора. */
  quotesPer100Sentences: number;
  /** Допустимы ли кавычки-ёлочки (true, если в образце автора > 1,5 кавычки на 100 предложений). */
  allowQuotes: boolean;
  /** Верхний порог кавычек на окно (~10–12 предложений), после которого выдаётся замечание. */
  windowQuoteLimit: number;
}

/**
 * Определяет политику кавычек «…» по образцу автора.
 * Если у автора кавычек почти нет (≤ 1,5 на 100 предложений, как в `Вася.txt` — 0,7),
 * действует строгий запрет (`windowQuoteLimit = 0`). Если автор активно использует «…»
 * для мыслей, вывесок или названий (> 1,5 на 100 предложений), порог масштабируется под автора.
 */
export function authorQuotePolicy(sample = ""): AuthorQuotePolicy {
  const sents = sentences(String(sample || ""));
  if (sents.length < 10) {
    return { quotesPer100Sentences: 0, allowQuotes: false, windowQuoteLimit: 0 };
  }
  const quoteSents = sents.filter((s) => s.includes("«")).length;
  const rate = Math.round(((quoteSents / sents.length) * 100) * 10) / 10;
  if (rate <= 1.5) {
    return { quotesPer100Sentences: rate, allowQuotes: false, windowQuoteLimit: 0 };
  }
  const windowLimit = Math.max(1, Math.ceil((rate / 100) * 12 * 1.5));
  return {
    quotesPer100Sentences: rate,
    allowQuotes: true,
    windowQuoteLimit: windowLimit,
  };
}

/**
 * Динамическое правило по кавычкам и прямой речи для промптов генерации и доводки.
 * Заменяет жёсткий глобальный бан кавычек там, где автор сам пишет с «…».
 */
export function quotesDirective(sample = ""): string {
  const { mark } = authorSpeechMark(sample);
  const policy = authorQuotePolicy(sample);
  const dashName = mark === "-" ? "дефис «-»" : "длинное тире «—»";
  if (!policy.allowQuotes) {
    return `ПРЯМАЯ РЕЧЬ И КАВЫЧКИ (жёсткое правило):\n`
      + `- Реплики героев оформляй ТОЛЬКО через ${dashName} в начале строки.\n`
      + `- Кавычки «…» и "…" НЕ использовать вообще — ни для реплик, ни для мыслей, ни для названий и табличек.\n`
      + `- Примеры правильного оформления:\n`
      + `  ${mark} Ты слышишь это? ${mark} спросил Илья.\n`
      + `  Надпись на стене гласила: Зал ожидания.`;
  }
  return `ПРЯМАЯ РЕЧЬ И КАВЫЧКИ (по образцу автора):\n`
    + `- Реплики в диалогах оформляй ТОЛЬКО через ${dashName} в начале строки (не в кавычках).\n`
    + `- Кавычки-ёлочки «…» допустимы ТОЛЬКО для названий, вывесок или цитат в той же плотности, что у автора (~${policy.quotesPer100Sentences} на 100 предложений, не более ${policy.windowQuoteLimit} на кусок текста).`;
}