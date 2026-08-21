import { useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Bot, Check, CheckCircle2, Eye, Play, Square, Wand2 } from "lucide-react";
import type { Chapter, Story } from "../types";
import { loadAuthorProfile } from "../lib/authorStorage";
import { runLocalChapterAgent, type LocalAgentResult, type LocalAgentState } from "../lib/localChapterAgent";

interface AgentPanelProps {
  story: Story;
  currentDraft: string;
  activeChapter?: Chapter;
  selectedModel: string;
  llmProvider: string;
  llmApiFields: Record<string, unknown>;
  onInsertText: (text: string, actionType?: "append" | "replace") => void;
  onClose: () => void;
}

const STAGES: Array<{ id: LocalAgentState; label: string }> = [
  { id: "planning", label: "Цель" },
  { id: "context", label: "Контекст" },
  { id: "evaluating", label: "Проверка" },
  { id: "correcting", label: "Правка" },
  { id: "auditing", label: "Аудит" },
  { id: "completed", label: "Готово" },
];

export default function AgentPanel({ story, currentDraft, activeChapter, selectedModel, llmProvider, llmApiFields, onInsertText, onClose }: AgentPanelProps) {
  const [depth, setDepth] = useState<"fast" | "balanced" | "maximum">("balanced");
  const [stage, setStage] = useState<LocalAgentState | "idle">("idle");
  const [message, setMessage] = useState("Агент подготовит существующую главу к следующему редакторскому шагу.");
  const [result, setResult] = useState<LocalAgentResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const isRunning = stage !== "idle" && stage !== "completed";
  const activeStage = STAGES.findIndex((item) => item.id === stage);

  const handleRun = async () => {
    if (!currentDraft.trim() || isRunning) return;
    setError(null);
    setResult(null);
    setStage("planning");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const author = await loadAuthorProfile(story.id);
      const data = await runLocalChapterAgent({
        story,
        chapter: activeChapter,
        currentDraft,
        provider: llmProvider as any,
        model: selectedModel,
        apiKeys: (llmApiFields.apiKeys || {}) as Record<string, unknown>,
        voiceSheet: author?.voiceSheet,
        authorSample: author?.sample,
        depth,
      }, (event) => {
        setStage(event.state);
        setMessage(event.message);
      }, controller.signal);
      setResult(data);
      setStage("completed");
    } catch (runError: any) {
      if (runError?.name === "AbortError") {
        setMessage("Агент остановлен. Рукопись не менялась.");
      } else {
        setError(runError?.message || "Агент не смог завершить редакторский маршрут.");
      }
      setStage("idle");
    } finally {
      controllerRef.current = null;
    }
  };

  const handleStop = () => controllerRef.current?.abort();

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 p-4 backdrop-blur">
        <button type="button" onClick={onClose} className="mb-3 flex items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-100">
          <ArrowLeft className="h-3.5 w-3.5" /> К быстрым действиям
        </button>
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-violet-400/30 bg-violet-500/15 p-2 text-violet-300"><Bot className="h-5 w-5" /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-100">Редакторский агент</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Не пишет с нуля. Собирает контекст, проверяет главу, готовит бережную версию и итоговое письмо.</p>
          </div>
        </div>
      </header>

      <div className="space-y-5 p-4">
        <section className="rounded-xl border border-slate-700/70 bg-slate-800/50 p-4">
          <p className="text-sm font-medium text-slate-200">Подготовить текущую главу</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Рукопись не меняется автоматически. В конце вы увидите подготовленную версию и сами решите, заменить ли главу.</p>
          <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg border border-slate-700 bg-slate-950/50 p-1">
            {(["fast", "balanced", "maximum"] as const).map((option) => (
              <button key={option} type="button" disabled={isRunning} onClick={() => setDepth(option)} className={`rounded-md px-2 py-2 text-[11px] font-medium transition ${depth === option ? "bg-violet-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}>
                {option === "fast" ? "Быстро" : option === "balanced" ? "Баланс" : "Глубоко"}
              </button>
            ))}
          </div>
          {!currentDraft.trim() && <p className="mt-3 flex gap-2 rounded-lg border border-amber-900/70 bg-amber-950/30 p-2.5 text-xs text-amber-200"><AlertCircle className="h-4 w-4 shrink-0" /> Сначала откройте главу с текстом: агент не создаёт черновик вместо автора.</p>}
          {!isRunning ? (
            <button type="button" disabled={!currentDraft.trim()} onClick={handleRun} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"><Play className="h-4 w-4" /> Запустить редакторский маршрут</button>
          ) : (
            <button type="button" onClick={handleStop} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-rose-900/70 bg-rose-950/30 px-4 py-3 text-sm font-semibold text-rose-200 transition hover:bg-rose-900/30"><Square className="h-4 w-4" /> Остановить</button>
          )}
        </section>

        {(isRunning || stage === "completed") && (
          <section className="rounded-xl border border-slate-700/70 bg-slate-800/50 p-4">
            <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-slate-200">Маршрут агента</p><span className="text-[11px] text-violet-300">{message}</span></div>
            <div className="mt-4 flex items-start justify-between gap-1">
              {STAGES.map((item, index) => {
                const isPast = activeStage >= index || stage === "completed";
                const isCurrent = item.id === stage;
                return <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5" key={item.id}><span className={`h-2.5 w-2.5 rounded-full ${isCurrent ? "bg-violet-400 ring-4 ring-violet-400/20" : isPast ? "bg-emerald-400" : "bg-slate-700"}`} /><span className={`text-center text-[9px] ${isPast ? "text-slate-200" : "text-slate-500"}`}>{item.label}</span></div>;
              })}
            </div>
          </section>
        )}

        {error && <section className="flex gap-2 rounded-xl border border-rose-900/60 bg-rose-950/25 p-3 text-xs leading-relaxed text-rose-200"><AlertCircle className="h-4 w-4 shrink-0" />{error}</section>}

        {result && (
          <section className="space-y-4 rounded-xl border border-emerald-800/60 bg-emerald-950/15 p-4">
            <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" /><div><p className="text-sm font-semibold text-emerald-100">Редакторское письмо готово</p><p className="mt-1 text-xs text-emerald-200/70">{result.review.nextStep}</p></div></div>
            <div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-lg bg-slate-950/50 p-2"><p className="text-lg font-semibold text-slate-100">{result.review.craftScore}</p><p className="text-[10px] uppercase tracking-wide text-slate-500">Оценка</p></div><div className="rounded-lg bg-slate-950/50 p-2"><p className="text-lg font-semibold text-slate-100">{result.wordCount}</p><p className="text-[10px] uppercase tracking-wide text-slate-500">Слов</p></div></div>
            {result.review.issues.length > 0 && <div><p className="mb-2 text-xs font-medium text-slate-300">На что обратить внимание</p><ul className="space-y-1.5 text-xs leading-relaxed text-slate-400">{result.review.issues.slice(0, 5).map((issue, index) => <li className="flex gap-2" key={`${issue}-${index}`}><span className="text-amber-400">•</span>{issue}</li>)}</ul></div>}
            <button type="button" onClick={() => setShowPreview((value) => !value)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800"><Eye className="h-3.5 w-3.5" />{showPreview ? "Скрыть подготовленную версию" : "Просмотреть подготовленную версию"}</button>
            {showPreview && <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-950/70 p-3 font-serif text-sm leading-relaxed text-slate-300">{result.text}</div>}
            <button type="button" onClick={() => onInsertText(result.text, "replace")} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"><Check className="h-4 w-4" /> Заменить главу этой версией</button>
          </section>
        )}

        <p className="flex gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-[11px] leading-relaxed text-slate-500"><Wand2 className="h-4 w-4 shrink-0 text-violet-400" /> Агент — это один глубокий результат: «подготовить главу». Для «написать», «продолжить» и точечной редакции вернитесь к быстрым действиям.</p>
      </div>
    </div>
  );
}
