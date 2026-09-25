import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findPunctuationIssues, type PunctuationIssue } from "../lib/punctuationRules";
import { scanSpellIssues, type RuSpellChecker, type SpellIssue } from "../lib/spellRu";
import { loadRuSpellChecker, releaseRuSpellChecker, type SpellDictionaryStatus } from "../lib/spellRuLoader";
import { buildStyleReport, type StyleReport } from "../lib/styleObservations";

const EMPTY_STYLE: StyleReport = {
  signals: [],
  observations: [],
  metrics: { words: 0, sentences: 0, averageSentenceWords: 0, longSentences: 0, lexicalRepeats: 0 },
  calibration: null,
};

export interface ChapterProofreading {
  dictionaryStatus: SpellDictionaryStatus;
  dictionaryError: string;
  spellIssues: SpellIssue[];
  spellTruncated: boolean;
  checkedWords: number;
  punctuationIssues: PunctuationIssue[];
  styleReport: StyleReport;
  suggest: (word: string) => string[];
  reloadDictionary: () => void;
}

/**
 * Одна точка входа для проверки главы. Живёт в App, потому что подчёркивания
 * рисует зеркальный слой под редактором, а список — панель.
 */
export function useChapterProofreading(args: {
  text: string;
  enabled: boolean;
  knownWords: string[];
  referenceSample?: string;
}): ChapterProofreading {
  const { text, enabled, knownWords, referenceSample } = args;
  const checkerRef = useRef<RuSpellChecker | null>(null);
  const [status, setStatus] = useState<SpellDictionaryStatus>("idle");
  const [error, setError] = useState("");
  const [checkerReady, setCheckerReady] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  const [spellIssues, setSpellIssues] = useState<SpellIssue[]>([]);
  const [spellTruncated, setSpellTruncated] = useState(false);
  const [checkedWords, setCheckedWords] = useState(0);
  const [punctuationIssues, setPunctuationIssues] = useState<PunctuationIssue[]>([]);
  const [styleReport, setStyleReport] = useState<StyleReport>(EMPTY_STYLE);

  const knownKey = useMemo(() => knownWords.join("\u0000"), [knownWords]);
  const knownList = useMemo(() => knownKey.split("\u0000").filter(Boolean), [knownKey]);

  // Словарь грузится только на вкладке «Глава» и освобождается при уходе с неё:
  // разобранный словарь держит около 166 МБ памяти.
  useEffect(() => {
    if (!enabled) {
      releaseRuSpellChecker();
      checkerRef.current = null;
      setStatus("idle");
      setError("");
      return;
    }
    let alive = true;
    setStatus("loading");
    setError("");
    loadRuSpellChecker()
      .then((checker) => {
        if (!alive) return;
        checkerRef.current = checker;
        setStatus("ready");
        setCheckerReady((value) => value + 1);
      })
      .catch((loadError: unknown) => {
        if (!alive) return;
        checkerRef.current = null;
        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => {
      alive = false;
    };
  }, [enabled, reloadToken]);

  useEffect(() => {
    if (!enabled || status !== "ready") return;
    const timer = setTimeout(() => {
      const checker = checkerRef.current;
      if (checker) {
        const scan = scanSpellIssues(checker, text, { extraWords: knownList });
        setSpellIssues(scan.issues);
        setSpellTruncated(scan.truncated);
        setCheckedWords(scan.checkedWords);
      }
      setPunctuationIssues(findPunctuationIssues(text));
      setStyleReport(buildStyleReport(text, referenceSample));
    }, 300);
    return () => clearTimeout(timer);
  }, [enabled, status, checkerReady, text, knownList, referenceSample]);

  const suggest = useCallback((word: string) => {
    const checker = checkerRef.current;
    if (!checker) return [];
    return checker.suggest(word, 6);
  }, []);

  const reloadDictionary = useCallback(() => {
    releaseRuSpellChecker();
    checkerRef.current = null;
    setReloadToken((value) => value + 1);
  }, []);

  return {
    dictionaryStatus: status,
    dictionaryError: error,
    spellIssues,
    spellTruncated,
    checkedWords,
    punctuationIssues,
    styleReport,
    suggest,
    reloadDictionary,
  };
}
