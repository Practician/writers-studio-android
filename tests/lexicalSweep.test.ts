/**
 * Сборка 120: лексическая чистка главы.
 *
 * Живой прогон главы 4 (06.10.2026, 00:44): гейт не пройден — балл 19 при пороге
 * 12, тяжёлых штампов 3. Разбор показал, что весь провал — три вхождения одного
 * оборота «не просто X, а Y» (автор — 0 на 38 000 знаков) плюс давление
 * оценочных (131,2 против 46,3, почти всё — основа «ровн*» ×15). Доводка их
 * видела, но модель возвращала оборот обратно. Чистка проверяет именно цель
 * («оборот исчез», «вхождений стало меньше»), а не «стало не хуже».
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  repairForeignWords,
  runLexicalSweep,
  type GenerateFn,
} from "../server/chapterGenerate";

const blocks = (text: string) => JSON.stringify({ blocks: [text] });

test("sweep убирает запрещённый оборот и называет число в журнале", async () => {
  const source = [
    "Вход оказался не просто разломом, а дверным проемом.",
    "Обычный абзац без штампов, с фактами и делом.",
  ].join("\n\n");
  const calls: string[] = [];
  const generate = (async (params: Parameters<GenerateFn>[0]) => {
    calls.push(params.contents);
    return blocks("Вход оказался дверным проемом, а не разломом.");
  }) as GenerateFn;

  const result = await runLexicalSweep(source, generate, { model: "mock" });

  assert.equal(result.bannedBefore, 1);
  assert.equal(result.bannedRemoved, 1);
  assert.equal(result.blocksRewritten, 1);
  assert.match(result.note, /«не просто» убрано ×1/);
  assert.doesNotMatch(result.text, /не просто/i);
  assert.ok(calls.length >= 1 && calls.length <= 3, "не больше трёх вызовов");
});

test("sweep не трогает абзац, где оборот выжил в правке", async () => {
  const source = "Вход оказался не просто разломом, а дверным проемом.";
  const generate = (async () => blocks("Вход оказался не просто разломом, а дверным проемом, честно.")) as GenerateFn;

  const result = await runLexicalSweep(source, generate, { model: "mock" });

  assert.equal(result.blocksRewritten, 0);
  assert.equal(result.text, source);
  assert.match(result.note, /осталось ×1/);
});

test("sweep разводит переиспользованную основу и молчит на чистой главе", async () => {
  // Шесть вхождений основы по четырём абзацам: порог срабатывания — 6.
  const source = [
    "Блеснул ровный угол, и Васька присел рядом, чтобы разглядеть его.",
    "Край у плиты ровный, а шов и вовсе ровный на всем протяжении.",
    "Открылась ровная площадка, и срез у неё ровный, без зазубрин.",
    "Пол под ногами ровный, и полоса вдоль стены тоже ровная.",
  ].join("\n\n");
  // Правка — полноценный пересказ теми же фактами: приёмка требует ≥3 новых
  // слов (isRealRewrite) и длину в пределах 1,3× (TOUCHUP_MAX_GROWTH).
  const fixedByIndex = [
    "Угол блеснул чистым боком, и Васька опустился рядом, чтобы рассмотреть его.",
    "Край у плиты прямой, а шов тянется гладко на всей длине.",
    "Открылась прямая площадка, срез у неё чистый, без зазубрин и сколов.",
    "Пол под ногами чистый, а полоса вдоль стены тоже прямая.",
  ];
  const generate = (async (params: Parameters<GenerateFn>[0]) => {
    const payload = JSON.parse(params.contents.match(/<DATA role="lexical-sweep">\s*([\s\S]*?)\s*<\/DATA>/)?.[1] || "[]") as Array<{ index: number }>;
    return JSON.stringify({ blocks: payload.map((entry) => fixedByIndex[entry.index]) });
  }) as GenerateFn;

  const result = await runLexicalSweep(source, generate, { model: "mock" });

  const rov = result.stemsDiversified.find((entry) => entry.stem === "ровн");
  assert.ok(rov, "основа «ровн» должна попасть в чистку");
  assert.ok(rov.after < rov.before, `ожидалось снижение, получено ${rov.before}→${rov.after}`);
  assert.match(result.note, /ровн/);

  const cleanCalls: string[][] = [];
  const cleanGenerate = (async (params: Parameters<GenerateFn>[0]) => {
    cleanCalls.push([params.contents]);
    return blocks("x");
  }) as GenerateFn;
  const clean = await runLexicalSweep("Обычный абзац.\n\nВторой обычный абзац.", cleanGenerate, { model: "mock" });
  assert.equal(cleanCalls.length, 0, "на чистой главе вызовов нет");
  assert.equal(clean.note, "");
});

test("sweep режет «вдруг» свыше лимита и оставляет первые", async () => {
  const source = [
    "Он вдруг замер.",
    "Вдруг блеснул угол.",
    "Вдруг там вход завален.",
    "Вдруг оно отключится.",
  ].join("\n\n");
  const generate = (async (params: Parameters<GenerateFn>[0]) => {
    const payload = JSON.parse(params.contents.match(/<DATA role="lexical-sweep">\s*([\s\S]*?)\s*<\/DATA>/)?.[1] || "[]") as Array<{ text: string }>;
    const fixed = payload.map((entry) => entry.text.replace(/вдруг,? /iu, ""));
    return JSON.stringify({ blocks: fixed });
  }) as GenerateFn;

  const result = await runLexicalSweep(source, generate, { model: "mock" });

  assert.equal(result.suddenlyBefore, 4);
  assert.ok(result.suddenlyAfter <= 2, `ожидалось ≤2, получено ${result.suddenlyAfter}`);
  assert.match(result.note, /«вдруг» 4→/);
});

test("repairForeignWords чинит смешанное слово, повторяет выживших и сдаётся честно", async () => {
  let calls = 0;
  const generate = (async (params: Parameters<GenerateFn>[0]) => {
    calls += 1;
    if (params.contents.includes("brown")) return JSON.stringify({ replacements: { brown: "бурый" } });
    return JSON.stringify({ replacements: {} });
  }) as GenerateFn;

  const first = await repairForeignWords("Слой темно-brown грунта.", generate, { model: "mock" });
  assert.equal(first.text, "Слой темно-бурый грунта.");
  assert.deepEqual(first.replaced, { brown: "бурый" });
  assert.deepEqual(first.unreplaced, []);

  const stubborn = await repairForeignWords(
    "Слой темно-brown грунта и smartphone.",
    (async () => {
      calls += 1;
      return JSON.stringify({ replacements: {} });
    }) as GenerateFn,
    { model: "mock" },
  );
  // brown ушёл через последний рубеж, smartphone честно остался в списке.
  assert.equal(stubborn.text.includes("brown"), false);
  assert.deepEqual(stubborn.unreplaced, ["smartphone"]);
  assert.ok(calls >= 3, "повтор по выжившим был");
});

test("sweep добирает внутреннюю речь, когда её нет", async () => {
  const source = [
    "Васька присел у края плиты и достал огниво, чтобы высечь искру.",
    "Илья подбросил ветку в костер и достал двух рыбин из садка.",
    "Плита вздрогнула и осела, выдавив из стыка мелкий песок.",
    "Васька задержал дыхание и продвинул пику дальше в темноту.",
    "Они сняли первую рыбину с огня и разломили горячее мясо.",
    "Свет сменился мутным, и гул за стеной стал тише и ровнее.",
  ].join("\n\n");
  const generate = (async (params: Parameters<GenerateFn>[0]) => {
    const payload = JSON.parse(params.contents.match(/<DATA role="lexical-sweep">\s*([\s\S]*?)\s*<\/DATA>/)?.[1] || "[]") as Array<{ text: string }>;
    const fixed = payload.map((entry) => `${entry.text} Васька прикинул расклад и кивнул.`);
    return JSON.stringify({ blocks: fixed });
  }) as GenerateFn;

  const result = await runLexicalSweep(source, generate, { model: "mock" });

  assert.ok(result.interiorAdded > 0, "мысли должны быть добавлены");
  assert.match(result.note, /внутренняя речь \+/);
  assert.match(result.text, /прикинул/);
});

test("sweep не добирает мысли, когда их хватает", async () => {
  const source = [
    "Васька присел у края. Он подумал, что плита держится на честном слове.",
    "Илья решил сначала поесть, а потом лезть дальше.",
  ].join("\n\n");
  let calls = 0;
  const generate = (async () => {
    calls += 1;
    return JSON.stringify({ blocks: [] });
  }) as GenerateFn;

  const result = await runLexicalSweep(source, generate, { model: "mock" });

  assert.equal(result.interiorAdded, 0);
  assert.equal(calls, 0, "при доле мыслей выше пола вызовов нет");
});
