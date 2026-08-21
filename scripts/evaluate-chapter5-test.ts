import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditStyleSignals, compareStyle, computeStyleStats, wordsOf } from "../src/lib/authorAudit";

const outputDir = process.env.CHAPTER5_OUTPUT;
const samplePath = process.env.AUTHOR_SAMPLE;
if (!outputDir || !samplePath) throw new Error("CHAPTER5_OUTPUT and AUTHOR_SAMPLE are required");

const [source, result, sample, rawResponse] = await Promise.all([
  readFile(path.join(outputDir, "chapter5_input.txt"), "utf8"),
  readFile(path.join(outputDir, "chapter5_result.txt"), "utf8"),
  readFile(samplePath, "utf8"),
  readFile(path.join(outputDir, "chapter5_response.json"), "utf8"),
]);
const response = JSON.parse(rawResponse);

const blocks = (text: string) => text.replace(/\r\n/g, "\n").split(/\n{2,}/u);
const sourceBlocks = blocks(source);
const resultBlocks = blocks(result);
const changedBlocks = sourceBlocks.filter((block, index) => block !== resultBlocks[index]).length;
const onlyPunctuationChanged = sourceBlocks.filter((block, index) => {
  const normalize = (value: string) => value.toLowerCase().replace(/[^а-яёa-z0-9]+/giu, "");
  return block !== resultBlocks[index] && normalize(block) === normalize(resultBlocks[index] || "");
}).length;

function lcsLength(left: string[], right: string[]): number {
  let previous = new Uint16Array(right.length + 1);
  let current = new Uint16Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = left[i - 1] === right[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return previous[right.length];
}

const sourceWords = wordsOf(source).map((word) => word.toLowerCase());
const resultWords = wordsOf(result).map((word) => word.toLowerCase());
const commonWords = lcsLength(sourceWords, resultWords);

function ngrams(text: string, size: number): Set<string> {
  const words = wordsOf(text).map((word) => word.toLowerCase());
  const values = new Set<string>();
  for (let index = 0; index <= words.length - size; index += 1) {
    values.add(words.slice(index, index + size).join(" "));
  }
  return values;
}

const sampleNgrams = ngrams(sample, 8);
const sourceNgrams = ngrams(source, 8);
const leakedNgrams = [...ngrams(result, 8)].filter((value) => sampleNgrams.has(value) && !sourceNgrams.has(value));

const report = {
  model: response.model,
  audit: response.audit,
  deterministicChecks: response.checks,
  structure: {
    sourceBlocks: sourceBlocks.length,
    resultBlocks: resultBlocks.length,
    changedBlocks,
    unchangedBlocks: sourceBlocks.length - changedBlocks,
    onlyPunctuationChanged,
  },
  words: {
    source: sourceWords.length,
    result: resultWords.length,
    retainedInOrder: commonWords,
    retainedShare: Number((commonWords / Math.max(sourceWords.length, 1)).toFixed(4)),
    removed: sourceWords.length - commonWords,
    added: resultWords.length - commonWords,
  },
  style: {
    authorSample: computeStyleStats(sample),
    source: computeStyleStats(source),
    result: computeStyleStats(result),
    sourceSimilarityToAuthor: compareStyle(sample, source).similarity,
    resultSimilarityToAuthor: compareStyle(sample, result).similarity,
    sourceSignals: auditStyleSignals(source),
    resultSignals: auditStyleSignals(result),
  },
  contentLeakage: {
    newEightWordMatchesFromChapter1: leakedNgrams,
  },
};

await writeFile(path.join(outputDir, "chapter5_evaluation.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
