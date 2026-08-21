export type DiffKind = "equal" | "added" | "removed";

export interface DiffBlock {
  kind: DiffKind;
  text: string;
}

function splitParagraphs(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split(/\n{2,}/u);
}

export function diffParagraphs(original: string, revised: string): DiffBlock[] {
  const left = splitParagraphs(original);
  const right = splitParagraphs(revised);

  if (left.length * right.length > 40_000) {
    return original === revised
      ? [{ kind: "equal", text: original }]
      : [{ kind: "removed", text: original }, { kind: "added", text: revised }];
  }

  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result: DiffBlock[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.push({ kind: "equal", text: left[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ kind: "removed", text: left[i] });
      i += 1;
    } else {
      result.push({ kind: "added", text: right[j] });
      j += 1;
    }
  }
  while (i < left.length) result.push({ kind: "removed", text: left[i++] });
  while (j < right.length) result.push({ kind: "added", text: right[j++] });
  return result;
}
