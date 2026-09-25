import { useCallback, useEffect, useRef, useState } from "react";
import { collectPlotIssues, type PlotCheckIssue } from "../lib/plotCheck";

export type PlotCheckStatus = "idle" | "running" | "done" | "error";

export interface PlotCheckState {
  status: PlotCheckStatus;
  issues: PlotCheckIssue[];
  truncated: boolean;
  dropped: number;
  error: string;
}

export interface ChapterPlotCheck extends PlotCheckState {
  run: () => void;
  stop: () => void;
}

const EMPTY: PlotCheckState = { status: "idle", issues: [], truncated: false, dropped: 0, error: "" };

/**
 * Смысловые стыковки: ровно один запрос к модели и только по кнопке.
 * Автоприменения нет — найденное место показывается цитатой, автор сам
 * решает, менять ли текст. Запрос отменяется кнопкой «Остановить» и при
 * уходе с главы.
 */
export function useChapterPlotCheck(args: {
  chapterId: string;
  chapterTitle: string;
  text: string;
  previousChapter: string;
  canonDossier: string;
  model: string;
  llmProvider?: string;
  platformFields?: Record<string, unknown>;
}): ChapterPlotCheck {
  const { chapterId, chapterTitle, text, previousChapter, canonDossier, model, llmProvider, platformFields } = args;
  const [state, setState] = useState<PlotCheckState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const latest = useRef({ chapterTitle, text, previousChapter, canonDossier });

  useEffect(() => {
    latest.current = { chapterTitle, text, previousChapter, canonDossier };
  }, [chapterTitle, text, previousChapter, canonDossier]);

  // Другая глава — прежние стыковки к ней не относятся.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(EMPTY);
  }, [chapterId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((value) => (value.status === "running" ? { ...EMPTY, issues: value.issues } : value));
  }, []);

  const run = useCallback(async () => {
    const payload = latest.current;
    if (payload.text.trim().length < 200) {
      setState({ status: "error", issues: [], truncated: false, dropped: 0, error: "Глава слишком короткая: проверять нечего." });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "running", issues: [], truncated: false, dropped: 0, error: "" });

    try {
      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "plot_check",
          chapterTitle: payload.chapterTitle,
          currentChapterTitle: payload.chapterTitle,
          text: payload.text,
          previousChapter: payload.previousChapter,
          canonDossier: payload.canonDossier,
          model,
          llmProvider,
          ...(platformFields || {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data?.error || "Проверка стыковок не удалась.");
      const raw = Array.isArray(data?.plotCheck?.issues) ? data.plotCheck.issues : [];
      // Смещения считаем по тексту, который лежит в редакторе СЕЙЧАС:
      // пока модель думала, автор мог печатать.
      const stats = collectPlotIssues(payload.text, raw);
      setState({
        status: "done",
        issues: stats.issues,
        truncated: Boolean(data?.plotCheck?.truncated) || stats.located > stats.issues.length,
        dropped: stats.dropped,
        error: "",
      });
    } catch (error: unknown) {
      if (controller.signal.aborted || (error as { name?: string })?.name === "AbortError") return;
      setState({
        status: "error",
        issues: [],
        truncated: false,
        dropped: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [model, llmProvider, platformFields]);

  return { ...state, run, stop };
}
