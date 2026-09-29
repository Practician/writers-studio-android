/** Приёмы sepia на ГЛАВУ, а не на каждую сцену.
 *
 *  Правило sepia (README, «Governing principle»): «Select, don't accumulate — 3–5 moves
 *  per story; a story with every rule applied is a new fingerprint». До этой правки
 *  (29.09.2026) каталог из 8 сценических приёмов подшивался в КАЖДЫЙ промпт сцены
 *  (chapterGenerate.ts, SCENE_SEPIA_MOVES) и в каждой сцене модель выбирала свои 3–5:
 *  на главе из 10 сцен это 30–50 применений — полный набор, который сам по себе читается
 *  как шаблон. Внешний детектор по главе 4 (result_2026-09-29T11-06-30.json) дал 22
 *  сегмента из 22 «AI» при локальном счёте 17 — перекоррекция ровно тот провал, который
 *  sepia предупреждает отдельной строкой rubric.md («over-correction advisory»).
 *
 *  Здесь приёмы выбираются один раз на главу (3–5 + один редкий) и раскладываются по
 *  сценам так, чтобы большинство сцен осталось БЕЗ приёмов: это и есть «leave slack». */

export type SepiaMoveLayer = "scene" | "architecture" | "rarity";

export interface SepiaMove {
  id: string;
  layer: SepiaMoveLayer;
  text: string;
}

/** Сценические приёмы — тот же список, что раньше уходил в каждую сцену целиком. */
export const SCENE_MOVE_CATALOG: SepiaMove[] = [
  { id: "scene:meaning", layer: "scene", text: "Не объясняй смысл сцены: ни от рассказчика, ни в финальной фразе. Смысл собирается из поступков." },
  { id: "scene:causal-gap", layer: "scene", text: "Не выстраивай цепочку «причина → следствие → вывод» без зазоров. Одну деталь оставь необъяснённой, одно следствие — незакрытым." },
  { id: "scene:backloaded", layer: "scene", text: "Часть сведений давай с опозданием: сначала предмет или жест, потом — что он значил. Не объявляй заранее, к чему идёт разговор." },
  { id: "scene:emotion", layer: "scene", text: "Эмоцию показывай поступком, оговоркой, неверным словом. Телесная реакция (холодок, ком в горле, сердце пропустило) — не единственный способ и не чаще одного раза на сцену." },
  { id: "scene:concrete", layer: "scene", text: "Называй конкретные вещи мира: марку, номер, место, цену, бытовую деталь. Абстракции («атмосфера», «энергия», «пространство») запрещены." },
  { id: "scene:cast", layer: "scene", text: "Новых людей и сущностей — не больше одного на сцену. Не заставляй переглядываться тех, кого в сцене нет." },
  { id: "scene:time-skip", layer: "scene", text: "Время линейно, но с пропусками: перескочи через рутину между двумя точками, а не перечисляй её." },
  { id: "scene:no-closure", layer: "scene", text: "Не заканчивай сцену разрешением и принятием. Закончи на действии, которое ставит следующий вопрос и оставляет героя в неудобном положении." },
];

/** Архитектурные приёмы главы: раньше выдавались по три на сцену со сдвигом, то есть
 *  все девять вращались по всей главе и в итоге применялись все. */
export const ARCHITECTURE_MOVE_CATALOG: SepiaMove[] = [
  { id: "arch:theme", layer: "architecture", text: "Тема: не проговаривай мораль — ни рассказчиком, ни финальным диалогом-рассуждением." },
  { id: "arch:loose-threads", layer: "architecture", text: "Не давай всем нитям сойтись: одну деталь оставь без разрешения, одно следствие — незакрытым." },
  { id: "arch:link-variety", layer: "architecture", text: "Не веди абзацы одной цепочкой «что случилось → почему → что вышло»: одно место сцепи сравнением (тот же эпизод или человек в другой раз) либо возражением — кто-то не согласен с предыдущим абзацем." },
  { id: "arch:texture", layer: "architecture", text: "Меняй текстуру соседних сцен: плотная сцена — потом короткая и быстрая; насыщенный диалог — потом сжатое изложение. Одну интонацию на всю главу не держи." },
  { id: "arch:named", layer: "architecture", text: "Упомяни что-то по-настоящему конкретное и существующее: книгу, песню, марку, место, бытовую мелочь этого мира." },
  { id: "arch:intro-by-voice", layer: "architecture", text: "Нового важного человека вводи репликой или поступком, а не описанием внешности." },
  { id: "arch:resolution", layer: "architecture", text: "Не своди развязку к «герой сам выбрал → принял случившееся → вырос»: часть решений отдай случаю, другим людям или обстоятельствам." },
  { id: "arch:verdict", layer: "architecture", text: "Не выноси герою однозначного вердикта — ни хвалы, ни осуждения: амбивалентность ближе к человеческому письму." },
  { id: "arch:relations", layer: "architecture", text: "Между знакомыми не всё в порядке: сеть отношений не должна быть плотной и равномерно тёплой — кто-то не знаком, кто-то в ссоре." },
];

