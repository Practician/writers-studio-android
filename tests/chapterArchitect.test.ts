import { strict as assert } from "node:assert";
import test from "node:test";
import {
  ARCHITECTURE_DECISIONS_IN_PROMPT,
  ARCHITECTURE_FIELDS,
  RARITY_MOVES,
  architecturePlannerPrompt,
  architectureSheetBlock,
  architectureSheetCompleteness,
  architectureSheetNote,
  parseArchitectureSheet,
} from "../server/chapterArchitect";
import { buildChapterMovePlan } from "../server/sepiaMoves";

// ── Лист архитектуры ──────────────────────────────────────────────────────────

test("в листе двенадцать полей, и каждое с человеческой целью", () => {
  assert.equal(ARCHITECTURE_FIELDS.length, 12, "лист sepia — двенадцать решений");
  for (const field of ARCHITECTURE_FIELDS) {
    assert.ok(field.choices.length >= 3, `${field.id}: нужно минимум три варианта выбора`);
    // Каждое поле защищается измеренным разрывом, а не вкусом: без числа
    // выбор нечем обосновать и агент начинает фантазировать.
    assert.ok(/\d/.test(field.why), `${field.id}: в обосновании нет измеренной величины`);
  }
});

test("лист принимает только варианты из списка: выдумка не проходит", () => {
  const theme = ARCHITECTURE_FIELDS.find((field) => field.id === "theme")!;
  const valid = parseArchitectureSheet({ theme: theme.choices[0] });
  assert.ok(valid.theme, "вариант из списка принят");
  assert.equal(parseArchitectureSheet({ theme: "поговорить с драконом" }).theme, undefined,
    "изобретение модели отброшено");
});

test("пустой или мусорный ответ даёт пустой лист, а не частичный выдум", () => {
  assert.deepEqual(parseArchitectureSheet(undefined), {});
  assert.deepEqual(parseArchitectureSheet("не json"), {});
  assert.deepEqual(parseArchitectureSheet({ nonsense: 42 }), {});
  assert.equal(architectureSheetCompleteness({}), 0);
});

test("в промпт сцены уходит 3–5 решений, а не весь лист", () => {
  const sheet: Record<string, string> = {};
  for (const field of ARCHITECTURE_FIELDS) sheet[field.id] = field.choices[0];
  const block = architectureSheetBlock(sheet);
  const lines = block.split("\n")
    .filter((line) => line.startsWith("- ") && ARCHITECTURE_FIELDS.some((field) => line.startsWith(`- ${field.label}:`)));
  assert.ok(lines.length <= ARCHITECTURE_DECISIONS_IN_PROMPT,
    `решений в промпте ${lines.length} — sepia требует 3–5, иначе это новый отпечаток`);
  assert.ok(lines.length >= 3, `решений ${lines.length} — минимум три`);
  assert.ok(lines.length < Object.keys(sheet).length, "лист в промпт попал не целиком");
  assert.ok(block.toLowerCase().includes("остальные решения листа к этой сцене не относятся"),
    "модели сказано не вытаскивать прочие решения из памяти");
});

test("журнал показывает, чем заполнен лист, и один редкий приём", () => {
  const sheet = parseArchitectureSheet({ theme: ARCHITECTURE_FIELDS[0].choices[1], subplot: ARCHITECTURE_FIELDS[1].choices[1] });
  const note = architectureSheetNote(sheet, "rarity:frame");
  assert.ok(/\d/.test(note), "в строке есть процент заполнения");
  assert.ok(note.includes("тема"), "названо принятое решение");
  assert.ok(note.includes("редкий приём"), "назван редкий приём");
  assert.ok(architectureSheetNote({}, "").includes("не выбран"), "пустой лист говорит и об этом");
});

// ── Промпт агента ────────────────────────────────────────────────────────────

test("промпт агента содержит план битов, поля с разрывами и запрет на рассуждения", () => {
  const prompt = architecturePlannerPrompt({
    title: "Вейпер Вася",
    chapterTitle: "Ночь у чужого входа",
    chapterSummary: "Братья находят в пещере чужую технику.",
    beats: ["Срез камня", "Пластины", "Сфера"],
    genre: "приключенческий роман",
    authorSample: "Васька хмыкнул и полез в карман.",
  });
  assert.ok(prompt.includes("Срез камня"), "план битов в промпте");
  assert.ok(prompt.includes("Ночь у чужого входа"), "название главы");
  assert.ok(prompt.includes("не писать текст"), "агент не пишет прозу");
  assert.ok(prompt.includes("ТОЛЬКО JSON"), "требуется машинно-читаемый ответ");
  for (const field of ARCHITECTURE_FIELDS) assert.ok(prompt.includes(field.id), `нет поля ${field.id}`);
});

// ── Редкий приём: агент важнее seed ──────────────────────────────────────────

test("редкий приём выбирает агент, seed используется только как запасной", () => {
  const seed = "Книга|Глава|Синопсис|Жанр";
  const planned = buildChapterMovePlan({ beatCount: 8, seed, requestedRarity: "rarity:offbeat" });
  assert.equal(planned.rarity, "rarity:offbeat", "приём агента применён");
  assert.ok(planned.moves.some((move) => move.id === "rarity:offbeat"), "приём попал в список главы");

  const fallthrough = buildChapterMovePlan({ beatCount: 8, seed });
  assert.ok(fallthrough.rarity.startsWith("rarity:"), "без агента остаётся seed-выбор");
  assert.notEqual(fallthrough.rarity, "", "seed всегда даёт приём");
});

test("агент не может назначить приём, которого нет в каталоге", () => {
  const planned = buildChapterMovePlan({ beatCount: 8, seed: "x", requestedRarity: "rarity:выдумано" });
  assert.notEqual(planned.rarity, "rarity:выдумано", "выдумка отброшена");
  assert.ok(planned.rarity.startsWith("rarity:"), "взяты настоящие приёмы");
});

test("редких приёмов на главу ровно один — правило sepia", () => {
  const planned = buildChapterMovePlan({ beatCount: 10, seed: "тест", requestedRarity: "rarity:reader" });
  const rarities = planned.moves.filter((move) => move.layer === "rarity");
  assert.equal(rarities.length, 1, `редких приёмов ${rarities.length}`);
});

test("каталог агента и каталог приёмов не противоречат друг другу", () => {
  for (const move of RARITY_MOVES) {
    assert.ok(move.text.length > 20, `приём ${move.id} описан одним словом`);
  }
  // Редкие приёмы агента лежат в общем каталоге: иначе блок промпта и план
  // главы будут говорить о разных вещах.
  for (const move of RARITY_MOVES) {
    assert.ok(/^rarity:[a-z]+$/u.test(move.id), `неожиданный id ${move.id}`);
  }
});