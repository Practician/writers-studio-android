import type { ActiveMark } from "../lib/proofreadTap";

const TONE: Record<ActiveMark["kind"], string> = {
  spelling: "border-rose-900/60 bg-rose-950/30 text-rose-300",
  punctuation: "border-amber-900/60 bg-amber-950/30 text-amber-300",
  plot: "border-violet-900/60 bg-violet-950/30 text-violet-300",
};

export interface ProofreadMarkCardProps {
  mark: ActiveMark;
  /** Место карточки внутри редактора. null — метка вне зеркального слоя. */
  anchor: { top: number; left: number } | null;
  suggestions: string[];
  inDictionary: boolean;
  onReplace: (replacement: string) => void;
  onAddWord: (word: string) => void;
  onRemoveWord: (word: string) => void;
  onSelectRange: (start: number, end: number) => void;
  onClose: () => void;
}

/**
 * Карточка метки: живёт прямо над подчёркнутым местом, а не списком сбоку.
 * Орфография предлагает замены, пунктуация — готовое исправление, стыковка — цитату.
 */
export default function ProofreadMarkCard(props: ProofreadMarkCardProps) {
  const { mark, anchor, suggestions, inDictionary, onReplace, onAddWord, onRemoveWord, onSelectRange, onClose } = props;
  const quote = mark.quote.trim();

  return (
    <div
      data-mark-card="true"
      className="absolute z-20 w-[19rem] max-w-[calc(100%-1rem)] rounded-xl border border-slate-700/80 bg-slate-900/95 p-2.5 shadow-2xl shadow-black/50 backdrop-blur"
      style={{ top: anchor?.top ?? 8, left: anchor?.left ?? 8 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${TONE[mark.kind]}`}>{mark.label}</span>
        <button
          type="button"
          onClick={onClose}
          className="min-h-7 min-w-7 rounded-lg text-slate-500 hover:text-slate-200"
          aria-label="Закрыть подсказку"
        >
          ×
        </button>
      </div>

      {quote && <p className="mt-1 break-words text-[12px] font-semibold text-slate-100">«{quote}»</p>}
      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{mark.message}</p>

      {mark.kind === "spelling" && (
        <>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {suggestions.length === 0 && (
              <span className="text-[10px] text-slate-500">Подсказок нет — возможно, это имя или придуманное слово.</span>
            )}
            {suggestions.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onReplace(item)}
                className="min-h-8 rounded-lg bg-slate-800 px-2 text-[11px] text-slate-200 hover:bg-emerald-900/40 hover:text-emerald-200"
              >
                {item}
              </button>
            ))}
          </div>
          <div className="mt-1.5">
            {inDictionary ? (
              <button type="button" onClick={() => onRemoveWord(mark.quote)} className="text-[10px] text-slate-400 underline">
                Убрать из личного словаря
              </button>
            ) : (
              <button type="button" onClick={() => onAddWord(mark.quote)} className="text-[10px] text-slate-400 underline">
                В личный словарь
              </button>
            )}
          </div>
        </>
      )}

      {mark.kind === "punctuation" && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="min-w-0 truncate text-[11px] text-slate-400">Замена: «{mark.replacement}»</span>
          <button
            type="button"
            onClick={() => onReplace(mark.replacement)}
            className="ml-auto min-h-8 shrink-0 rounded-lg bg-slate-800 px-2 text-[11px] font-semibold text-slate-200 hover:bg-amber-900/40 hover:text-amber-200"
          >
            Исправить
          </button>
        </div>
      )}

      {mark.kind === "plot" && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">проверьте</span>
          <button
            type="button"
            onClick={() => onSelectRange(mark.start, mark.end)}
            className="ml-auto min-h-8 rounded-lg bg-slate-800 px-2 text-[11px] text-slate-200"
          >
            Показать в тексте
          </button>
        </div>
      )}

      <p className="mt-1 text-[10px] text-slate-600">Меняем только по вашему нажатию.</p>
    </div>
  );
}
