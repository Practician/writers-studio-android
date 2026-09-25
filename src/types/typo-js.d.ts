declare module "typo-js" {
  export default class Typo {
    constructor(dictionary?: string, affData?: string, wordsData?: string, settings?: Record<string, unknown>);
    check(word: string): boolean;
    suggest(word: string, limit?: number): string[];
  }
}
