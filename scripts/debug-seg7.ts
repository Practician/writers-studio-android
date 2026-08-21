import { aiTellScore, sentenceBurstiness, shortSentenceStats, detectAiTells } from "../server/humanStyle";
import { computeStyleStats, splitSentences, wordsOf } from "../src/lib/authorAudit";

const seg7 = `Я протиснулся в щель. За ней оказался обычный коридор, если в Лабиринте вообще бывает что-то обычное. Пол тверже прежнего, стены гладкие, через одинаковые промежутки идут зеленые риски. Я достал ключ и сделал возле входа короткую царапину. Она вспыхнула синим. «Работает! Значит, не все поменялось». Щель за спиной начала закрываться. Сначала сузилась до полосы, потом стена сошлась полностью. Вернуться уже не получится... Хотя я и не собирался. Наверное. Пошел вперед, считая шаги. На тридцать седьмом вспомнил маму и сбился. «Справишься, Андрей». Голос был настоящий, суп тоже казался настоящим. Может, Лабиринт просто вытащил все это из моей головы, а может быть, я действительно был дома. Разбираться сейчас бесполезно. «Ладно, начинаем считать заново». На стене впереди увидел выдавленную надпись: «Уровень 2». Потрогал буквы холодные. Телефон все еще показывал около двадцати процентов, тепловизор включался, карты не было. Коридор немного поворачивал вправо. Я остановился и прислушался. Тихо. «Направо, значит направо. Мужики налево уже ходили!» Улыбнувшись собственной глупости, я пошел дальше.`;

const score = aiTellScore(seg7);
const stats = computeStyleStats(seg7);
const short = shortSentenceStats(seg7, 4);
const burst = sentenceBurstiness(seg7);
const hits = detectAiTells(seg7);
const sentences = splitSentences(seg7);

console.log("=== Сегмент 7 (LIKELY_AI по Яндексу) ===");
console.log("Score:", score.score);
console.log("Burstiness:", burst.toFixed(3));
console.log("ShortShare:", (short.share * 100).toFixed(1) + "%");
console.log("MaxChain:", short.maxChain);
console.log("AvgSent:", stats.averageSentenceWords.toFixed(1));
console.log("Sentences:", sentences.length);
console.log("Hits:", hits.length);
for (const h of hits) console.log("  ", h.label, "->", h.match);
console.log();
console.log("Sentences:");
for (const s of sentences) {
  const w = wordsOf(s).length;
  console.log("  [" + String(w).padStart(2) + "] " + s.slice(0, 100));
}

// Also check what's specific about this segment
console.log();
console.log("=== Pattern check ===");
console.log("Has 'пол твёрже':", /пол тверже/i.test(seg7));
console.log("Has 'стены гладкие':", /стены гладкие/i.test(seg7));
console.log("Has 'зеленые риски':", /зеленые риски/i.test(seg7));
console.log("Has 'считая шаги':", /считая шаги/i.test(seg7));
console.log("Has 'тепловизор':", /тепловизор/i.test(seg7));
console.log("Has 'Уровень 2':", /Уровень 2/i.test(seg7));
console.log("Has 'карты не было':", /карт[ыа]?\s+не\s+было/i.test(seg7));
