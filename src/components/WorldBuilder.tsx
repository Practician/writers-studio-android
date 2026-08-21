import React, { useState } from "react";
import { Globe, Plus, Trash2, Edit3, Sparkles, Save, X } from "lucide-react";
import { WorldRule, Story } from "../types";

interface WorldBuilderProps {
  story: Story;
  onUpdateWorldRules: (rules: WorldRule[]) => void;
  selectedModel?: string;
  llmProvider?: "auto" | "gemini" | "nvidia" | "groq" | "openrouter";
  llmApiFields?: Record<string, unknown>;
}

export default function WorldBuilder({ story, onUpdateWorldRules, selectedModel, llmProvider = "auto", llmApiFields }: WorldBuilderProps) {
  const [selectedRule, setSelectedRule] = useState<WorldRule | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [showGenModal, setShowGenModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");

  const handleSelectRule = (rule: WorldRule) => {
    setSelectedRule(rule);
    setIsEditing(false);
    setFormTitle(rule.title);
    setFormContent(rule.content);
  };

  const handleStartCreate = () => {
    setSelectedRule(null);
    setIsEditing(true);
    setFormTitle("");
    setFormContent("");
  };

  const handleSave = () => {
    if (!formTitle.trim()) return;

    const updated = [...story.worldRules];

    if (selectedRule) {
      // Edit
      const idx = updated.findIndex(r => r.id === selectedRule.id);
      if (idx !== -1) {
        updated[idx] = {
          ...selectedRule,
          title: formTitle,
          content: formContent
        };
        setSelectedRule(updated[idx]);
      }
    } else {
      // Create new
      const newRule: WorldRule = {
        id: "rule-" + Math.random().toString(36).substr(2, 9),
        title: formTitle,
        content: formContent
      };
      updated.push(newRule);
      setSelectedRule(newRule);
    }

    onUpdateWorldRules(updated);
    setIsEditing(false);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Вы действительно хотите удалить эту запись о мире?")) {
      const updated = story.worldRules.filter(r => r.id !== id);
      onUpdateWorldRules(updated);
      if (selectedRule?.id === id) {
        setSelectedRule(null);
        setIsEditing(false);
      }
    }
  };

  // Generate Lore via AI
  const handleAiGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const promptText = `Сгенерируй детальное описание лора или правила мира для фантастической вселенной книги «${story.title}». ${
        aiPrompt ? `Тема или элемент мира: ${aiPrompt}` : "Придумай уникальную концепцию (технология, магия, фракция или кодекс)."
      }`;

      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "brainstorm",
          category: "Мироустройство (World Lore & Mechanics)",
          topic: promptText,
          ...(llmApiFields || { model: selectedModel, llmProvider }),
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Ошибка при генерации лора.");
      }

      const data = await response.json();
      const text = data.result;

      // Extract a nice title from first line
      const lines = text.split("\n");
      let title = "Новая запись лора";
      for (const line of lines) {
        const clean = line.replace(/[#*_\-]/g, "").trim();
        if (clean.length > 3) {
          title = clean.slice(0, 40);
          break;
        }
      }

      const newRule: WorldRule = {
        id: "rule-" + Math.random().toString(36).substr(2, 9),
        title: title,
        content: text
      };

      const updated = [...story.worldRules, newRule];
      onUpdateWorldRules(updated);
      setSelectedRule(newRule);
      setIsEditing(false);
      setShowGenModal(false);
      setAiPrompt("");
    } catch (err: any) {
      setError(err.message || "Не удалось сгенерировать запись о мире.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden" id="world-builder-container">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isEditing ? (
          /* Editor View */
          <div className="space-y-4 bg-slate-950/30 p-4 border border-slate-800 rounded-lg">
            <h3 className="font-semibold text-sm text-slate-100 flex items-center gap-1.5 border-b border-slate-800 pb-2">
              <Globe className="w-4 h-4 text-blue-400" />
              {selectedRule ? "Редактировать запись" : "Новое правило мира"}
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Название правила или технологии</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Например: Магические Руны, Закон Гравитации"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Содержание / Детали</label>
                <textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  rows={8}
                  placeholder="Опишите, как работает эта деталь мира, её историю, влияние на персонажей..."
                  className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded px-2.5 py-1.5 text-slate-100 font-sans"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs pt-2">
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={!formTitle.trim()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded cursor-pointer transition-colors flex items-center gap-1"
              >
                <Save className="w-3.5 h-3.5" />
                Сохранить
              </button>
            </div>
          </div>
        ) : selectedRule ? (
          /* Detail View */
          <div className="space-y-4 bg-slate-950/30 p-4 border border-slate-800 rounded-lg">
            <div className="flex justify-between items-start border-b border-slate-800 pb-2">
              <h4 className="font-bold text-base text-slate-100">{selectedRule.title}</h4>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer"
                  title="Редактировать"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setSelectedRule(null)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer"
                  title="Назад к списку"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto">
              {selectedRule.content}
            </div>
          </div>
        ) : (
          /* List View */
          <div className="space-y-3">
            <div className="flex justify-between items-center pb-1">
              <h3 className="font-semibold text-xs uppercase tracking-wider text-slate-400">Правила мира и лор ({story.worldRules.length})</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowGenModal(true)}
                  className="px-2.5 py-1 text-xs bg-purple-950/40 hover:bg-purple-900/40 border border-purple-800/40 text-purple-300 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Придумать ИИ
                </button>
                <button
                  onClick={handleStartCreate}
                  className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Добавить
                </button>
              </div>
            </div>

            {story.worldRules.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-950/20">
                <Globe className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Детали мира пока не описаны.</p>
                <button
                  onClick={handleStartCreate}
                  className="mt-3 text-xs text-blue-400 hover:underline animate-pulse"
                >
                  Создать вручную
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5" id="world-rules-grid">
                {story.worldRules.map((rule) => (
                  <div
                    key={rule.id}
                    onClick={() => handleSelectRule(rule)}
                    className="p-3.5 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800/80 rounded-xl cursor-pointer transition-all hover:border-slate-700 group flex justify-between items-center"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-900 rounded-lg text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        <Globe className="w-4 h-4" />
                      </div>
                      <div className="max-w-[180px]">
                        <h4 className="font-semibold text-sm text-slate-200 group-hover:text-white truncate">{rule.title}</h4>
                        <p className="text-xs text-slate-400 truncate">{rule.content.replace(/[#*_\-]/g, "")}</p>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleDelete(rule.id, e)}
                        className="p-1 text-slate-400 hover:text-red-400 rounded transition-colors"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI Generate Lore Modal */}
      {showGenModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-1.5">
                <Sparkles className="w-5 h-5 text-purple-400" />
                Сгенерировать элемент мира
              </h3>
              <button
                onClick={() => setShowGenModal(false)}
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-400 leading-relaxed">
                ИИ придумает правила, политические фракции, типы технологий или мифических монстров, гармонично вписав их во вселенную вашей книги.
              </p>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Пожелания или тема (необязательно)</label>
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Например: Древняя секта ученых-отшельников или Принципы гиперпрыжка"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded p-2 text-xs text-slate-200 focus:ring-1 focus:ring-purple-500 outline-none"
                />
              </div>
            </div>

            {error && <div className="text-xs text-red-400">{error}</div>}

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setShowGenModal(false)}
                disabled={isGenerating}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs cursor-pointer"
              >
                Отмена
              </button>
              <button
                onClick={handleAiGenerate}
                disabled={isGenerating}
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg text-xs cursor-pointer transition-colors flex items-center gap-1"
              >
                {isGenerating ? "Генерация..." : "Создать лор"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
