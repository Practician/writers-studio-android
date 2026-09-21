import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceContinuityState,
  buildContinuityNotes,
  buildLedgerNotes,
  buildReactionNotes,
  buildScenePrompt,
  buildSeamNotes,
  closingSentences,
  continuityIssue,
  countSimiles,
  countWordsRu,
  eventClassesIn,
  eventEchoIssue,
  explanationTailIssue,
  freezeIssue,
  MAX_FREEZE_REACTIONS,
  MAX_SILENT_REACTIONS,
  sceneLengthBand,
  seamEchoIssue,
  silenceIssue,
  simileIssue,
  type SceneContinuityState,
  type ChapterBeat,
  type ChapterGenerateInput,
  type ScenePlan,
} from "../server/chapterGenerate";

// Проверки взяты из живой главы 20.09.2026 (3671 слово): 24 сравнения, объясняющий
// финал почти каждой сцены, дубль события с плитой, 12 «застыл», 7 молчаний.
const input = {
  title: "Лабиринт",
  genre: "триллер",
  currentChapterTitle: "Глава 4",
  currentChapterSummary: "Герои ищут выход из пещеры.",
} as unknown as ChapterGenerateInput;

const beat: ChapterBeat = {
  title: "Плита",
  goal: "Выход перекрыт",
  hook: "герметичная плита",
  endsWith: "герои остаются в темноте",
};

test("объясняющий финал сцены ловится, действие — нет", () => {
  const explained = "Илья толкнул створку.\n\nСитуация становилась странной, и это спокойствие механизма пугало больше, чем шум падающих плит.";
  assert.notEqual(explanationTailIssue(explained), "");
  const concluded = "Он шагнул в проём.\n\nнаконец осознав, что будка оказалась ловушкой";
  assert.notEqual(explanationTailIssue(concluded), "");
  const abstract = "Васька поднял фонарь.\n\nСамозалечивающийся материал.";
  assert.notEqual(explanationTailIssue(abstract), "");
  const action = "Васька поднял фонарь и посветил в щель.";
  assert.equal(explanationTailIssue(action), "");
});

test("потолок сравнений: больше двух на сцену — нарушение", () => {
  const three = `Он поднял руку, словно пробуя воздух. Стена холодная, будто лёд. `
    + `Провод висел, как будто его сорвали. ${"Он смотрел на щиток и считал шаги. ".repeat(20)}`;
  assert.equal(countSimiles(three), 3);
  assert.notEqual(simileIssue(three), "");
  const two = "Стена холодная, будто лёд. Провод висел, словно его сорвали. Он смотрел на щиток.";
  assert.equal(simileIssue(two), "");
});

test("шов сцен: переигровка концовки предыдущей сцены ловится", () => {
  const scene = `${"Плита была холодной. ".repeat(20)}`
    + `Илья резко развернулся, выставил шест перед собой и шагнул в темноту проёма, ожидая удара.`;
  assert.notEqual(seamEchoIssue([scene], "Илья резко развернулся, выставил шест перед собой и шагнул в темноту проёма, задержав дыхание."), "");
  assert.equal(seamEchoIssue([scene], "Плита под ладонью нагрелась до обжигающего, и он отдёрнул руку."), "");
  assert.match(buildSeamNotes([scene]), /ШОВ СЦЕН/);
  assert.equal(buildSeamNotes([]), "");
});

test("дубль события: закрытие того же класса ловится", () => {
  const second = "Они подошли к краю. Выход из пещеры оказался заблокирован герметичной плитой.";
  assert.deepEqual(eventClassesIn(second), ["blocked"]);
  assert.notEqual(eventEchoIssue(["blocked"], second), "");
  assert.equal(eventEchoIssue([], second), "");
  assert.equal(eventEchoIssue(["blocked"], "Он посветил фонарём вверх и увидел трещину."), "");
  assert.match(buildLedgerNotes(["blocked"]), /выход перекрыт/);
});

test("continuity ledger ловит смену состояния предмета без перехода", () => {
  const state: SceneContinuityState = {
    facts: [{ entityId: "knife", entityLabel: "нож", stateId: "in_hand", stateLabel: "нож в руке" }],
  };
  const issue = continuityIssue(state, "Нож лежал на полу у самой стены, пока Илья смотрел в щель.");
  assert.match(issue, /нож/);
  assert.match(issue, /без перехода/);
});

test("continuity ledger ловит противоречие внутри одной сцены", () => {
  const issue = continuityIssue(
    { facts: [] },
    "Нож лежал на полу у стены. Илья ещё держал нож перед собой и не опускал руку.",
  );
  assert.match(issue, /одновременно разные состояния/);
});

