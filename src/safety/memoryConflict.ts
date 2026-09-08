import { flow } from "../utils/flowLog.ts";

export type MemoryFactKind =
  | "finding"
  | "dependency"
  | "convention"
  | "architecture"
  | "decision";

export interface MemoryFact {
  kind: MemoryFactKind;
  content: string;
  source: "local" | "backend";
}

export type MemoryConflictResolution =
  | "keep_local"
  | "prefer_backend"
  | "keep_both";

export interface MemoryConflict {
  kind: MemoryFactKind;
  local: string;
  backend: string;
  resolution: MemoryConflictResolution;
  resolved: string[];
}

function normalize(value: string): string {
  flow("normalize", 1, "enter");
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function sameFact(left: string, right: string): boolean {
  flow("sameFact", 1, "enter");
  return normalize(left) === normalize(right);
}

/**
 * Resolve disagreements between local project memory and backend facts.
 * Default keeps both when wording differs so nothing is silently dropped.
 */
export function resolveMemoryConflicts(
  localFacts: MemoryFact[],
  backendFacts: MemoryFact[],
  preference: MemoryConflictResolution = "keep_both"
): {
  merged: MemoryFact[];
  conflicts: MemoryConflict[];
} {
  const conflicts: MemoryConflict[] = [];
  const merged: MemoryFact[] = [];
  const kinds = new Set([
    ...localFacts.map((fact) => fact.kind),
    ...backendFacts.map((fact) => fact.kind)
  ]);

  for (const kind of kinds) {
    const local = localFacts.filter((fact) => fact.kind === kind);
    const backend = backendFacts.filter((fact) => fact.kind === kind);

    for (const localFact of local) {
      const clash = backend.find(
        (candidate) =>
          !sameFact(candidate.content, localFact.content) &&
          normalize(candidate.content).includes(normalize(localFact.content).slice(0, 24))
      ) ?? backend.find(
        (candidate) =>
          !sameFact(candidate.content, localFact.content) &&
          overlappingTokens(localFact.content, candidate.content)
      );

      if (!clash) {
        merged.push(localFact);
        continue;
      }

      const resolved = resolvePair(localFact.content, clash.content, preference);
      conflicts.push({
        kind,
        local: localFact.content,
        backend: clash.content,
        resolution: preference,
        resolved
      });

      for (const content of resolved) {
        if (!merged.some((item) => item.kind === kind && sameFact(item.content, content))) {
          merged.push({
            kind,
            content,
            source: preference === "prefer_backend" ? "backend" : "local"
          });
        }
      }
    }

    for (const backendFact of backend) {
      if (merged.some((item) => item.kind === kind && sameFact(item.content, backendFact.content))) {
        continue;
      }
      if (conflicts.some((conflict) =>
        conflict.kind === kind && sameFact(conflict.backend, backendFact.content)
      )) {
        continue;
      }
      merged.push(backendFact);
    }
  }

  return { merged, conflicts };
}

function overlappingTokens(left: string, right: string): boolean {
  flow("overlappingTokens", 1, "enter");
  const leftTokens = new Set(normalize(left).split(" ").filter((token) => token.length > 3));
  const rightTokens = normalize(right).split(" ").filter((token) => token.length > 3);
  if (leftTokens.size === 0 || rightTokens.length === 0) {
    return false;
  }
  const overlap = rightTokens.filter((token) => leftTokens.has(token)).length;
  return overlap >= Math.min(3, leftTokens.size);
}

function resolvePair(
  local: string,
  backend: string,
  preference: MemoryConflictResolution
): string[] {
  if (preference === "keep_local") {
    return [local];
  }
  if (preference === "prefer_backend") {
    return [backend];
  }
  return [local, backend];
}

export function formatConflictSummary(conflicts: MemoryConflict[]): string {
  flow("formatConflictSummary", 1, "enter");
  if (conflicts.length === 0) {
    return "No memory conflicts.";
  }

  return conflicts.map((conflict) =>
    `[${conflict.kind}] local="${conflict.local}" backend="${conflict.backend}" -> ${conflict.resolution}`
  ).join("\n");
}
