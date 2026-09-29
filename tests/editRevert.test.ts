import test from "node:test";
import assert from "node:assert/strict";
import { revertUnearnedEdits, editMixRatios } from "../server/editRevert";
import { runEnhancedSepiaPipeline, type PhaseGenerateMap } from "../server/chapterGenerate";
import { resolveHumanizeDepth } from "../server/humanStyle";

const ORIGINAL = [
  "По спине пробежал холодок.",
  "Он вздохнул и сел на камень.",
  "Дождь стучал по крыше сарая, где они прятались.",
  "Илья молча достал нож.",
].join(" ");

test("revertUnearnedEdits: замена без выигрыша откатывается, удачная остаётся", () => {
  const candidate = [
    "По спине пробежал холодок, и Илья замер.", // штамп остался, фраза длиннее → откат
    "Он тяжело вздохнул и уселся на большой камень.", // длиннее, штампов нет → откат
    "Дождь бил по крыше сарая.", // короче → остаётся
    "Илья молча достал нож.", // без изменений
  ].join(" ");
  const result = revertUnearnedEdits(ORIGINAL, candidate);
  assert.equal(result.compared, 3);
  assert.equal(result.reverted, 2);
  assert.ok(result.text.includes("По спине пробежал холодок."));
  assert.ok(result.text.includes("Он вздохнул и сел на камень."));
  assert.ok(result.text.includes("Дождь бил по крыше сарая."));
});

test("revertUnearnedEdits: убранный штамп засчитывается, даже если фраза длиннее", () => {
  const original = "Сердце пропустило удар. Он замер. Потом шагнул вперёд.";
  const candidate = "Он остановился так резко, что ремень рюкзака врезался в плечо. Он замер. Потом шагнул вперёд.";
  const result = revertUnearnedEdits(original, candidate);
  assert.equal(result.reverted, 0);
  assert.equal(result.text, candidate);
});

test("revertUnearnedEdits: разное число предложений — правку не трогаем", () => {
  const candidate = "Холодок по спине. Он вздохнул. Сел на камень. Дождь стучал. Илья достал нож.";
  const result = revertUnearnedEdits(ORIGINAL, candidate);
  assert.equal(result.compared, 0);
  assert.equal(result.text, candidate);
});

test("revertUnearnedEdits: переводы строк кандидата сохраняются", () => {
  const original = "Он замер у стены.\n\nЗа дверью кто-то дышал.\n\nОн сделал шаг.";
  const candidate = "Он замер у стены.\n\nЗа дверью кто-то дышал очень тихо и ровно.\n\nОн сделал шаг.";
  const result = revertUnearnedEdits(original, candidate);
  assert.equal(result.text, original); // длиннее и без выигрыша → откат
  assert.ok(result.text.includes("\n\n"));
});

const LONG = Array.from({ length: 12 }, (_, i) => `Он прошёл по коридору номер ${i + 1}, не оглядываясь и считая шаги до двери.`).join(" ");

function pipelineOptions(phaseGenerate?: PhaseGenerateMap) {
  return {
    model: "main-model",
    route: "generate_full_chapter" as const,
    personaBlock: "",
    depth: resolveHumanizeDepth("maximum"),
    phaseGenerate,
  };
}

test("runEnhancedSepiaPipeline: лексическая фаза идёт по своему маршруту, остальные — основным генератором", async () => {
  const main: string[] = [];
  const routed: string[] = [];
  const generate = async (params: { model: string }) => { main.push(params.model); return LONG; };
  const phaseGenerate: PhaseGenerateMap = {
    "lexical-diversifier": {
      model: "other-model",
      generate: async (params: { model: string }) => { routed.push(params.model); return LONG; },
    },
  };
  await runEnhancedSepiaPipeline(LONG, generate as any, pipelineOptions(phaseGenerate));
  assert.deepEqual(routed, ["other-model"]);
  assert.deepEqual(main, ["main-model", "main-model"]);
});

test("runEnhancedSepiaPipeline: если маршрут упал, фаза повторяется основной моделью", async () => {
  const main: string[] = [];
  const generate = async (params: { model: string }) => { main.push(params.model); return LONG; };
  const phaseGenerate: PhaseGenerateMap = {
    "lexical-diversifier": {
      model: "other-model",
      generate: async () => { throw new Error("provider down"); },
    },
  };
  await runEnhancedSepiaPipeline(LONG, generate as any, pipelineOptions(phaseGenerate));
  assert.deepEqual(main, ["main-model", "main-model", "main-model"]);
});

test("runEnhancedSepiaPipeline: без phaseGenerate всё идёт основным генератором (прежнее поведение)", async () => {
  const main: string[] = [];
  const generate = async (params: { model: string }) => { main.push(params.model); return LONG; };
  await runEnhancedSepiaPipeline(LONG, generate as any, pipelineOptions());
  assert.equal(main.length, 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// editMixRatios — локальный замер правила sepia «Deletion beats addition»
// (74% replace / 18% delete / 8% insert). Гейт отклоняет фазу при insert > 0.25:
// правка, которая дописывает вместо замены, — это рост, а не ремонт.
// ─────────────────────────────────────────────────────────────────────────────

test("editMixRatios: неизменённый текст — правки нет, вставок ноль", () => {
  const mix = editMixRatios(ORIGINAL, ORIGINAL);
  assert.equal(mix.intensity, 0);
  assert.equal(mix.insert, 0);
  assert.equal(mix.delete, 0);
  assert.equal(mix.replace, 1);
});

test("editMixRatios: дописанный хвост даёт insert выше порога 0.25", () => {
  const candidate = `${ORIGINAL} И тут же из темноты вылез мокрый наглый кот и потребовал ужина.`;
  const mix = editMixRatios(ORIGINAL, candidate);
  assert.ok(mix.insert > 0.25, `insert=${mix.insert.toFixed(3)} должен превышать 0.25`);
  assert.equal(mix.delete, 0);
  assert.ok(mix.intensity > 0);
});

test("editMixRatios: чистая замена словами той же длины — это replace, а не вставка", () => {
  const candidate = ORIGINAL.replace("Илья молча достал нож.", "Илья молча вытащил клинок.");
  assert.notEqual(candidate, ORIGINAL);
  const mix = editMixRatios(ORIGINAL, candidate);
  assert.ok(mix.replace > 0.9, `replace=${mix.replace.toFixed(3)} должен быть≈1`);
  assert.ok(mix.insert < 0.1, `insert=${mix.insert.toFixed(3)}`);
  assert.ok(mix.delete < 0.1, `delete=${mix.delete.toFixed(3)}`);
  assert.ok(mix.intensity < 0.3, `intensity=${mix.intensity.toFixed(3)} — правка локальная`);
});

test("editMixRatios: вырезанный кусок идёт в delete, а не в replace", () => {
  const candidate = "По спине пробежал холодок. Он вздохнул и сел на камень. Дождь стучал по крыше сарая, где они прятались.";
  const mix = editMixRatios(ORIGINAL, candidate);
  assert.ok(mix.delete > 0.5, `delete=${mix.delete.toFixed(3)} должен быть>0.5`);
  assert.equal(mix.insert, 0);
  assert.equal(mix.replace, 0);
});

test("editMixRatios: пустой кандидат — это целиком удаление", () => {
  const mix = editMixRatios(ORIGINAL, "");
  assert.equal(mix.delete, 1);
  assert.equal(mix.insert, 0);
  assert.equal(mix.intensity, 1);
});
