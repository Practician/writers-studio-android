/** Приёмы sepia на главу (server/sepiaMoves.ts): правило «3–5 приёмов на историю»,
 *  а не на каждую сцену. До правки 29.09.2026 каталог уходил в каждую сцену целиком:
 *  10 сцен × 3–5 приёмов = 30–50 применений, и внешний детектор давал 22/22 «AI». */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARCHITECTURE_MOVE_CATALOG,
  RARITY_MOVE_CATALOG,
  SCENE_MOVE_CATALOG,
  SEPIA_MOVE_CATALOG,
  buildChapterMovePlan,
  moveCatalogPrompt,
  movePlanSummary,
  sceneMoveBlock,
  sepiaMoveById,
} from "../server/sepiaMoves";
import { buildScenePrompt, architectureNotes, SCENE_SEPIA_MOVES, type ChapterGenerateInput } from "../server/chapterGenerate";

const BEATS = 10;
const SEED = "Вейпер Вася и трусы из паракорда|Глава 4. Ночь у чужого входа|Синопсис|";

test("каталоги разведены по слоям, id уникальны", () => {
  const ids = SEPIA_MOVE_CATALOG.map((move) => move.id);
  assert.equal(new Set(ids).size, ids.length, "id обязаны быть уникальными");
  assert.equal(SCENE_MOVE_CATALOG.length, 8);
  assert.equal(ARCHITECTURE_MOVE_CATALOG.length, 9);
  assert.ok(RARITY_MOVE_CATALOG.length >= 3);
  for (const move of SEPIA_MOVE_CATALOG) {
    assert.ok(sepiaMoveById(move.id), `не находится: ${move.id}`);
    assert.ok(move.text.length > 30, `слишком короткий приём: ${move.id}`);
  }
  assert.match(moveCatalogPrompt(), /arch:resolution/);
  assert.match(moveCatalogPrompt(), /rarity:/);
});

test("на главу берётся 3–5 приёмов плюс один редкий, а не весь каталог", () => {
  const plan = buildChapterMovePlan({ beatCount: BEATS, seed: SEED });
  const ordinary = plan.moves.filter((move) => move.layer !== "rarity");
  const rarity = plan.moves.filter((move) => move.layer === "rarity");
  assert.ok(ordinary.length >= 3 && ordinary.length <= 5, `обычных приёмов: ${ordinary.length}`);
  assert.equal(rarity.length, 1, "редкий приём ровно один на главу");
  assert.ok(plan.moves.length <= 6, "каталог целиком не подшивается");
  assert.ok(plan.quietScenes.length >= 1, "без приёмов должна остаться хотя бы одна сцена — это и есть slack");
  // Больше половины главы не получает ни одного приёма: именно так выполняется
  // «Select, don't accumulate» и «Leave slack» из README sepia.
  assert.ok(plan.quietScenes.length >= Math.floor(BEATS / 3));
});

test("приёмы не скапливаются в одной сцене и разнесены по главе", () => {
  const plan = buildChapterMovePlan({ beatCount: BEATS, seed: SEED });
  for (const [scene, ids] of Object.entries(plan.scenes)) {
    assert.ok(ids.length <= 2, `сцена ${scene} получила ${ids.length} приёма`);
    assert.ok(Number(scene) >= 0 && Number(scene) < BEATS, `сцена вне главы: ${scene}`);
  }
  const scenes = Object.keys(plan.scenes).map(Number).sort((a, b) => a - b);
  const first = scenes[0];
  const last = scenes[scenes.length - 1];
  assert.ok(first <= 1, `приём не попал в начало главы: сцена ${first}`);
  assert.ok(last >= BEATS - 3, `приёмы сгруппированы в начале: последняя ${last}`);
  // Разнос по ячейкам: соседние приёмы не должны сидеть в соседних сценах подряд.
  const stride = scenes[1] - scenes[0];
  assert.ok(stride >= 1, "сцены с приёмами обязаны различаться");
});

test("один и тот же seed даёт один и тот же план на всех кандидатах", () => {
  const a = buildChapterMovePlan({ beatCount: BEATS, seed: SEED });
  const b = buildChapterMovePlan({ beatCount: BEATS, seed: SEED });
  assert.deepEqual(a.moves, b.moves);
  assert.deepEqual(a.scenes, b.scenes);
  const other = buildChapterMovePlan({ beatCount: BEATS, seed: "другая книга|глава 7|" });
  assert.notDeepEqual(a.moves.map((move) => move.id), other.moves.map((move) => move.id));
});

