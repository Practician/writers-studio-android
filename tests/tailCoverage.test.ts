import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DETECTOR_WINDOW_CHARS,
  EMPTY_CHUNK_SHARE_LIMIT,
  emptyChunkShare,
  proseRegisterWindowIssues,
  rhythmWindowIssues,
} from "../server/proseRegister";
import { fuseShortSentencesForTail } from "../server/humanStyle";
import { HUMAN_SAMPLE, MACHINE_CHAPTER } from "./fixturesProseRegister";

/**
 * Сборка 115. Всё в этом файле выведено из отчёта детектора
 * result_2026-10-04T20-27-50.json: 18 кусков, 8 HUMAN против 10 AI, все
 * измерены одним кодом в один день. Это сильнейший аргумент из возможных —
 * и он сразу показал, что предыдущие калибровки смотрели не туда.
 */

// ── Главная находка: длинные фrases распределены по кускам неравномерно ───────

test("на отчёте детектора куски без длинных фраз различают классы", () => {
  // Значения из scripts/calibrateOnDetectorReport.ts на этом отчёте.
  const humanChunks = [0.27, 0.18, 0.22, 0.44, 0.27, 0.10, 0.0, 0.10];
  const aiChunks = [0.13, 0.08, 0.07, 0.0, 0.07, 0.06, 0.08, 0.06, 0.0, 0.22];
  const share = (list: number[]): number => list.filter((value) => value < 0.12).length / list.length;
  assert.equal(share(humanChunks).toFixed(2), "0.38");
  assert.equal(share(aiChunks).toFixed(2), "0.80");
  // Порог стоит между классами: и эталон, и машина по нему однозначны.
  assert.ok(share(humanChunks) < EMPTY_CHUNK_SHARE_LIMIT, "эталон проходит");
  assert.ok(share(aiChunks) > EMPTY_CHUNK_SHARE_LIMIT, "машинный текст проваливается");
});

test("emptyChunkShare считает то же, что и разбор отчёта", () => {
  const chapter = [
    "Илья подошёл ближе и провёл пальцем по линии. Поверхность была подозрительно ровной.",
    "Солнце коснулось вершин. Тени вытянулись по камням. Свет стал длиннее и холоднее.",
    "Он отломил кусок и сунул в рот. Прожевал, чувствуя, как тепло разлилось по телу.",
  ].join("\n\n");
  const stat = emptyChunkShare(chapter);
  assert.ok(stat.total > 0, `куски посчитаны: ${stat.total}`);
  assert.equal(stat.empty, stat.total, "в этих кусках длинных фраз нет");
  assert.equal(stat.share, 1);
});

test("замечание о пустых кусках не срабатывает на эталон", () => {
  // Ключевое свойство порога: эталон автора даёт 29 % пустых кусков, машина на
  // отчёте детектора 80 %. Порог 50 % обязан оставить живой текст в покое.
  assert.deepEqual(
    rhythmWindowIssues(HUMAN_SAMPLE).filter((issue) => issue.includes("длинных фраз нет")),
    [],
    "эталон не должен попадать под замечание о пустых кусках",
  );
});

test("покусковая склейка растит хвост в каждом куске, а не по главе", () => {
  // Фразы по 11–12 слов — реальная длина фразы в куске детектора. Короче
  // десяти не подходит: пара из них даёт меньше 25 слов и до «длинной» фразы
  // не дотягивает в принципе, длиннее четырнадцати — тройка уходит за 40 слов
  // и тоже отбрасывается. Проверено на обоих краях.
  const line = [
    "Илья подошёл ближе и наклонился над самым срезом камня.",
    "Поверхность породы выглядела подозрительно ровной, будто шлифованной.",
    "Линия шла через всю толщу без единого изгиба или ответвления.",
    "Камень холодил ладонь даже через плотную ткань рукава.",
    "Ветер тянул из прохода и шевели траву у самой стены.",
    "Он замер и посмотрел в ту сторону, откуда шёл этот звук.",
  ].join(" ");
  const text = new Array(10).fill(line).join("\n\n");
  const before = emptyChunkShare(text);
  const fused = fuseShortSentencesForTail(text, 0.12, DETECTOR_WINDOW_CHARS);
  const after = emptyChunkShare(fused.text);
  assert.ok(fused.fused > 0, `склейка не сработала: ${fused.fused}`);
  assert.ok(after.empty < before.empty, `пустых кусков ${before.empty}/${before.total} → ${after.empty}/${after.total}`);
  assert.ok(after.share <= EMPTY_CHUNK_SHARE_LIMIT,
    `после склейки доля пустых кусков ${Math.round(after.share * 100)} % должна быть ниже порога`);
});

