import React, { useState } from "react";
import { BookOpen, Database, FileText, Globe2, Users } from "lucide-react";
import type { Story, Character, WorldRule } from "../types";
import CharacterManager from "./CharacterManager";
import WorldBuilder from "./WorldBuilder";
import CodexPanel from "./CodexPanel";

type BookSection = "characters" | "world" | "codex";

interface BookPanelProps {
  story: Story;
  onUpdateCharacters: (characters: Character[]) => void;
  onUpdateWorldRules: (rules: WorldRule[]) => void;
  selectedModel?: string;
  llmProvider?: "auto" | "gemini" | "nvidia" | "groq" | "openrouter";
  llmApiFields?: Record<string, unknown>;
  onOpenBookMaterials?: () => void;
}

const sections: Array<{ id: BookSection; label: string; description: string; icon: typeof Users }> = [
  { id: "characters", label: "Персонажи", description: "Действующие лица и их мотивация", icon: Users },
  { id: "world", label: "Лор", description: "Правила мира, места и факты", icon: Globe2 },
  { id: "codex", label: "Кодекс", description: "Поиск по заметкам и справочнику", icon: Database },
];

export default function BookPanel({
  story,
  onUpdateCharacters,
  onUpdateWorldRules,
  selectedModel,
  llmProvider = "auto",
  llmApiFields,
  onOpenBookMaterials,
}: BookPanelProps) {
  const [activeSection, setActiveSection] = useState<BookSection>("characters");

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden" id="book-panel">
      <div className="border-b border-slate-800 bg-slate-950/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-amber-950/40 p-1.5 text-amber-300">
            <BookOpen className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">Книга</h2>
            <p className="text-[10px] text-slate-400">Материалы и канон вашей истории в одном месте</p>
          </div>
        </div>
        {onOpenBookMaterials && (
          <button type="button" onClick={onOpenBookMaterials} className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-blue-500/30 bg-blue-950/25 px-3 text-left transition-colors hover:bg-blue-950/45">
            <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-blue-300" /><span><span className="block text-xs font-semibold text-blue-100">Материалы книги</span><span className="block text-[10px] text-slate-400">Библия мира и план сюжета</span></span></span>
            <span className="text-[10px] font-semibold text-blue-300">Изменить</span>
          </button>
        )}
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950/45 p-1">
          {sections.map((section) => {
            const Icon = section.icon;
            const active = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                title={section.description}
                className={`flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-[10px] font-semibold transition-colors ${
                  active
                    ? "bg-slate-800 text-slate-100 shadow-sm"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {activeSection === "characters" && (
          <CharacterManager
            story={story}
            onUpdateCharacters={onUpdateCharacters}
            selectedModel={selectedModel}
            llmProvider={llmProvider}
            llmApiFields={llmApiFields}
          />
        )}
        {activeSection === "world" && (
          <WorldBuilder
            story={story}
            onUpdateWorldRules={onUpdateWorldRules}
            selectedModel={selectedModel}
            llmProvider={llmProvider}
            llmApiFields={llmApiFields}
          />
        )}
        {activeSection === "codex" && <CodexPanel story={story} />}
      </div>
    </div>
  );
}