/** Редкий приём (sepia: «3–5 human-leaning moves + ONE rarity move») — применяется
 *  на главу один раз. Каждый пункт помечен так, как sepia требует от конкретики:
 *  выдуманная деталь хуже отсутствия (hard guardrail «Never invent specifics»). */
export const RARITY_MOVE_CATALOG: SepiaMove[] = [
  { id: "rarity:intertext", layer: "rarity", text: "Один раз назови по-настоящему существующую вещь культуры — книгу, песню, фильм, имя автора. Только то, что действительно существует и укладывается в время действия." },
  { id: "rarity:aside", layer: "rarity", text: "Один раз допусти лёгкое подмигивание — отступление в сторону формы или читателя. Один раз на главу, не системно." },
  { id: "rarity:offbeat", layer: "rarity", text: "Одна бытовая деталь, которая ничего не значит для сюжета и остаётся без объяснения: пусть глава содержит то, что просто наблюдал автор." },
  { id: "rarity:timejump", layer: "rarity", text: "Один раз сдвинь время внутри сцены: открой её из середины или уже с исходом, а причину — потом." },
];

export const SEPIA_MOVE_CATALOG: SepiaMove[] = [
  ...SCENE_MOVE_CATALOG,
  ...ARCHITECTURE_MOVE_CATALOG,
  ...RARITY_MOVE_CATALOG,
];

const CATALOG_BY_ID = new Map(SEPIA_MOVE_CATALOG.map((move) => [move.id, move]));

export function sepiaMoveById(id: string): SepiaMove | undefined {
  return CATALOG_BY_ID.get(String(id || "").trim());
}

/** Приём, выбранный на главу и назначенный конкретной сцене. */
export interface PlannedMove {
  id: string;
  text: string;
  layer: SepiaMoveLayer;
  scene: number;
}

