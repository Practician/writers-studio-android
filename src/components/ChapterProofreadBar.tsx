import { useState } from "react";
import type { PlotCheckState } from "../hooks/useChapterPlotCheck";
import { PLOT_CHECK_MAX_ISSUES } from "../lib/plotCheck";
import { MARK_KINDS, type MarkKind, type MarkKindVisibility } from "../lib/proofreadHighlights";
import type { SpellDictionaryStatus } from "../lib/spellRuLoader";
import type { StyleReport } from "../lib/styleObservations";

const KIND_LABELS: Record<MarkKind, string> = {
  spelling: "Правописание",
  punctuation: "Пунктуация",
  plot: "Стыковки",
};

const KIND_DOT: Record<MarkKind, string> = {
  spelling: "bg-rose-400",
  punctuation: "bg-amber-400",
  plot: "bg-violet-400",
};

const LONG_SENTENCE_LIMIT = 45;

export interface ChapterProofreadBarProps {
  dictionaryStatus: SpellDictionaryStatus;
  dictionaryError: string;
  checkedWords: number;
  spellTruncated: boolean;
  counts: Record<MarkKind, number>;
  visible: MarkKindVisibility;
  onToggleKind: (kind: MarkKind) => void;
  styleReport: StyleReport;
  onSelectRange: (start: number, end: number) => void;
  onReloadDictionary: () => void;
  plotCheck: PlotCheckState;
  onRunPlotCheck: () => void;
  onStopPlotCheck: () => void;
}

/**
 * Полоска вычитки над редактором главы. Метки рисуются в самом тексте,
 * здесь — только переключатели и то, что нельзя показать подчёркиванием:
 * наблюдения стиля и состояние проверки стыковок.
 */
