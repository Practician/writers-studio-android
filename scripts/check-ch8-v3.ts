import { aiTellScore, sentenceBurstiness, shortSentenceStats } from "../server/humanStyle";
import { countWordsRu } from "../server/chapterGenerate";
import { loadAdaptiveProfile, scoreCalibratedLocalDetector } from "../src/lib/adaptiveDetector";
import { LABYRINTH_STORY_ID } from "../src/data/labyrinthCanon";
import fs from "fs";

const text = fs.readFileSync("src/data/labyrinth/chapter-8.txt", "utf8");
const s = aiTellScore(text);
const b = sentenceBurstiness(text);
const sh = shortSentenceStats(text, 4);
const w = countWordsRu(text);
const profile = loadAdaptiveProfile(LABYRINTH_STORY_ID);
const cal = scoreCalibratedLocalDetector(text, profile);

console.log("=== Глава 8 v3 ===");
console.log("Слов:", w);
console.log("Score:", s.score + "/100");
console.log("Burstiness:", b.toFixed(3));
console.log("ShortShare:", (sh.share * 100).toFixed(1) + "%");
console.log("MaxChain:", sh.maxChain);
console.log("Hits:", s.hits.length);
for (const h of s.hits) console.log("  [" + h.category + "] " + h.label);
if (cal) console.log("Adaptive HUMAN%:", cal.calibratedHumanProbability + "%");
console.log(s.score < 15 ? "VERDICT: HUMAN" : s.score < 25 ? "VERDICT: BORDERLINE" : "VERDICT: AI");
