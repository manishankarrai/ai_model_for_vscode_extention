export interface DiffLine {
    type: "context" | "removed" | "added";
    text: string;
}
export function previewDiff(original: string, updated: string): DiffLine[] {
    if (original === updated) {
        return [];
    }
    const left = original.split("\n");
    const right = updated.split("\n");
    const table = lcsTable(left, right);
    const lines: DiffLine[] = [];
    walk(left, right, table, left.length, right.length, lines);
    return lines;
}
function lcsTable(left: string[], right: string[]): number[][] {
    const table: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = 1; i <= left.length; i++) {
        for (let j = 1; j <= right.length; j++) {
            table[i][j] = left[i - 1] === right[j - 1]
                ? table[i - 1][j - 1] + 1
                : Math.max(table[i - 1][j], table[i][j - 1]);
        }
    }
    return table;
}
function walk(left: string[], right: string[], table: number[][], i: number, j: number, lines: DiffLine[]): void {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) {
        walk(left, right, table, i - 1, j - 1, lines);
        lines.push({ type: "context", text: left[i - 1] });
        return;
    }
    if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
        walk(left, right, table, i, j - 1, lines);
        lines.push({ type: "added", text: right[j - 1] });
        return;
    }
    if (i > 0 && (j === 0 || table[i][j - 1] < table[i - 1][j])) {
        walk(left, right, table, i - 1, j, lines);
        lines.push({ type: "removed", text: left[i - 1] });
    }
}