test("continuity ledger обновляет состояние и строит заметки для следующей сцены", () => {
  const next = advanceContinuityState(
    { facts: [] },
    "Васька отстал в темноте. Рюкзак лежал у стены, а фонарь погас в ладони.",
  );
  assert.deepEqual(next.facts, [
    { entityId: "vasya", entityLabel: "Васька", stateId: "behind", stateLabel: "Васька остался позади" },
    { entityId: "backpack", entityLabel: "рюкзак", stateId: "on_floor", stateLabel: "рюкзак на полу" },
    { entityId: "flashlight", entityLabel: "фонарь", stateId: "off", stateLabel: "фонарь погас" },
  ]);
  assert.match(buildContinuityNotes(next), /НЕПРЕРЫВНОСТЬ СЦЕНЫ/);
  assert.match(buildContinuityNotes(next), /Васька остался позади/);
});

test("полосы длины сцен чередуются", () => {
  assert.deepEqual(sceneLengthBand(0), [260, 360]);
  assert.deepEqual(sceneLengthBand(1), [380, 520]);
  assert.deepEqual(sceneLengthBand(2), [260, 360]);
});

test("промпт сцены несёт полосу длины, шов, реестр и бюджет сравнений", () => {
  const plan: ScenePlan = {
    minWords: 260,
    maxWords: 360,
    seamNotes: buildSeamNotes(["Илья выставил шест и шагнул в проём."]),
    ledgerNotes: buildLedgerNotes(["blocked"]),
    continuityNotes: buildContinuityNotes({
      facts: [{ entityId: "knife", entityLabel: "нож", stateId: "in_hand", stateLabel: "нож в руке" }],
    }),
    reactionNotes: buildReactionNotes(2, 3),
  };
  const prompt = buildScenePrompt(input, beat, 0, 9, "хвост предыдущей главы", "", "", "", plan);
  assert.match(prompt, /Объём: 260–360 слов/);
  assert.match(prompt, /без метронома/);
  assert.doesNotMatch(prompt, /рядом с двадцатисловной ставь фразу короче шести слов/);
  assert.match(prompt, /не больше двух на сцену/);
  assert.match(prompt, /ШОВ СЦЕН/);
  assert.match(prompt, /УЖЕ СЛУЧИЛОСЬ В ГЛАВЕ/);
  assert.match(prompt, /НЕПРЕРЫВНОСТЬ СЦЕНЫ/);
  assert.match(prompt, /нож в руке/);
  assert.match(prompt, /РЕАКЦИИ И МОЛЧАНИЕ/);
  assert.ok(prompt.includes("этот ход больше не повторяй"));
});

test("молчание и «замер» упираются в потолок главы", () => {
  assert.equal(silenceIssue("Он не ответил.", 0), "");
  assert.notEqual(silenceIssue("Он не ответил.", MAX_SILENT_REACTIONS), "");
  assert.equal(silenceIssue("Он не ответил сразу, а потом коротко бросил: «Пошли».", MAX_SILENT_REACTIONS), "");
  assert.equal(freezeIssue("Илья замер.", 0), "");
  assert.notEqual(freezeIssue("Илья застыл.", MAX_FREEZE_REACTIONS), "");
  assert.equal(freezeIssue("Он потянулся к поясу за ножом, но замер, услышав скрежет сверху.", MAX_FREEZE_REACTIONS), "");
  assert.match(buildReactionNotes(2, 3), /больше не повторяй/);
  assert.match(buildReactionNotes(2, 3), /реакция на новое событие/);
});

test("потолок главы выбран — требование сужается до выполнимого нуля", () => {
  // Живой прогон 20.09.2026, 23:43: при трёх молчаниях и четырёх «замер» в главе каждая
  // следующая сцена отвергалась с одним и тем же замечанием («при 3 уже в главе, потолок 2»),
  // невыполнимым ни при каком тексте, и сгорала во всех трёх попытках (сцены 6, 9, 10).
  assert.notEqual(silenceIssue("Он не ответил.", MAX_SILENT_REACTIONS + 1), "");
  assert.equal(silenceIssue("Он подошёл к щитку и поднял фонарь.", MAX_SILENT_REACTIONS + 1), "");
  assert.notEqual(freezeIssue("Илья замер.", MAX_FREEZE_REACTIONS + 1), "");
  assert.equal(freezeIssue("Илья шагнул к ящику и поднял крышку.", MAX_FREEZE_REACTIONS + 1), "");
  assert.match(silenceIssue("Он не ответил.", MAX_SILENT_REACTIONS + 1), /уже выбран/);
});

test("в одной сцене — одна реакция каждого рода", () => {
  assert.equal(silenceIssue("Он не ответил.", 0), "");
  assert.notEqual(silenceIssue("Он не ответил. Она промолчала.", 0), "");
  assert.match(silenceIssue("Он не ответил. Она промолчала.", 0), /найдено 2 вхождения/);
  assert.match(silenceIssue("Он не ответил. Она промолчала.", 0), /допускается одно/);
  assert.equal(freezeIssue("Илья замер.", 0), "");
  assert.notEqual(freezeIssue("Илья замер. Васька застыл.", 0), "");
  assert.match(freezeIssue("Илья замер. Васька застыл.", 0), /найдено 2 вхождения/);
});

test("служебные функции не портят счёт слов", () => {
  assert.equal(closingSentences("Первое. Второе. Третье."), "Третье.");
  assert.equal(countWordsRu("Он не ответил."), 3);
});
