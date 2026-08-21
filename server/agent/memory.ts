// server/agent/memory.ts
// Трёхуровневая система памяти агента.
// Level 1: Session Memory — RAM, lives during task execution
// Level 2: Episodic Memory — serializable, stored in IndexedDB
// Level 3: Style Memory — DeepStyleProfile evolution, stored in IndexedDB

export interface AgentPlanStep {
    id: string;
    description: string;
    tool?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    result?: string;
    startedAt?: string;
    completedAt?: string;
}

export interface AgentPlan {
    steps: AgentPlanStep[];
    currentStepIndex: number;
}

export interface AuthorEditDiff {
    originalText: string;
    editedText: string;
    editDistance: number;
    categorizedChanges: Array<{
        type: 'deletion' | 'addition' | 'rephrasing' | 'restructuring';
        original: string;
        edited: string;
        inferredReason?: string;
    }>;
}

export interface EpisodeRecord {
    id: string;
    taskId: string;
    timestamp: string;
    taskType: 'write_chapter' | 'rewrite_chapter' | 'continue_text' | 'write_scene';
    storyId: string;
    chapterId?: string;
    beatPlanUsed?: unknown;
    draftAttempts: number;
    touchupPasses: number;
    finalCraftScore: number;
    finalWordCount: number;
    authorEdits?: AuthorEditDiff;
    lessons: string[]; // extracted insights
    styleAdjustments: Record<string, unknown>;
}

export class SessionMemory {
    public taskId: string;
    public reasoningLog: Array<{ timestamp: string; thought: string; decision: string }>;
    public scratchpad: Map<string, unknown>;
    public currentPlan: AgentPlan;
    public draftHistory: Array<{ version: number; text: string; craftScore: number; timestamp: string }>;

    constructor(taskId: string) {
        this.taskId = taskId;
        this.reasoningLog = [];
        this.scratchpad = new Map<string, unknown>();
        this.currentPlan = { steps: [], currentStepIndex: 0 };
        this.draftHistory = [];
    }

    public addReasoning(thought: string, decision: string): void {
        this.reasoningLog.push({
            timestamp: new Date().toISOString(),
            thought,
            decision
        });
    }

    public updatePlan(plan: AgentPlan): void {
        this.currentPlan = plan;
    }

    public saveDraft(version: number, text: string, craftScore: number): void {
        this.draftHistory.push({
            version,
            text,
            craftScore,
            timestamp: new Date().toISOString()
        });
    }

    public getScratchpad(key: string): unknown {
        return this.scratchpad.get(key);
    }

    public setScratchpad(key: string, value: unknown): void {
        this.scratchpad.set(key, value);
    }

    public toJSON(): Record<string, unknown> {
        return {
            taskId: this.taskId,
            reasoningLog: this.reasoningLog,
            scratchpad: Array.from(this.scratchpad.entries()),
            currentPlan: this.currentPlan,
            draftHistory: this.draftHistory
        };
    }

    public clear(): void {
        this.reasoningLog = [];
        this.scratchpad.clear();
        this.currentPlan = { steps: [], currentStepIndex: 0 };
        this.draftHistory = [];
    }
}

export class EpisodicMemory {
    private episodes: Map<string, EpisodeRecord>;

    constructor() {
        this.episodes = new Map<string, EpisodeRecord>();
    }

    public save(episode: EpisodeRecord): void {
        this.episodes.set(episode.id, episode);
    }

    public getByTask(taskId: string): EpisodeRecord | undefined {
        for (const episode of this.episodes.values()) {
            if (episode.taskId === taskId) {
                return episode;
            }
        }
        return undefined;
    }

    public getByStory(storyId: string): EpisodeRecord[] {
        const result: EpisodeRecord[] = [];
        for (const episode of this.episodes.values()) {
            if (episode.storyId === storyId) {
                result.push(episode);
            }
        }
        return result;
    }

    public getRecent(limit: number): EpisodeRecord[] {
        const sorted = Array.from(this.episodes.values()).sort((a, b) => {
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        });
        return sorted.slice(0, limit);
    }

    public getLessons(storyId?: string): string[] {
        const lessons = new Set<string>();
        for (const episode of this.episodes.values()) {
            if (!storyId || episode.storyId === storyId) {
                for (const lesson of episode.lessons) {
                    lessons.add(lesson);
                }
            }
        }
        return Array.from(lessons);
    }

    public toJSON(): Record<string, unknown> {
        return {
            episodes: Array.from(this.episodes.entries())
        };
    }

    public loadFromJSON(data: any): void {
        if (data && Array.isArray(data.episodes)) {
            this.episodes = new Map<string, EpisodeRecord>(data.episodes);
        }
    }

    public clear(): void {
        this.episodes.clear();
    }
}

/**
 * Вычисляет нормализованное расстояние Левенштейна между двумя строками (от 0 до 1).
 * 0 - строки идентичны, 1 - полностью различаются.
 */
export function normalizedLevenshtein(a: string, b: string): number {
    if (a.length === 0) return b.length === 0 ? 0 : 1;
    if (b.length === 0) return 1;

    // Оптимизация для длинных текстов: если оба > 5000 символов,
    // считаем приближенно через окна
    if (a.length > 5000 && b.length > 5000) {
        const Math_max = Math.max(a.length, b.length);
        const Math_min = Math.min(a.length, b.length);
        if (Math_max - Math_min > Math_max * 0.5) return 1; // Слишком большая разница
        
        const windowSize = 500;
        let diffCount = 0;
        for (let i = 0; i < Math_min; i += windowSize) {
            const subA = a.substring(i, i + windowSize);
            const subB = b.substring(i, i + windowSize);
            diffCount += levenshteinDist(subA, subB);
        }
        const estimatedDist = diffCount + (Math_max - Math_min);
        return Math.min(1, estimatedDist / Math_max);
    }

    const dist = levenshteinDist(a, b);
    return dist / Math.max(a.length, b.length);
}

function levenshteinDist(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}
