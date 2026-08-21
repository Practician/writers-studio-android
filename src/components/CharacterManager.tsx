import React, { useState } from "react";
import { User, Plus, Trash2, Edit3, Sparkles, Save, X, Eye } from "lucide-react";
import { Character, Story } from "../types";

interface CharacterManagerProps {
  story: Story;
  onUpdateCharacters: (characters: Character[]) => void;
  selectedModel?: string;
  llmProvider?: "auto" | "gemini" | "nvidia" | "groq" | "openrouter";
  llmApiFields?: Record<string, unknown>;
}

export default function CharacterManager({ story, onUpdateCharacters, selectedModel, llmProvider = "auto", llmApiFields }: CharacterManagerProps) {
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [showGenModal, setShowGenModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states for creating/editing
  const [formName, setFormName] = useState("");
  const [formRole, setFormRole] = useState("Протагонист");
  const [formTraits, setFormTraits] = useState("");
  const [formGoals, setFormGoals] = useState("");
  const [formDesc, setFormDesc] = useState("");

  const handleSelectChar = (char: Character) => {
    setSelectedChar(char);
    setIsEditing(false);
    
    // Sync form values
    setFormName(char.name);
    setFormRole(char.role);
    setFormTraits(char.traits);
    setFormGoals(char.goals);
    setFormDesc(char.description);
  };

  const handleStartCreate = () => {
    setSelectedChar(null);
    setIsEditing(true);
    
    setFormName("");
    setFormRole("Протагонист");
    setFormTraits("");
    setFormGoals("");
    setFormDesc("");
  };

  const handleSave = () => {
    if (!formName.trim()) return;

    const updated = [...story.characters];
    
    if (selectedChar) {
      // Editing existing
      const idx = updated.findIndex(c => c.id === selectedChar.id);
      if (idx !== -1) {
        updated[idx] = {
          ...selectedChar,
          name: formName,
          role: formRole,
          traits: formTraits,
          goals: formGoals,
          description: formDesc
        };
        setSelectedChar(updated[idx]);
      }
    } else {
      // Creating new
      const newChar: Character = {
        id: "char-" + Math.random().toString(36).substr(2, 9),
        name: formName,
        role: formRole,
        traits: formTraits,
        goals: formGoals,
        description: formDesc
      };
      updated.push(newChar);
      setSelectedChar(newChar);
    }

    onUpdateCharacters(updated);
    setIsEditing(false);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Вы действительно хотите удалить этого персонажа?")) {
      const updated = story.characters.filter(c => c.id !== id);
      onUpdateCharacters(updated);
      if (selectedChar?.id === id) {
        setSelectedChar(null);
        setIsEditing(false);
      }
    }
  };

  // Generate character via AI
  const handleAiGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const promptText = `Создай уникального персонажа для истории «${story.title}» (${story.description}). ${
        aiPrompt ? `Пожелания к персонажу: ${aiPrompt}` : "Придумай яркого персонажа, который создаст конфликт или интересную динамику."
      }`;

      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "brainstorm",
          category: "Персонаж (Character Profile)",
          topic: promptText,
          ...(llmApiFields || { model: selectedModel, llmProvider }),
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Ошибка при генерации персонажа.");
      }

      const data = await response.json();
      
      // Parse character info from AI text using regex or simple split, or fallback to full AI desc
      const text = data.result;
      
      // Let's parse or put all text inside fields beautifully
      // We will parse name, role, traits, goals, and description
      const lines = text.split("\n");
      let name = "Новый персонаж";
      let role = "Протагонист";
      let traits = "";
      let goals = "";
      let desc = text;

      // Simple heuristic parsing of Markdown lines
      for (const line of lines) {
        if (line.includes("Имя") || line.includes("Name") || line.includes("1. **")) {
          name = line.replace(/[^а-яА-ЯёЁa-zA-Z0-9\s]/g, "").replace(/(Имя|Name)/i, "").trim().slice(0, 40) || name;
        } else if (line.includes("Роль") || line.includes("Role")) {
          role = line.split(":")[1]?.trim() || role;
        } else if (line.includes("Черты") || line.includes("Traits")) {
          traits = line.split(":")[1]?.trim() || traits;
        } else if (line.includes("Цель") || line.includes("Goal")) {
          goals = line.split(":")[1]?.trim() || goals;
        }
      }

      if (name === "Новый персонаж" && lines[0]) {
        // use first line
        name = lines[0].replace(/[#*_\-]/g, "").trim().slice(0, 30);
      }

      const newChar: Character = {
        id: "char-" + Math.random().toString(36).substr(2, 9),
        name: name || "Персонаж из ИИ",
        role: role || "Второстепенный персонаж",
        traits: traits || "Оригинальные черты, сгенерированные ИИ.",
        goals: goals || "Скрытые мотивы и амбиции.",
        description: desc
      };

      const updated = [...story.characters, newChar];
      onUpdateCharacters(updated);
      setSelectedChar(newChar);
      setIsEditing(false);
      setShowGenModal(false);
      setAiPrompt("");
    } catch (err: any) {
      setError(err.message || "Не удалось сгенерировать персонажа.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden" id="characters-container">
      {/* List / Detail Split */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isEditing ? (
          /* Editor View */
          <div className="space-y-4 bg-slate-950/30 p-4 border border-slate-800 rounded-lg">
            <h3 className="font-semibold text-sm text-slate-100 flex items-center gap-1.5 border-b border-slate-800 pb-2">
              <User className="w-4 h-4 text-blue-400" />
              {selectedChar ? "Редактировать персонажа" : "Новый персонаж"}
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Имя персонажа</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Например: Капитан Валерия"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Роль в истории</label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded px-2.5 py-1.5 text-slate-100"
                >
                  <option value="Протагонист (Главный герой)">Протагонист (Главный герой)</option>
                  <option value="Антагонист (Противник)">Антагонист (Противник)</option>
                  <option value="Второстепенный персонаж">Второстепенный персонаж</option>
                  <option value="Наставник / Помощник">Наставник / Помощник</option>
                  <option value="Тайный враг / Союзник">Тайный враг / Союзник</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Черты характера</label>
                <input
                  type="text"
                  value={formTraits}
                  onChange={(e) => setFormTraits(e.target.value)}
                  placeholder="Решительный, скрытный, склонен к риску..."
                  className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Ключевая цель / Мотивация</label>
                <input
                  type="text"
                  value={formGoals}
                  onChange={(e) => setFormGoals(e.target.value)}
                  placeholder="Спасти семью, найти сокровище, скрыть прошлое..."
                  className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Описание / Биография</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={4}
                  placeholder="Внешность, предыстория, важные детали..."
                  className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded px-2.5 py-1.5 text-slate-100 font-sans"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs pt-2">
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={!formName.trim()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded cursor-pointer transition-colors flex items-center gap-1"
              >
                <Save className="w-3.5 h-3.5" />
                Сохранить
              </button>
            </div>
          </div>
        ) : selectedChar ? (
          /* Detail View */
          <div className="space-y-4 bg-slate-950/30 p-4 border border-slate-800 rounded-lg">
            <div className="flex justify-between items-start border-b border-slate-800 pb-2">
              <div>
                <h4 className="font-bold text-base text-slate-100">{selectedChar.name}</h4>
                <span className="text-xs text-blue-400 font-medium px-2 py-0.5 bg-blue-950/60 border border-blue-900/30 rounded-full inline-block mt-1">
                  {selectedChar.role}
                </span>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer transition-colors"
                  title="Редактировать"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setSelectedChar(null)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer transition-colors"
                  title="Назад к списку"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-3.5 text-sm">
              {selectedChar.traits && (
                <div>
                  <span className="text-xs text-slate-400 block font-medium">Черты характера:</span>
                  <p className="text-slate-200 text-xs italic">{selectedChar.traits}</p>
                </div>
              )}
              {selectedChar.goals && (
                <div>
                  <span className="text-xs text-slate-400 block font-medium">Мотивация и цели:</span>
                  <p className="text-slate-200 text-xs">{selectedChar.goals}</p>
                </div>
              )}
              {selectedChar.description && (
                <div className="border-t border-slate-800/60 pt-2">
                  <span className="text-xs text-slate-400 block font-medium mb-1">Биография / Подробно:</span>
                  <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {selectedChar.description}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* List View */
          <div className="space-y-3">
            <div className="flex justify-between items-center pb-1">
              <h3 className="font-semibold text-xs uppercase tracking-wider text-slate-400">Действующие лица ({story.characters.length})</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowGenModal(true)}
                  className="px-2.5 py-1 text-xs bg-purple-950/40 hover:bg-purple-900/40 border border-purple-800/40 text-purple-300 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Генератор ИИ
                </button>
                <button
                  onClick={handleStartCreate}
                  className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Создать
                </button>
              </div>
            </div>

            {story.characters.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-950/20">
                <User className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Персонажи пока не созданы.</p>
                <button
                  onClick={handleStartCreate}
                  className="mt-3 text-xs text-blue-400 hover:underline"
                >
                  Создать вручную
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5" id="characters-list-grid">
                {story.characters.map((char) => (
                  <div
                    key={char.id}
                    onClick={() => handleSelectChar(char)}
                    className="p-3.5 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800/80 rounded-xl cursor-pointer transition-all hover:border-slate-700 group flex justify-between items-center"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-900 rounded-lg text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm text-slate-200 group-hover:text-white">{char.name}</h4>
                        <p className="text-xs text-slate-400 truncate max-w-[180px]">{char.role}</p>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleDelete(char.id, e)}
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

      {/* AI Generate Modal */}
      {showGenModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-1.5">
                <Sparkles className="w-5 h-5 text-purple-400" />
                Сгенерировать персонажа
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
                ИИ проанализирует концепцию вашей книги и создаст полноценного персонажа со своими целями, внешностью и предысторией.
              </p>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Пожелания (необязательно)</label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Например: Детектив средних лет с механическим протезом руки, скрывающий тайную преданность пиратам."
                  rows={3}
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
                {isGenerating ? "Генерация..." : "Создать персонажа"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