test("покусковая склейка сильнее склейки по главе на одном тексте", () => {
  const long = new Array(8).fill([
    "Васька присел на корточки.",
    "Воздух пах озоном.",
    "Пыль лежала толстым слоем.",
    "Он провёл пальцем по краю.",
    "Камень оказался холоднее воды.",
    "Что-то щёлкнуло внутри породы.",
  ].join(" ")).join("\n\n");
  const perChapter = emptyChunkShare(fuseShortSentencesForTail(long, 0.12).text);
  const perChunk = emptyChunkShare(fuseShortSentencesForTail(long, 0.12, DETECTOR_WINDOW_CHARS).text);
  assert.ok(
    perChunk.share <= perChapter.share,
    `покусковая ${perChunk.empty}/${perChunk.total} не хуже общей ${perChapter.empty}/${perChapter.total}`,
  );
});

// ── Склейка не портит пунктуацию ──────────────────────────────────────────────

test("склейка не оставляет «точка с запятой + заглавная»", () => {
  const long = new Array(5).fill([
    "Он сунул руку в карман.",
    "Там лежал старый нож.",
    "Лезвие было коротким.",
    "Рукоять он обмотал шнуром.",
    "Нож оказался тяжелее, чем ожидал.",
  ].join(" ")).join("\n\n");
  const fused = fuseShortSentencesForTail(long, 0.12, DETECTOR_WINDOW_CHARS).text;
  assert.equal((fused.match(/;\s*[А-ЯЁ]/gu) || []).length, 0,
    "после точки с запятой должна идти строчная буква");
});

test("склейка не теряет и не добавляет слова", () => {
  const words = (text: string): string[] =>
    (text.match(/[а-яёa-z]+/giu) || []).map((word) => word.toLowerCase()).sort();
  const long = new Array(4).fill("Он вошёл в пещеру и остановился у самого входа.").join("\n\n");
  const fused = fuseShortSentencesForTail(long, 0.12, DETECTOR_WINDOW_CHARS).text;
  assert.deepEqual(words(fused), words(long), "слова сохранены один в один");
});

test("короткий текст склейкой не портится", () => {
  const tiny = fuseShortSentencesForTail("Он шагнул. Встал. Пошёл.");
  assert.equal(tiny.fused, 0);
  assert.equal(tiny.text, "Он шагнул. Встал. Пошёл.");
});

// ── Оконные замечания ─────────────────────────────────────────────────────────

test("оконные замечания ловят куски без длинных фраз", () => {
  const noTail = new Array(12).fill([
    "Илья вытер ладонь о штанину и присел у огня.",
    "В гроте стало немного уютнее, сквозняк задувал под куртку.",
    "Камни лежали плотно, один к одному.",
    "Он посмотрел на тёмный вход и перевёл взгляд.",
  ].join(" ")).join("\n\n");
  const issues = rhythmWindowIssues(noTail);
  assert.ok(issues.some((issue) => issue.includes("длинных фраз нет")),
    `пустые куски должны быть названы; получено: ${JSON.stringify(issues)}`);
});

test("оконные замечания по фильтрам отключены: в окне метрика переворачивается", () => {
  // Проверено на отчёте 04.10.2026 и на эталоне: в окне детектора у автора до
  // 178 фильтров на 10 тыс. слов, у нашей главы 114. На главе целиком — наоборот,
  // 46 против 134. Окно в 150 слов для плотностей слишком мало, поэтому эта
  // метрика в окно не идёт: иначе правка идёт по ложным следам на живой прозе.
  assert.deepEqual(proseRegisterWindowIssues(HUMAN_SAMPLE), []);
  assert.deepEqual(proseRegisterWindowIssues(MACHINE_CHAPTER), [],
    "и на машинном тексте она молчит — как и задумано");
  assert.deepEqual(rhythmWindowIssues(HUMAN_SAMPLE), [],
    "эталон не должен попадать под замечания о ритме");
});

test("окно детектора — около 1050 знаков, как в живых отчётах", () => {
  assert.ok(DETECTOR_WINDOW_CHARS >= 950 && DETECTOR_WINDOW_CHARS <= 1200,
    `окно ${DETECTOR_WINDOW_CHARS} — сегменты отчёта были 963–1146 знаков`);
});
