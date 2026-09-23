export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "struct"
  | "constant"
  | "variable";

export interface IndexedSymbol {
  id: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  parentName?: string;
}

export interface SymbolParser {
  supports(language: string, filePath: string): boolean;
  parse(filePath: string, language: string, content: string): IndexedSymbol[];
}

function stripStringsAndComments(line: string): string {
  return line
    .replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, "")
    .replace(/\/\/.*$/, "")
    .replace(/#.*$/, "");
}

function findBlockEnd(lines: string[], startLine: number): number {
  let depth = 0;
  let opened = false;
  for (let index = startLine - 1; index < lines.length; index += 1) {
    const line = stripStringsAndComments(lines[index]);
    for (const character of line) {
      if (character === "{") {
        opened = true;
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
      }
    }
    if (opened && depth <= 0) {
      return index + 1;
    }
  }
  return startLine;
}

function hasBlock(lines: string[], startLine: number): boolean {
  return lines
    .slice(startLine - 1)
    .some((line) => stripStringsAndComments(line).includes("{"));
}

function symbol(
  filePath: string,
  language: string,
  name: string,
  kind: SymbolKind,
  startLine: number,
  endLine: number,
  parentName?: string
): IndexedSymbol {
  const qualifiedName = parentName ? `${parentName}.${name}` : name;
  return {
    id: `${filePath}:${startLine}:${qualifiedName}`,
    name,
    qualifiedName,
    kind,
    path: filePath,
    language,
    startLine,
    endLine,
    ...(parentName ? { parentName } : {})
  };
}

function attachTypeScriptParents(symbols: IndexedSymbol[]): IndexedSymbol[] {
  const classes = symbols.filter((item) => item.kind === "class");
  return symbols.map((item) => {
    if (item.kind !== "method") {
      return item;
    }
    const parent = classes
      .filter((candidate) => candidate.startLine < item.startLine && candidate.endLine >= item.endLine)
      .sort((left, right) => (left.endLine - left.startLine) - (right.endLine - right.startLine))[0];
    return parent
      ? { ...item, parentName: parent.name, qualifiedName: `${parent.name}.${item.name}`, id: `${item.path}:${item.startLine}:${parent.name}.${item.name}` }
      : item;
  });
}

export class TypeScriptSymbolParser implements SymbolParser {
  supports(language: string, filePath: string): boolean {
    return language === "TypeScript" || /\.(?:ts|tsx|js|jsx)$/i.test(filePath);
  }

  parse(filePath: string, language: string, content: string): IndexedSymbol[] {
    const lines = content.split("\n");
    const symbols: IndexedSymbol[] = [];
    const declarationPattern = /^\s*(?:(?:export|default|declare|abstract|async)\s+)*(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
    const methodPattern = /^\s*(?:(?:public|private|protected|static|async|abstract|readonly|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\??\s*\(/;
    const variablePattern = /^\s*(?:export\s+)?(?:declare\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)/;
    const excludedMethods = new Set(["if", "for", "while", "switch", "catch", "with"]);

    lines.forEach((line, index) => {
      const startLine = index + 1;
      const declaration = line.match(declarationPattern);
      if (declaration) {
        const declarationKind = declaration[1] as "function" | "class" | "interface" | "type" | "enum";
        const kind: SymbolKind = declarationKind;
        const endLine = kind === "type" && !hasBlock(lines, startLine)
          ? startLine
          : findBlockEnd(lines, startLine);
        symbols.push(symbol(filePath, language, declaration[2], kind, startLine, endLine));
        return;
      }

      const method = line.match(methodPattern);
      if (method && !excludedMethods.has(method[1]) && /\{/.test(stripStringsAndComments(line))) {
        symbols.push(symbol(filePath, language, method[1], "method", startLine, findBlockEnd(lines, startLine)));
        return;
      }

      const variable = line.match(variablePattern);
      if (variable) {
        symbols.push(symbol(filePath, language, variable[2], variable[1] === "const" ? "constant" : "variable", startLine, startLine));
      }
    });

    return attachTypeScriptParents(symbols);
  }
}

export class GoSymbolParser implements SymbolParser {
  supports(language: string, filePath: string): boolean {
    return language === "Go" || filePath.toLowerCase().endsWith(".go");
  }

  parse(filePath: string, language: string, content: string): IndexedSymbol[] {
    const lines = content.split("\n");
    const symbols: IndexedSymbol[] = [];
    const functionPattern = /^\s*func\s*(?:\(\s*[^)]*\s+\*?([A-Za-z_]\w*)\s*\)\s*)?([A-Za-z_]\w*)\s*\(/;
    const typePattern = /^\s*type\s+([A-Za-z_]\w*)\s+(struct|interface)\b/;
    const aliasPattern = /^\s*type\s+([A-Za-z_]\w*)\s+/;
    const variablePattern = /^\s*(const|var)\s+([A-Za-z_]\w*)\b/;

    lines.forEach((line, index) => {
      const startLine = index + 1;
      const functionMatch = line.match(functionPattern);
      if (functionMatch) {
        const receiver = functionMatch[1];
        const name = functionMatch[2];
        symbols.push(symbol(
          filePath,
          language,
          name,
          receiver ? "method" : "function",
          startLine,
          findBlockEnd(lines, startLine),
          receiver
        ));
        return;
      }

      const typeMatch = line.match(typePattern);
      if (typeMatch) {
        symbols.push(symbol(filePath, language, typeMatch[1], typeMatch[2] as "struct" | "interface", startLine, findBlockEnd(lines, startLine)));
        return;
      }

      const aliasMatch = line.match(aliasPattern);
      if (aliasMatch) {
        symbols.push(symbol(filePath, language, aliasMatch[1], "type", startLine, startLine));
        return;
      }

      const variableMatch = line.match(variablePattern);
      if (variableMatch) {
        symbols.push(symbol(filePath, language, variableMatch[2], variableMatch[1] === "const" ? "constant" : "variable", startLine, startLine));
      }
    });

    return symbols;
  }
}

export class SymbolIndex {
  private readonly files = new Map<string, IndexedSymbol[]>();
  private readonly parsers: SymbolParser[];

  constructor(parsers: SymbolParser[] = [new TypeScriptSymbolParser(), new GoSymbolParser()]) {
    this.parsers = parsers;
  }

  indexFile(filePath: string, language: string, content: string): IndexedSymbol[] {
    const parser = this.parsers.find((candidate) => candidate.supports(language, filePath));
    const symbols = parser?.parse(filePath, language, content) ?? [];
    this.files.set(filePath, symbols);
    return [...symbols];
  }

  removeFile(filePath: string): void {
    this.files.delete(filePath);
  }

  getSymbols(filePath?: string): IndexedSymbol[] {
    const symbols = filePath
      ? this.files.get(filePath) ?? []
      : [...this.files.values()].flat();
    return symbols.map((item) => ({ ...item }));
  }

  find(query: string): IndexedSymbol[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    return this.getSymbols()
      .filter((item) => `${item.qualifiedName} ${item.path}`.toLowerCase().includes(normalized))
      .sort((left, right) => {
        const leftExact = left.qualifiedName.toLowerCase() === normalized ? 0 : 1;
        const rightExact = right.qualifiedName.toLowerCase() === normalized ? 0 : 1;
        return leftExact - rightExact || left.path.localeCompare(right.path) || left.startLine - right.startLine;
      });
  }

  getSymbol(query: string, filePath?: string): IndexedSymbol | undefined {
    return this.getSymbols(filePath).find((item) =>
      item.name === query || item.qualifiedName === query
    );
  }
}