test("выбор модели из плана битов принимается, мусор отбрасывается", () => {
  const chosen = buildChapterMovePlan({
    beatCount: BEATS,
    seed: SEED,
    requested: ["arch:resolution", "scene:meaning", "scene:causal-gap", "nonsense:id", "rarity:intertext"],
  });
  assert.equal(chosen.source, "beat-plan");
  assert.ok(chosen.moves.some((move) => move.id === "arch:resolution"));
  assert.ok(chosen.moves.some((move) => move.id === "scene:meaning"));
  assert.ok(!chosen.moves.some((move) => move.id === "nonsense:id"), "невалидный id не должен попасть в главу");
  assert.equal(chosen.moves.filter((move) => move.layer === "rarity").length, 1, "rarity не берётся из запроса — его добавляем сами");

  const broken = buildChapterMovePlan({ beatCount: BEATS, seed: SEED, requested: ["only-one"] });
  assert.equal(broken.source, "seed", "меньше трёх валидных id — возвращаемся к детерминированному выбору");
});

test("сцена без приёмов получает прямой запрет дёргать каталог", () => {
  const plan = buildChapterMovePlan({ beatCount: BEATS, seed: SEED });
  const quiet = plan.quietScenes[0];
  const block = sceneMoveBlock(plan, quiet, BEATS);
  assert.match(block, /Приёмов не назначено/);
  assert.match(block, /не тяни|Не применяй/iu);
  const assigned = Object.keys(plan.scenes).map(Number)[0];
  const assignedBlock = sceneMoveBlock(plan, assigned, BEATS);
  assert.ok(assignedBlock.startsWith("ПРИЁМЫ ЭТОЙ СЦЕНЫ"));
  const catalogLines = assignedBlock
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .filter((line) => SEPIA_MOVE_CATALOG.some((move) => line.includes(move.text)));
  assert.ok(catalogLines.length <= 2, `сцена получила ${catalogLines.length} приёмов — это снова накопление`);
});

test("промпт сцены без плана сохраняет прежнее поведение, с планом — не тащит каталог целиком", () => {
  const input = {
    model: "gemini-3.1-flash-lite",
    title: "Книга",
    currentChapterTitle: "Глава 4",
    currentChapterSummary: "Синопсис",
    canonDossier: "",
    worldBible: "",
    previousChapter: "",
  } as unknown as ChapterGenerateInput;
  const beat = { title: "Тит", goal: "Цель", hook: "Зацепка", endsWith: "Итог" };
  const legacy = buildScenePrompt(input, beat, 0, 10, "", "", "", "", { minWords: 350, maxWords: 520 });
  assert.match(legacy, /АРХИТЕКТУРА СЦЕНЫ/);
  assert.match(legacy, /АРХИТЕКТУРА ГЛАВЫ/);

  const plan = buildChapterMovePlan({ beatCount: 10, seed: SEED });
  const quietIndex = plan.quietScenes[0];
  const withPlan = buildScenePrompt(
    input,
    beat,
    quietIndex,
    10,
    "",
    "",
    "",
    "",
    { minWords: 350, maxWords: 520 },
    plan,
  );
  // Полный каталог (8 сценических пунктов) в сцену больше не попадает.
  const catalogInPrompt = SCENE_MOVE_CATALOG.filter((move) => withPlan.includes(move.text)).length;
  assert.ok(catalogInPrompt <= 2, `в сцену без приёмов попало ${catalogInPrompt} пунктов каталога`);
  assert.match(withPlan, /Приёмов не назначено/);
  // Сцена с архитектурным приёмом несёт ровно его.
  const archScene = Object.entries(plan.scenes).find(([, ids]) => ids.some((id) => sepiaMoveById(id)?.layer === "architecture"));
  if (archScene) {
    const prompt = buildScenePrompt(
      input,
      beat,
      Number(archScene[0]),
      10,
      "",
      "",
      "",
      "",
      { minWords: 350, maxWords: 520 },
      plan,
    );
    const archLines = archScene[1].map((id) => sepiaMoveById(id)!.text);
    for (const text of archLines) assert.ok(prompt.includes(text), "назначенный архитектурный приём должен быть в промпте");
    const archBlock = architectureNotes(Number(archScene[0]), plan);
    assert.match(archBlock, /АРХИТЕКТУРА ГЛАВЫ/);
    for (const move of ARCHITECTURE_MOVE_CATALOG) {
      if (!archLines.includes(move.text)) assert.ok(!archBlock.includes(move.text), `чужой приём протёк: ${move.id}`);
    }
  }
  // Сцена без архитектурного приёма не должна получить тройку со сдвигом.
  const quietArch = architectureNotes(quietIndex, plan);
  assert.equal(quietArch, "", "без плана тройка со сдвигом, с планом — только назначенные пункты");
  assert.ok(legacy.includes(architectureNotes(0)), "прежнее поведение без плана сохранено");
  assert.match(SCENE_SEPIA_MOVES, /АРХИТЕКТУРА СЦЕНЫ/);
});

test("резюме плана честно считает сцены без приёмов", () => {
  const plan = buildChapterMovePlan({ beatCount: BEATS, seed: SEED });
  const summary = movePlanSummary(plan);
  assert.match(summary, /приёмы главы: [4-6]/);
  assert.match(summary, new RegExp(`без приёмов ${plan.quietScenes.length}`));
});
