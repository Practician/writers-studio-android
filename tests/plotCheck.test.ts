import test from "node:test";
import assert from "node:assert/strict";
import {
  PLOT_CHECK_DOSSIER_LIMIT,
  PLOT_CHECK_KINDS,
  PLOT_CHECK_MAX_ISSUES,
  buildPlotCheckPrompt,
  collectPlotIssues,
  locateQuote,
  parsePlotCheckResponse,
} from "../src/lib/plotCheck";

const CHAPTER = `Васька уткнулся в дверь плечом и замер. За стеной кто-то считал вслух: раз, два, три.
— Кто там? — спросил он и сам не узнал свой голос.
Ответа не было. Он поднял руку и постучал три раза.`;

test("цитата находится в тексте и даёт точные смещения", () => {
  const range = locateQuote(CHAPTER, "Он поднял руку и постучал три раза.");
  assert.ok(range);
  assert.equal(CHAPTER.slice(range.start, range.end), "Он поднял руку и постучал три раза.");
});

test("поиск терпит переводы строк, лишние пробелы и разную длину тире", () => {
  const withWhitespace = locateQuote(CHAPTER, "Ответа не было.  Он поднял руку   и постучал три раза.");
  assert.ok(withWhitespace);
  assert.equal(CHAPTER.slice(withWhitespace.start, withWhitespace.end), "Ответа не было. Он поднял руку и постучал три раза.");

  const withDash = locateQuote("Он ждал — долго и молча.", "Он ждал – долго и молча.");
  assert.ok(withDash);

  const withQuotes = locateQuote('Он сказал "больше не приду" и вышел.', "Он сказал «больше не приду» и вышел.");
  assert.ok(withQuotes);
  assert.equal('Он сказал "больше не приду" и вышел.'.slice(withQuotes.start, withQuotes.end), 'Он сказал "больше не приду" и вышел.');
});

test("отсутствующая и слишком короткая цитата не привязываются", () => {
  assert.equal(locateQuote(CHAPTER, "такого в главе нет и близко"), null);
  assert.equal(locateQuote(CHAPTER, "два"), null);
});

test("привязка вычищает выдуманные цитаты, дубли и пустые объяснения", () => {
  const stats = collectPlotIssues(CHAPTER, [
    { kind: "silence", quote: "— Кто там? — спросил он", explanation: "Он спросил и не получил ответа от того, кто считал за стеной." },
    { kind: "silence", quote: "— Кто там? — спросил он", explanation: "Дубль того же места." },
    { kind: "придумано", quote: "Он поднял руку и постучал три раза.", explanation: "" },
    { kind: "continuity", quote: "Этой фразы в главе нет, она выдумана моделью", explanation: "Не найдётся." },
  ]);

  assert.equal(stats.issues.length, 2);
  assert.equal(stats.located, 3);
  assert.equal(stats.dropped, 1);
  assert.equal(stats.issues[0].kind, "silence");
  assert.equal(stats.issues[1].kind, "continuity");
  assert.equal(stats.issues[1].explanation, "Проверьте этот фрагмент: возможно, он расходится с предыдущей главой.");
  assert.equal(stats.issues[0].quote, CHAPTER.slice(stats.issues[0].start, stats.issues[0].end));
  assert.equal(stats.issues[0].explanation, "Он спросил и не получил ответа от того, кто считал за стеной.");
});

test("больше двухсот мест обрезается с флагом truncated", () => {
  const sentences: string[] = [];
  for (let index = 0; index < 240; index += 1) sentences.push(`Фрагмент номер ${index} держит внимание читателя.`);
  const text = sentences.join(" ");
  const raw = sentences.map((sentence) => ({ kind: "freeze", quote: sentence, explanation: "Сцена встала." }));

  const parsed = parsePlotCheckResponse(JSON.stringify(raw), text);
  assert.equal(parsed.issues.length, PLOT_CHECK_MAX_ISSUES);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.dropped, 0);
});

test("ответ модели разбирается из ```json-блока и из объекта с issues", () => {
  const fenced = `\`\`\`json
[
  {"kind":"seam_echo","quote":"Ответа не было. Он поднял руку","explanation":"Начало повисает."},
  {"kind":"event_echo","quote":"цитата, которой в главе нет","explanation":"мусор"}
]
\`\`\``;
  const parsed = parsePlotCheckResponse(fenced, CHAPTER);
  assert.equal(parsed.issues.length, 1);
  assert.equal(parsed.issues[0].kind, "seam_echo");
  assert.equal(parsed.dropped, 1);
  assert.equal(parsed.truncated, false);

  const asObject = parsePlotCheckResponse(
    `{"issues":[{"kind":"freeze","quote":"Васька уткнулся в дверь плечом и замер.","explanation":"Он замер и не пошёл дальше."}]}`,
    CHAPTER,
  );
  assert.equal(asObject.issues.length, 1);
  assert.equal(asObject.issues[0].kind, "freeze");
});

test("пустой ответ и ответ без пунктов не считаются ошибкой формата", () => {
  const parsed = parsePlotCheckResponse("[]", CHAPTER);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.dropped, 0);
});

test("мусор вместо JSON — явная ошибка, а не молчаливый пропуск", () => {
  assert.throws(() => parsePlotCheckResponse("Мне нечего добавить.", CHAPTER), /списка стыковок/u);
  assert.throws(() => parsePlotCheckResponse("", CHAPTER), /пуст/u);
});

test("промпт требует молчания при неуверенности и перечисляет все виды нестыковок", () => {
  const dossier = "План книги: герой идёт к башне.";
  const prompt = buildPlotCheckPrompt({
    chapterTitle: "Ночь у чужого входа",
    text: CHAPTER,
    previousChapter: "Он вошёл в подъезд и поднялся на пятый этаж.",
    canonDossier: dossier,
  });

  assert.ok(prompt.includes(CHAPTER));
  assert.ok(prompt.includes("Он вошёл в подъезд"));
  assert.ok(prompt.includes(dossier));
  assert.ok(prompt.includes("НЕ включайте пункт"));
  assert.ok(prompt.includes("Пустой список лучше выдуманной нестыковки"));
  assert.ok(prompt.includes("ДОСЛОВНЫЙ кусок"));
  for (const kind of PLOT_CHECK_KINDS) assert.ok(prompt.includes(kind), `нет вида ${kind}`);
  assert.ok(prompt.includes(String(PLOT_CHECK_MAX_ISSUES)));
});

test("материалы книги обрезаются по потолку, хвост не уезжает в запрос", () => {
  const marker = "ХВОСТ-КОТОРЫЙ-НЕ-ДОЛЖЕН-УЕХАТЬ";
  const dossier = `${"А".repeat(PLOT_CHECK_DOSSIER_LIMIT)}${marker}`;
  const prompt = buildPlotCheckPrompt({ text: CHAPTER, canonDossier: dossier });
  assert.ok(prompt.includes("материалы обрезаны"));
  assert.ok(!prompt.includes(marker));
});
