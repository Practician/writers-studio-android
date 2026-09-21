import { test } from "node:test";
import assert from "node:assert/strict";
import { promptForAction, maxTokensForAction } from "../src/lib/directLlmClient";

test("generate_chapters action asks for JSON chapter plan covering Bible and plot", () => {
  const plan = promptForAction("generate_chapters", {
    title: "Книга проб",
    genre: "Фантастика",
    description: "Инженер на станции «Кольцо»",
    worldBible: "Мир: станция «Кольцо», кислород по талонам. Паспорт героя: Артём, 34 года, циник.",
    bookPlan: "Сигнал; раскрытие; побег.",
  });
  assert.equal(plan.json, true);
  assert.ok(plan.prompt.includes("6–12 глав"), "must ask for 6-12 chapters");
  assert.ok(plan.prompt.includes("БИБЛИЯ МИРА И ПАСПОРТА ГЕРОЕВ"), "must include Bible/passports block");
  assert.ok(plan.prompt.includes("станция «Кольцо»"), "must embed worldBible content");
  assert.ok(plan.prompt.includes('"chapters"'), "must demand JSON chapters");
});

test("generate_chapters gets a generous token budget", () => {
  assert.equal(maxTokensForAction("generate_chapters"), 8192);
});


test("generate_full_chapter humanize prompt no longer forces metronome short sentences", () => {
  const plan = promptForAction("generate_full_chapter", {
    humanize: true,
    humanizeDepth: "balanced",
    currentChapterTitle: "Глава 1",
  });
  assert.ok(!plan.prompt.includes("каждые 3–4 предложения делай одно очень коротким"));
  assert.ok(plan.prompt.includes("без метронома") || plan.prompt.includes("Очень короткие предложения допустимы"));
});