export default function ChapterProofreadBar(props: ChapterProofreadBarProps) {
  const {
    dictionaryStatus,
    dictionaryError,
    checkedWords,
    spellTruncated,
    counts,
    visible,
    onToggleKind,
    styleReport,
    onSelectRange,
    onReloadDictionary,
    plotCheck,
    onRunPlotCheck,
    onStopPlotCheck,
  } = props;
  const [styleOpen, setStyleOpen] = useState(false);

  const status =
    dictionaryStatus === "ready"
      ? `словарь готов · ${checkedWords} слов`
      : dictionaryStatus === "loading"
        ? "словарь загружается…"
        : dictionaryStatus === "error"
          ? "словарь недоступен"
          : "словарь не загружен";
  const metrics = styleReport.metrics;

  return (
    <div className="shrink-0 rounded-xl border border-slate-800/70 bg-slate-950/40 px-2.5 py-1.5" id="chapter-proofread-bar">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="mr-1 text-slate-500">{status}</span>

        {MARK_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onToggleKind(kind)}
            title={visible[kind] ? "Скрыть эти метки в тексте" : "Показать эти метки в тексте"}
            className={`flex min-h-8 items-center gap-1.5 rounded-lg border px-2 py-0.5 transition ${
              visible[kind]
                ? "border-slate-700 bg-slate-900/70 text-slate-200"
                : "border-slate-800 bg-transparent text-slate-500 line-through"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[kind]}`} />
            <span>{KIND_LABELS[kind]}</span>
            <span className="font-mono">{counts[kind]}</span>
          </button>
        ))}

        <span className="min-w-2 flex-1" />

        <button
          type="button"
          onClick={() => setStyleOpen((value) => !value)}
          className={`min-h-8 rounded-lg border px-2 py-0.5 transition ${
            styleOpen ? "border-sky-800 bg-sky-950/40 text-sky-200" : "border-slate-700 text-slate-300"
          }`}
          title="Наблюдения по стилю: считаются локально, без модели"
        >
          Стиль {styleReport.observations.length}
        </button>

        {plotCheck.status === "running" ? (
          <button
            type="button"
            onClick={onStopPlotCheck}
            className="min-h-8 rounded-lg border border-slate-700 px-2 py-0.5 text-slate-300"
          >
            Остановить
          </button>
        ) : (
          <button
            type="button"
            onClick={onRunPlotCheck}
            className="min-h-8 rounded-lg bg-slate-800 px-2 py-0.5 font-semibold text-slate-200 hover:bg-violet-900/40 hover:text-violet-200"
            title="Один запрос к модели: нестыковки с предыдущей главой и материалами книги"
          >
            Проверить стыковки
          </button>
        )}
      </div>

      <p className="mt-1 text-[10px] text-slate-600">
        Подчёркнутое в тексте — нажмите прямо там: покажем причину и замену. Ничего не меняется без вашего нажатия.
      </p>

      {plotCheck.status === "running" && (
        <p className="mt-1 text-[10px] text-slate-400">Модель сверяет главу с предыдущей и с материалами книги…</p>
      )}
      {plotCheck.status === "error" && (
        <p className="mt-1 rounded-lg border border-rose-900/50 bg-rose-950/30 p-1.5 text-[10px] text-rose-300">
          {plotCheck.error || "Проверка не удалась."}
        </p>
      )}
      {plotCheck.status === "done" && plotCheck.issues.length === 0 && (
        <p className="mt-1 text-[10px] text-slate-500">
          Нестыковок не нашлось: либо их нет, либо модель промолчала — пустой ответ не доказывает чистоту текста.
        </p>
      )}
      {plotCheck.truncated && <p className="mt-1 text-[10px] text-slate-500">Показаны первые {PLOT_CHECK_MAX_ISSUES} мест.</p>}
      {plotCheck.status === "done" && plotCheck.dropped > 0 && (
        <p className="mt-1 text-[10px] text-slate-600">
          Отброшено {plotCheck.dropped}: цитаты уже нет в тексте — глава изменилась после запроса.
        </p>
      )}
      {dictionaryStatus === "error" && (
        <p className="mt-1 text-[10px] text-slate-400">
          {dictionaryError || "Словарь не загрузился."}{" "}
          <button type="button" onClick={onReloadDictionary} className="underline">
            повторить
          </button>
        </p>
      )}
      {spellTruncated && <p className="mt-1 text-[10px] text-slate-500">Проверены не все места: показаны первые 600.</p>}

      {styleOpen && (
        <div className="mt-2 space-y-1.5 border-t border-slate-800/70 pt-2">
          <p className="text-[10px] text-slate-500">
            {metrics.words} слов · {metrics.sentences} фраз · средняя {metrics.averageSentenceWords.toFixed(1)} слов · длинных (от{" "}
            {LONG_SENTENCE_LIMIT}) {metrics.longSentences}
            {styleReport.calibration ? ` · похожесть на ваш голос ${Math.round(styleReport.calibration.similarity * 100)}%` : ""}
          </p>
          {styleReport.calibration && styleReport.calibration.weakest.length > 0 && (
            <p className="text-[10px] text-slate-500">
              Отходит по: {styleReport.calibration.weakest.map((item) => item.label).join(", ")}
            </p>
          )}
          {styleReport.signals.map((signal) => (
            <p key={signal.category} className="rounded bg-slate-900/60 px-2 py-1 text-[10px] text-slate-300">
              <span className="font-semibold text-sky-300">{signal.category}</span> · {signal.count}
              <span className="block text-slate-500">{signal.message}</span>
            </p>
          ))}
          {styleReport.observations.length === 0 && (
            <p className="text-[10px] text-slate-500">Наблюдений нет: ни повторов, ни штампов, ни длинных предложений.</p>
          )}
          {styleReport.observations.map((observation, index) => (
            <button
              key={`${observation.category}:${observation.start}:${index}`}
              type="button"
              onClick={() => onSelectRange(observation.start, observation.end)}
              className="w-full rounded-lg bg-slate-900/50 p-2 text-left hover:bg-slate-900"
            >
              <span className="text-[10px] font-semibold text-slate-300">{observation.category}</span>
              <span className="block text-[10px] text-slate-500">{observation.message}</span>
              {observation.quote && (
                <span className="mt-0.5 block truncate text-[10px] italic text-slate-600">«{observation.quote}»</span>
              )}
            </button>
          ))}
          <p className="text-[10px] text-slate-600">
            Наблюдения — не приговор, а повод перечитать. Считаются на телефоне, без обращения к модели.
          </p>
        </div>
      )}
    </div>
  );
}
