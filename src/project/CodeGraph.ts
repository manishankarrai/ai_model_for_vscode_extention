export type CodeNodeKind = "file" | "symbol" | "route" | "test" | "dependency" | "data";

export type CodeEdgeKind = "reference" | "import" | "call" | "test" | "route" | "read" | "write";

export interface CodeGraphNode {
  id: string;
  kind: CodeNodeKind;
  label: string;
  path?: string;
}

export interface CodeGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: CodeEdgeKind;
  line?: number;
  provenance?: string;
  confidence?: number;
  resolvedPath?: string;
}

export interface CodeGraphSnapshot {
  version: 1;
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
}

export interface GraphSymbol {
  qualifiedName: string;
  path: string;
  kind: string;
}

export interface GraphRelationship {
  from: string;
  to: string;
  kind: CodeEdgeKind;
  line?: number;
  provenance?: string;
  confidence?: number;
  resolvedPath?: string;
  sourcePath?: string;
}

export interface CodeGraphTraversalOptions {
  maxDepth?: number;
  edgeKinds?: CodeEdgeKind[];
}

export class CodeGraph {
  private nodes = new Map<string, CodeGraphNode>();
  private edges: CodeGraphEdge[] = [];

  rebuild(relationships: GraphRelationship[], symbols: GraphSymbol[]): void {
    this.nodes.clear();
    this.edges = [];
    for (const symbol of symbols) {
      this.addNode({
        id: `symbol:${symbol.qualifiedName}`,
        kind: "symbol",
        label: symbol.qualifiedName,
        path: symbol.path
      });
      this.addNode({ id: `file:${symbol.path}`, kind: "file", label: symbol.path, path: symbol.path });
      this.addEdge({
        id: `contains:${symbol.path}:${symbol.qualifiedName}`,
        from: `file:${symbol.path}`,
        to: `symbol:${symbol.qualifiedName}`,
        kind: "reference",
        confidence: 1
      });
    }
    for (const relationship of relationships) {
      const from = this.nodeId(relationship.from, relationship.sourcePath);
      const to = this.nodeId(relationship.to, relationship.resolvedPath);
      this.addNode({ id: from, kind: this.kindFor(relationship.kind), label: relationship.from, path: relationship.sourcePath });
      this.addNode({ id: to, kind: this.kindFor(relationship.kind), label: relationship.to, path: relationship.resolvedPath });
      this.addEdge({
        id: `${relationship.kind}:${from}:${to}:${relationship.line ?? 0}`,
        from,
        to,
        kind: relationship.kind,
        line: relationship.line,
        provenance: relationship.provenance,
        confidence: relationship.confidence,
        resolvedPath: relationship.resolvedPath
      });
    }
  }

  snapshot(): CodeGraphSnapshot {
    return {
      version: 1,
      nodes: [...this.nodes.values()].map((node) => ({ ...node })),
      edges: this.edges.map((edge) => ({ ...edge }))
    };
  }

  affectedBy(paths: string[]): CodeGraphNode[] {
    const pathSet = new Set(paths);
    const affected = new Set<string>();
    for (const node of this.nodes.values()) {
      if (node.path && pathSet.has(node.path)) {
        affected.add(node.id);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of this.edges) {
        if (affected.has(edge.from) && !affected.has(edge.to)) {
          affected.add(edge.to);
          changed = true;
        }
      }
    }
    return [...affected].map((id) => this.nodes.get(id)).filter((node): node is CodeGraphNode => Boolean(node));
  }

  traverse(paths: string[], options: CodeGraphTraversalOptions = {}): CodeGraphNode[] {
    const pathSet = new Set(paths);
    const allowedKinds = options.edgeKinds ? new Set(options.edgeKinds) : undefined;
    const maxDepth = Math.max(0, options.maxDepth ?? 2);
    const distance = new Map<string, number>();
    for (const node of this.nodes.values()) {
      if (node.path && pathSet.has(node.path)) {
        distance.set(node.id, 0);
      }
    }
    const queue = [...distance.keys()];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDepth = distance.get(current) ?? 0;
      if (currentDepth >= maxDepth) {
        continue;
      }
      for (const edge of this.edges) {
        if (edge.from !== current || allowedKinds && !allowedKinds.has(edge.kind) || distance.has(edge.to)) {
          continue;
        }
        distance.set(edge.to, currentDepth + 1);
        queue.push(edge.to);
      }
    }
    return [...distance.keys()].map((id) => this.nodes.get(id)).filter((node): node is CodeGraphNode => Boolean(node));
  }

  private addNode(node: CodeGraphNode): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node);
    }
  }

  private addEdge(edge: CodeGraphEdge): void {
    if (!this.edges.some((candidate) => candidate.id === edge.id)) {
      this.edges.push(edge);
    }
  }

  private nodeId(label: string, path?: string): string {
    if (path && label === path) {
      return `file:${path}`;
    }
    return path ? `file:${path}:${label}` : `symbol:${label}`;
  }

  private kindFor(edge: CodeEdgeKind): CodeNodeKind {
    if (edge === "route") {
      return "route";
    }
    if (edge === "test") {
      return "test";
    }
    if (edge === "import") {
      return "dependency";
    }
    if (edge === "read" || edge === "write") {
      return "data";
    }
    return "symbol";
  }
}