export interface ChapterMovePlan {
  /** Откуда взялся выбор: «seed» — детерминированный бросок, «beat-plan» — модель. */
  source: "seed" | "beat-plan";
  /** Все приёмы главы: 3–5 обычных + один редкий. */
  moves: PlannedMove[];
  /** Номер сцены (с нуля) → id приёмов, назначенных этой сцене. */
  scenes: Record<number, string[]>;
  /** Сцены, которым ничего не назначено: их авторство — «leave slack». */
  quietScenes: number[];
  beatCount: number;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Сколько обычных приёмов берётся на главу: 3–5, как в sepia. */
export function chapterMoveCount(seed: string): number {
  return 3 + (fnv1a(seed) % 3);
}

/** Сцены под приёмы разносим по главе, а не набираем подряд: скопившаяся в начале
 *  группа приёмов оставляет второй половине главы ровно тот шаблон, от которого мы уходим. */
function spreadScenes(beatCount: number, count: number, random: () => number): number[] {
  const safeCount = Math.max(0, Math.min(count, beatCount));
  if (!safeCount) return [];
  const cells: number[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    const start = Math.floor((i * beatCount) / safeCount);
    const end = Math.floor(((i + 1) * beatCount) / safeCount);
    const span = Math.max(1, end - start);
    cells.push(start + Math.floor(random() * span));
  }
  const picked = [...new Set(cells)];
  // Редкая коллизия соседних ячеек (маленькая глава) — добираем свободные сцены.
  for (let scene = 0; picked.length < safeCount && scene < beatCount; scene += 1) {
    if (!picked.includes(scene)) picked.push(scene);
  }
  return picked.sort((a, b) => a - b);
}

export interface BuildChapterMovePlanOptions {
  beatCount: number;
  /** Одинаковый seed на всех кандидатах главы: варианты черновика сравниваются
   *  при одних и тех же приёмах, а не при случайно разных наборах. */
  seed: string;
  /** id, выбранные моделью в плане битов; невалидные отбрасываются. */
  requested?: string[];
}

export function buildChapterMovePlan(options: BuildChapterMovePlanOptions): ChapterMovePlan {
  const beatCount = Math.max(1, options.beatCount);
  const random = mulberry32(fnv1a(options.seed));
  const wanted = Math.min(chapterMoveCount(options.seed), beatCount);

  const requested = [...new Set((options.requested || []).map((id) => String(id).trim()))]
    .filter((id) => {
      const move = sepiaMoveById(id);
      return Boolean(move) && move.layer !== "rarity";
    })
    .slice(0, 5);
  const source: ChapterMovePlan["source"] = requested.length >= 3 ? "beat-plan" : "seed";

  let ordinary: SepiaMove[];
  if (requested.length >= 3) {
    ordinary = requested.map((id) => sepiaMoveById(id)!);
  } else {
    // Смешиваем слои: только сценические приёмы не чинят архитектуру главы,
    // только архитектурные — не чинят быт сцены.
    const archWanted = Math.ceil(wanted / 2);
    const archPool = shuffled(ARCHITECTURE_MOVE_CATALOG, random).slice(0, archWanted);
    const scenePool = shuffled(SCENE_MOVE_CATALOG, random).slice(0, wanted - archPool.length);
    ordinary = shuffled([...archPool, ...scenePool], random);
  }

  const rarity = shuffled(RARITY_MOVE_CATALOG, random)[0];
  const scenes = spreadScenes(beatCount, ordinary.length + 1, random);
  const moves: PlannedMove[] = ordinary.map((move, index) => ({
    id: move.id,
    text: move.text,
    layer: move.layer,
    scene: scenes[index],
  }));
  const rarityScene = scenes[ordinary.length];
  if (rarity && rarityScene !== undefined) {
    moves.push({ id: rarity.id, text: rarity.text, layer: rarity.layer, scene: rarityScene });
  }

  const assignment: Record<number, string[]> = {};
  for (const move of moves) {
    if (!assignment[move.scene]) assignment[move.scene] = [];
    assignment[move.scene].push(move.id);
  }
  const quietScenes: number[] = [];
  for (let scene = 0; scene < beatCount; scene += 1) {
    if (!assignment[scene]) quietScenes.push(scene);
  }
  return { source, moves, scenes: assignment, quietScenes, beatCount };
}

/** Блок промпта для одной сцены: только назначенные ей приёмы. Пустое назначение —
 *  тоже инструкция («оставь как есть»), иначе модель дотянет каталог сама.
 *  Номер бита приводится к границам главы: в сценовом конвейере к индексу прибавлен
 *  номер кандидата, и без сведения модуля варианты смотрели бы мимо плана. */
function sceneIndexOf(plan: ChapterMovePlan, beatIndex: number): number {
  const count = Math.max(1, plan.beatCount);
  return ((beatIndex % count) + count) % count;
}

export function sceneMoveBlock(plan: ChapterMovePlan | undefined, beatIndex: number, beatCount: number): string {
  if (!plan) return "";
  const scene = sceneIndexOf(plan, beatIndex);
  const ids = plan.scenes[scene] || [];
  const total = beatCount || plan.beatCount;
  const head = `ПРИЁМЫ ЭТОЙ СЦЕНЫ (глава выбрала ${plan.moves.length} приёма на ${total} сцен — остальные сцены идут без приёмов):`;
  if (!ids.length) {
    return `${head}
- Приёмов не назначено. Не применяй ни один пункт из списка приёмов главы: обычная сцена, живи событием и речью.
- Правило «выбери 3–5 приёмов» здесь не действует: полный набор на каждой сцене сам по себе читается как шаблон.`;
  }
  const lines = ids
    .map((id) => sepiaMoveById(id))
    .filter((move): move is SepiaMove => Boolean(move))
    .map((move) => `- ${move.text}`);
  return `${head}
${lines.join("\n")}
- Только эти пункты. Остальные приёмы главы к этой сцене не относятся — не тяни их из памяти.`;
}

/** Архитектурная часть плана для сцены. Без плана — прежнее поведение (тройка со сдвигом),
 *  чтобы старые вызовы и тесты не менялись. */
export function architectureMovesBlock(plan: ChapterMovePlan | undefined, beatIndex: number): string {
  if (!plan) return "";
  const ids = (plan.scenes[sceneIndexOf(plan, beatIndex)] || []).filter((id) => sepiaMoveById(id)?.layer === "architecture");
  if (!ids.length) return "";
  const lines = ids.map((id) => `- ${sepiaMoveById(id)!.text}`);
  return `АРХИТЕКТУРА ГЛАВЫ (только это, остальные пункты чек-листа к куску не относятся):
${lines.join("\n")}`;
}

/** Строка для отчёта и журнала: сколько приёмов выбрано и сколько сцен осталось slack. */
export function movePlanSummary(plan: ChapterMovePlan): string {
  const quiet = plan.quietScenes.length;
  return `приёмы главы: ${plan.moves.length} (источник: ${plan.source === "beat-plan" ? "план битов" : "выбор по seed"}), `
    + `сцен с приёмами ${plan.beatCount - quiet}/${plan.beatCount}, без приёмов ${quiet}`;
}

/** Каталог с id — уходит в промпт плана битов, чтобы модель могла выбрать приёмы
 *  под синопсис этой главы (sepia: «chosen for the premise»). */
export function moveCatalogPrompt(): string {
  return SEPIA_MOVE_CATALOG.map((move) => `- ${move.id} [${move.layer}] ${move.text}`).join("\n");
}

/** Что модель должна вернуть в плане битов: id обычных приёмов (без rarity —
 *  редкий приём по канону sepia выбирается один раз и расставляется нами). */
export function requestedMovesFromPlan(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : "")).filter(Boolean);
}
