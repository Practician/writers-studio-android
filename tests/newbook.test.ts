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
  assert.equal(maxTokensForAction("generate_chapters"), 3072);
});
