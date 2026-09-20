import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLedgerNotes,
  buildReactionNotes,
  buildScenePrompt,
  buildSeamNotes,
  closingSentences,
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
    reactionNotes: buildReactionNotes(2, 3),
  };
  const prompt = buildScenePrompt(input, beat, 0, 9, "хвост предыдущей главы", "", "", "", plan);
  assert.match(prompt, /Объём: 260–360 слов/);
  assert.match(prompt, /не больше двух на сцену/);
  assert.match(prompt, /ШОВ СЦЕН/);
  assert.match(prompt, /УЖЕ СЛУЧИЛОСЬ В ГЛАВЕ/);
  assert.match(prompt, /РЕАКЦИИ И МОЛЧАНИЕ/);
  assert.ok(prompt.includes("этот ход больше не повторяй"));
});

test("молчание и «замер» упираются в потолок главы", () => {
  assert.equal(silenceIssue("Он не ответил.", 0), "");
  assert.notEqual(silenceIssue("Он не ответил.", MAX_SILENT_REACTIONS), "");
  assert.equal(freezeIssue("Илья замер.", 0), "");
  assert.notEqual(freezeIssue("Илья застыл.", MAX_FREEZE_REACTIONS), "");
  assert.match(buildReactionNotes(2, 3), /больше не повторяй/);
  assert.match(buildReactionNotes(2, 3), /реакция на новое событие/);
});

test("служебные функции не портят счёт слов", () => {
  assert.equal(closingSentences("Первое. Второе. Третье."), "Третье.");
  assert.equal(countWordsRu("Он не ответил."), 3);
});
