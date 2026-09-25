import { useMemo, useState } from "react";
import type { PunctuationIssue } from "../lib/punctuationRules";
import { PUNCTUATION_RULE_LABELS } from "../lib/punctuationRules";
import type { SpellIssue } from "../lib/spellRu";
import type { StyleReport } from "../lib/styleObservations";
import type { SpellDictionaryStatus } from "../lib/spellRuLoader";
import { PLOT_CHECK_KIND_LABELS, PLOT_CHECK_MAX_ISSUES } from "../lib/plotCheck";
import type { PlotCheckState } from "../hooks/useChapterPlotCheck";

type Tab = "spelling" | "punctuation" | "style" | "plot";

export interface ChapterProofreadPanelProps {
  text: string;
  dictionaryStatus: SpellDictionaryStatus;
  dictionaryError: string;
  spellIssues: SpellIssue[];
  spellTruncated: boolean;
  checkedWords: number;
  punctuationIssues: PunctuationIssue[];
  styleReport: StyleReport;
  personalWords: string[];
  suggest: (word: string) => string[];
  onSelectRange: (start: number, end: number) => void;
  onReplaceRange: (start: number, end: number, replacement: string) => void;
  onAddWord: (word: string) => void;
  onRemoveWord: (word: string) => void;
  onReloadDictionary: () => void;
  plotCheck: PlotCheckState;
  onRunPlotCheck: () => void;
  onStopPlotCheck: () => void;
}

const LIST_LIMIT = 60;

function contextAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 24);
  const to = Math.min(text.length, end + 24);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/gu, " ")}${to < text.length ? "…" : ""}`;
}

export default function ChapterProofreadPanel(props: ChapterProofreadPanelProps) {
  const {
    text,
    dictionaryStatus,
    dictionaryError,
    spellIssues,
    spellTruncated,
    checkedWords,
    punctuationIssues,
    styleReport,
    personalWords,
    suggest,
    onSelectRange,
    onReplaceRange,
    onAddWord,
    onRemoveWord,
  onReloadDictionary,
  plotCheck,
  onRunPlotCheck,
  onStopPlotCheck,
} = props;

  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("spelling");
  const [openIssueKey, setOpenIssueKey] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");

  const observations = styleReport.observations;
  const statusLabel = useMemo(() => {
    if (dictionaryStatus === "ready") return `словарь готов · проверено ${checkedWords} слов`;
    if (dictionaryStatus === "loading") return "словарь загружается…";
    if (dictionaryStatus === "error") return "словарь недоступен";
    return "словарь не загружен";
  }, [dictionaryStatus, checkedWords]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "spelling", label: "Правописание", count: spellIssues.length },
    { id: "punctuation", label: "Пунктуация", count: punctuationIssues.length },
    { id: "style", label: "Стиль", count: observations.length },
    { id: "plot", label: "Стыковки", count: plotCheck.issues.length },
  ];

  const handleSpellClick = (issue: SpellIssue) => {
    onSelectRange(issue.start, issue.end);
    const key = `${issue.start}:${issue.word}`;
    if (openIssueKey === key) {
      setOpenIssueKey("");
      setSuggestions([]);
      return;
    }
    setOpenIssueKey(key);
    setSuggestions(suggest(issue.word));
  };

  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-950/40" id="chapter-proofread-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-xs font-semibold text-slate-200">Проверка главы</span>
          <span className="truncate text-[10px] text-slate-500">{statusLabel}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium">
          <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300">{spellIssues.length}</span>
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">{punctuationIssues.length}</span>
          <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-sky-300">{observations.length}</span>
          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">{plotCheck.issues.length}</span>
          <span className="text-slate-500">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-800/70 px-3 pb-3 pt-2">
          <div className="mb-2 flex gap-1 rounded-lg bg-slate-900/60 p-0.5 text-[11px] font-semibold">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`min-h-8 flex-1 rounded-md px-2 transition-colors ${
                  tab === item.id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {item.label} {item.count > 0 ? `· ${item.count}` : ""}
              </button>
            ))}
          </div>

          {dictionaryStatus === "error" && (
            <div className="mb-2 rounded-lg border border-rose-900/50 bg-rose-950/30 p-2 text-[11px] text-rose-300">
              {dictionaryError || "Не удалось загрузить словарь."}{" "}
              <button type="button" onClick={onReloadDictionary} className="underline">
                Повторить
              </button>
            </div>
          )}

          {dictionaryStatus === "loading" && (
            <p className="mb-2 text-[11px] text-slate-500">Словарь русского языка загружается один раз на сессию.</p>
          )}

          {tab === "spelling" && (
            <div className="space-y-1.5">
              {spellIssues.length === 0 && (
                <p className="text-[11px] text-slate-500">
                  {dictionaryStatus === "ready"
                    ? "Непонятных слов нет. Имена героев книги не считаются ошибками."
                    : "Орфография проверится после загрузки словаря."}
                </p>
              )}
              {spellIssues.slice(0, LIST_LIMIT).map((issue) => {
                const key = `${issue.start}:${issue.word}`;
                return (
                  <div key={key} className="rounded-lg bg-slate-900/50 p-2">
                    <button
                      type="button"
                      onClick={() => handleSpellClick(issue)}
                      className="flex w-full items-baseline justify-between gap-2 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="text-xs font-semibold text-rose-300 underline decoration-rose-500/60 decoration-wavy underline-offset-2">
                          {issue.word}
                        </span>
                        <span className="ml-2 break-all text-[10px] text-slate-500">
                          {contextAround(text, issue.start, issue.end)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-500">{openIssueKey === key ? "▾" : "▸"}</span>
                    </button>

                    {openIssueKey === key && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {suggestions.length === 0 && (
                          <span className="text-[10px] text-slate-500">Подсказок нет.</span>
                        )}
                        {suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => {
                              onReplaceRange(issue.start, issue.end, suggestion);
                              setOpenIssueKey("");
                              setSuggestions([]);
                            }}
                            className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-emerald-900/40 hover:text-emerald-200"
                          >
                            {suggestion}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            onAddWord(issue.word);
                            setOpenIssueKey("");
                            setSuggestions([]);
                          }}
                          className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
                        >
                          Добавить в словарь
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {spellTruncated && (
                <p className="text-[10px] text-slate-500">Показаны не все места: исправьте первые, список обновится.</p>
              )}

              <div className="mt-2 border-t border-slate-800/70 pt-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Свои слова</p>
                <div className="mb-1.5 flex gap-1">
                  <input
                    value={newWord}
                    onChange={(event) => setNewWord(event.target.value)}
                    placeholder="Имя, топоним, термин"
                    className="min-h-8 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 text-[11px] text-slate-200 outline-none placeholder:text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newWord.trim()) return;
                      onAddWord(newWord.trim());
                      setNewWord("");
                    }}
                    className="min-h-8 rounded-md bg-slate-800 px-2 text-[11px] text-slate-200"
                  >
                    Добавить
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {personalWords.length === 0 && <span className="text-[10px] text-slate-500">Пока пусто.</span>}
                  {personalWords.map((word) => (
                    <button
                      key={word}
                      type="button"
                      onClick={() => onRemoveWord(word)}
                      title="Убрать из словаря"
                      className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-rose-900/40 hover:text-rose-200"
                    >
                      {word} ×
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "punctuation" && (
            <div className="space-y-1.5">
              {punctuationIssues.length === 0 && (
                <p className="text-[11px] text-slate-500">Механических нарушений не найдено.</p>
              )}
              {punctuationIssues.slice(0, LIST_LIMIT).map((issue, index) => (
                <div key={`${issue.rule}:${issue.start}:${index}`} className="rounded-lg bg-slate-900/50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => onSelectRange(issue.start, issue.end)} className="min-w-0 flex-1 text-left">
                      <span className="text-[11px] font-semibold text-amber-300">{PUNCTUATION_RULE_LABELS[issue.rule]}</span>
                      <span className="ml-2 break-all text-[10px] text-slate-500">
                        {contextAround(text, issue.start, issue.end)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onReplaceRange(issue.start, issue.end, issue.replacement)}
                      className="shrink-0 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-amber-900/40 hover:text-amber-200"
                    >
                      Заменить
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">{issue.message}</p>
                </div>
              ))}
              {punctuationIssues.length > LIST_LIMIT && (
                <p className="text-[10px] text-slate-500">Ещё {punctuationIssues.length - LIST_LIMIT} мест ниже списка.</p>
              )}
            </div>
          )}

          {tab === "style" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-400">
                <span className="rounded bg-slate-900/60 px-2 py-1">Слов: {styleReport.metrics.words}</span>
                <span className="rounded bg-slate-900/60 px-2 py-1">Предложений: {styleReport.metrics.sentences}</span>
                <span className="rounded bg-slate-900/60 px-2 py-1">
                  Средняя длина: {styleReport.metrics.averageSentenceWords}
                </span>
                <span className="rounded bg-slate-900/60 px-2 py-1">Повторов: {styleReport.metrics.lexicalRepeats}</span>
              </div>

              {styleReport.calibration && (
                <p className="rounded bg-slate-900/60 px-2 py-1.5 text-[11px] text-slate-300">
                  Близость к вашему образцу: {styleReport.calibration.similarity}%
                  {styleReport.calibration.weakest.length > 0 && (
                    <span className="text-slate-500">
                      {" "}
                      · отходит по: {styleReport.calibration.weakest.map((item) => item.label).join(", ")}
                    </span>
                  )}
                </p>
              )}

              {styleReport.signals.map((signal) => (
                <p key={signal.category} className="rounded bg-slate-900/60 px-2 py-1.5 text-[11px] text-slate-300">
                  <span className="font-semibold text-sky-300">{signal.category}</span> · {signal.count}
                  <span className="block text-[10px] text-slate-500">{signal.message}</span>
                </p>
              ))}

              {observations.length === 0 && (
                <p className="text-[11px] text-slate-500">Наблюдений нет: ни повторов, ни штампов, ни длинных предложений.</p>
              )}
              {observations.map((observation, index) => (
                <button
                  key={`${observation.category}:${observation.start}:${index}`}
                  type="button"
                  onClick={() => onSelectRange(observation.start, observation.end)}
                  className="w-full rounded-lg bg-slate-900/50 p-2 text-left hover:bg-slate-900"
                >
                  <span className="text-[11px] font-semibold text-slate-300">{observation.category}</span>
                  <span className="block text-[10px] text-slate-500">{observation.message}</span>
                  {observation.quote && (
                    <span className="mt-0.5 block truncate text-[10px] italic text-slate-600">«{observation.quote}»</span>
                  )}
                </button>
              ))}

              <p className="text-[10px] text-slate-600">
                Наблюдения — не приговор: это подсказки, что стоит перечитать.
                Смысловые нестыковки словарём не видны — их ищет вкладка «Стыковки».
              </p>
            </div>
          )}

          {tab === "plot" && (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] text-slate-500">
                  Смысловые стыковки видит только модель, и только по кнопке. Ничего в тексте не меняется само.
                </p>
                {plotCheck.status === "running" ? (
                  <button
                    type="button"
                    onClick={onStopPlotCheck}
                    className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
                  >
                    Остановить
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onRunPlotCheck}
                    className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-violet-900/40 hover:text-violet-200"
                  >
                    Проверить стыковки
                  </button>
                )}
              </div>

              {plotCheck.status === "running" && (
                <p className="text-[11px] text-slate-400">Модель сверяет главу с предыдущей и с материалами книги…</p>
              )}

              {plotCheck.status === "error" && (
                <p className="rounded-lg border border-rose-900/50 bg-rose-950/30 p-2 text-[11px] text-rose-300">
                  {plotCheck.error || "Проверка не удалась."}
                </p>
              )}

              {plotCheck.status === "done" && plotCheck.issues.length === 0 && (
                <p className="text-[11px] text-slate-500">
                  Нестыковок не нашлось: либо их нет, либо модель промолчала. Пустой список — не доказательство чистоты текста.
                </p>
              )}

              {plotCheck.issues.map((issue, index) => (
                <button
                  key={`${issue.kind}:${issue.start}:${index}`}
                  type="button"
                  onClick={() => onSelectRange(issue.start, issue.end)}
                  className="w-full rounded-lg bg-slate-900/50 p-2 text-left hover:bg-slate-900"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-violet-300">{PLOT_CHECK_KIND_LABELS[issue.kind]}</span>
                    <span className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">проверьте</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] italic text-slate-400">«{issue.quote}»</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">{issue.explanation}</span>
                </button>
              ))}

              {plotCheck.truncated && (
                <p className="text-[10px] text-slate-500">Показаны первые {PLOT_CHECK_MAX_ISSUES} мест.</p>
              )}

              {plotCheck.status === "done" && plotCheck.dropped > 0 && (
                <p className="text-[10px] text-slate-600">
                  Отброшено {plotCheck.dropped}: цитату не удалось найти в текущем тексте — глава изменилась после запроса.
                </p>
              )}

              <p className="text-[10px] text-slate-600">
                Модель может ошибаться: каждый пункт — повод перечитать, а не приговор.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
