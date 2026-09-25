import * as ts from "typescript";

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
  parser?: string;
  parserMode?: "ast" | "heuristic";
  startLine: number;
  endLine: number;
  parentName?: string;
}

export interface SymbolIndexSnapshot {
  version: 1;
  symbols: IndexedSymbol[];
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
    parserMode: "heuristic",
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
    const astSymbols = this.parseAst(filePath, language, content);
    if (astSymbols.length > 0) {
      return astSymbols;
    }

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

  private parseAst(filePath: string, language: string, content: string): IndexedSymbol[] {
    const scriptKind = filePath.toLowerCase().endsWith(".tsx") || filePath.toLowerCase().endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : filePath.toLowerCase().endsWith(".js") || filePath.toLowerCase().endsWith(".jsx")
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
    const symbols: IndexedSymbol[] = [];

    const add = (node: ts.Node, name: string, kind: SymbolKind, parentName?: string): void => {
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(Math.max(node.getStart(sourceFile), node.getEnd() - 1)).line + 1;
      symbols.push({
        ...symbol(filePath, language, name, kind, startLine, endLine, parentName),
        parserMode: "ast"
      });
    };

    const visit = (node: ts.Node, parentName?: string): void => {
      let nextParent = parentName;
      if (ts.isClassDeclaration(node) && node.name) {
        add(node, node.name.text, "class", parentName);
        nextParent = parentName ? `${parentName}.${node.name.text}` : node.name.text;
      } else if (ts.isInterfaceDeclaration(node)) {
        add(node, node.name.text, "interface", parentName);
        nextParent = parentName ? `${parentName}.${node.name.text}` : node.name.text;
      } else if (ts.isTypeAliasDeclaration(node)) {
        add(node, node.name.text, "type", parentName);
      } else if (ts.isEnumDeclaration(node)) {
        add(node, node.name.text, "enum", parentName);
        nextParent = parentName ? `${parentName}.${node.name.text}` : node.name.text;
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        add(node, node.name.text, "function", parentName);
      } else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        if (node.name) {
          add(node, node.name.getText(sourceFile), "method", parentName);
        }
      } else if (ts.isConstructorDeclaration(node)) {
        add(node, "constructor", "method", parentName);
      } else if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
        if (node.name) {
          add(node, node.name.getText(sourceFile), "variable", parentName);
        }
      } else if (ts.isVariableStatement(node)) {
        const kind = (node.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "constant" : "variable";
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            add(declaration, declaration.name.text, kind, parentName);
          }
        }
      }

      const childParent = ts.isMethodDeclaration(node) || ts.isMethodSignature(node) ||
        ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node) || ts.isFunctionDeclaration(node)
        ? parentName
        : nextParent;
      ts.forEachChild(node, (child) => visit(child, childParent));
    };

    visit(sourceFile);
    return symbols;
  }
}

export class JavaSymbolParser implements SymbolParser {
  supports(language: string, filePath: string): boolean {
    return language === "Java" || filePath.toLowerCase().endsWith(".java");
  }

  parse(filePath: string, language: string, content: string): IndexedSymbol[] {
    const lines = content.split("\n");
    const symbols: IndexedSymbol[] = [];
    const declarationPattern = /^\s*(?:(?:public|private|protected|abstract|final|static|sealed|non-sealed)\s+)*(class|interface|enum|record)\s+([A-Za-z_]\w*)/;
    const methodPattern = /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\s+)*(?:[A-Za-z_<>,.?\[\]]+\s+)?([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:throws\s+[^{}]+)?\{/;
    const excludedMethods = new Set(["if", "for", "while", "switch", "catch"]);

    lines.forEach((line, index) => {
      const startLine = index + 1;
      const declaration = line.match(declarationPattern);
      if (declaration) {
        const kind: SymbolKind = declaration[1] === "interface" ? "interface" : declaration[1] === "enum" ? "enum" : "class";
        symbols.push(symbol(filePath, language, declaration[2], kind, startLine, findBlockEnd(lines, startLine)));
        return;
      }
      const method = line.match(methodPattern);
      if (method && !excludedMethods.has(method[1])) {
        symbols.push(symbol(filePath, language, method[1], "method", startLine, findBlockEnd(lines, startLine)));
      }
    });

    return attachTypeScriptParents(symbols);
  }
}

export class KotlinSymbolParser implements SymbolParser {
  supports(language: string, filePath: string): boolean {
    return language === "Kotlin" || filePath.toLowerCase().endsWith(".kt");
  }

  parse(filePath: string, language: string, content: string): IndexedSymbol[] {
    const lines = content.split("\n");
    const symbols: IndexedSymbol[] = [];
    const declarationPattern = /^\s*(?:(?:public|private|protected|internal|abstract|open|data|sealed|value)\s+)*(?:(enum)\s+)?(class|interface|object)\s+([A-Za-z_]\w*)/;
    const functionPattern = /^\s*(?:(?:public|private|protected|internal|override|open|inline|suspend|operator|infix)\s+)*fun\s+(?:<[^>]+>\s*)?([A-Za-z_]\w*)\s*\(/;

    lines.forEach((line, index) => {
      const startLine = index + 1;
      const declaration = line.match(declarationPattern);
      if (declaration) {
        const kind: SymbolKind = declaration[1] === "enum" ? "enum" : declaration[2] === "interface" ? "interface" : "class";
        symbols.push(symbol(filePath, language, declaration[3], kind, startLine, findBlockEnd(lines, startLine)));
        return;
      }
      const functionMatch = line.match(functionPattern);
      if (functionMatch) {
        symbols.push(symbol(filePath, language, functionMatch[1], "function", startLine, findBlockEnd(lines, startLine)));
      }
    });

    const classes = symbols.filter((item) => item.kind === "class");
    return symbols.map((item) => {
      if (item.kind !== "function") {
        return item;
      }
      const parent = classes
        .filter((candidate) => candidate.startLine < item.startLine && candidate.endLine >= item.endLine)
        .sort((left, right) => (left.endLine - left.startLine) - (right.endLine - right.startLine))[0];
      return parent
        ? { ...item, kind: "method", parentName: parent.name, qualifiedName: `${parent.name}.${item.name}`, id: `${item.path}:${item.startLine}:${parent.name}.${item.name}` }
        : item;
    });
  }
}

export class CSharpSymbolParser implements SymbolParser {
  supports(language: string, filePath: string): boolean {
    return language === "CSharp" || filePath.toLowerCase().endsWith(".cs");
  }

  parse(filePath: string, language: string, content: string): IndexedSymbol[] {
    const lines = content.split("\n");
    const symbols: IndexedSymbol[] = [];
    const declarationPattern = /^\s*(?:(?:public|private|protected|internal|abstract|sealed|static|partial|readonly)\s+)*(class|interface|enum|struct|record)\s+([A-Za-z_]\w*)/;
    const methodPattern = /^\s*(?:(?:public|private|protected|internal|static|virtual|override|async|sealed|extern|new)\s+)*(?:[A-Za-z_<>,.?\[\]]+\s+)?([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:where\s+[^{}]+)?\{/;
    const excludedMethods = new Set(["if", "for", "while", "switch", "catch", "using"]);

    lines.forEach((line, index) => {
      const startLine = index + 1;
      const declaration = line.match(declarationPattern);
      if (declaration) {
        const kind: SymbolKind = declaration[1] === "interface" ? "interface" : declaration[1] === "enum" ? "enum" : declaration[1] === "struct" ? "struct" : "class";
        symbols.push(symbol(filePath, language, declaration[2], kind, startLine, findBlockEnd(lines, startLine)));
        return;
      }
      const method = line.match(methodPattern);
      if (method && !excludedMethods.has(method[1])) {
        symbols.push(symbol(filePath, language, method[1], "method", startLine, findBlockEnd(lines, startLine)));
      }
    });

    return attachTypeScriptParents(symbols);
  }
}

export class PHPSymbolParser implements SymbolParser {
  supports(language: string, filePath: string): boolean {
    return language === "PHP" || filePath.toLowerCase().endsWith(".php");
  }

  parse(filePath: string, language: string, content: string): IndexedSymbol[] {
    const lines = content.split("\n");
    const symbols: IndexedSymbol[] = [];
    const classes: Array<{ name: string; startLine: number; endLine: number }> = [];
    const declarationPattern = /^\s*(?:(?:abstract|final)\s+)?(class|interface|trait|enum)\s+([A-Za-z_]\w*)/;
    const functionPattern = /^\s*(?:public|protected|private|static|final|abstract)?\s*function\s+([A-Za-z_]\w*)\s*\(/;

    lines.forEach((line, index) => {
      const startLine = index + 1;
      const declaration = line.match(declarationPattern);
      if (declaration) {
        const kind: SymbolKind = declaration[1] === "interface" || declaration[1] === "trait" ? "interface" : declaration[1] === "enum" ? "enum" : "class";
        const endLine = findBlockEnd(lines, startLine);
        symbols.push(symbol(filePath, language, declaration[2], kind, startLine, endLine));
        if (kind === "class") {
          classes.push({ name: declaration[2], startLine, endLine });
        }
        return;
      }
      const functionMatch = line.match(functionPattern);
      if (functionMatch) {
        symbols.push(symbol(filePath, language, functionMatch[1], "function", startLine, findBlockEnd(lines, startLine)));
      }
    });

    return symbols.map((item) => {
      if (item.kind !== "function") {
        return item;
      }
      const parent = classes.find((candidate) => candidate.startLine < item.startLine && candidate.endLine >= item.endLine);
      return parent
        ? { ...item, kind: "method", parentName: parent.name, qualifiedName: `${parent.name}.${item.name}`, id: `${item.path}:${item.startLine}:${parent.name}.${item.name}` }
        : item;
    });
  }
}

export class GoSymbolParser implements SymbolParser {
  supports(language: string, filePath: string): boolean {
    return language === "Go" || filePath.toLowerCase().endsWith(".go");
  }

  parse(filePath: string, language: string, content: string): IndexedSymbol[] {
    const lines = content.split("\n");
    const symbols: IndexedSymbol[] = [];
    const functionPattern = /^\s*func\s*(?:\(\s*[^)]*\s+\*?([A-Za-z_]\w*)(?:\[[^\]]+\])?\s*\)\s*)?([A-Za-z_]\w*)\s*\(/;
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

export class RustSymbolParser implements SymbolParser {
  supports(language: string, filePath: string): boolean {
    return language === "Rust" || filePath.toLowerCase().endsWith(".rs");
  }

  parse(filePath: string, language: string, content: string): IndexedSymbol[] {
    const lines = content.split("\n");
    const symbols: IndexedSymbol[] = [];
    const implBlocks: Array<{ name: string; startLine: number; endLine: number }> = [];
    const declarationPattern = /^\s*(?:(?:pub(?:\([^)]*\))?|unsafe|async)\s+)*(struct|enum|trait)\s+([A-Za-z_]\w*)/;
    const functionPattern = /^\s*(?:(?:pub(?:\([^)]*\))?|unsafe|async|const)\s+)*fn\s+([A-Za-z_]\w*)\s*\(/;
    const implPattern = /^\s*impl(?:<[^>]+>)?\s+(?:[^\s{]+\s+for\s+)?([A-Za-z_]\w*)/;

    lines.forEach((line, index) => {
      const startLine = index + 1;
      const impl = line.match(implPattern);
      if (impl) {
        implBlocks.push({ name: impl[1], startLine, endLine: findBlockEnd(lines, startLine) });
      }
      const declaration = line.match(declarationPattern);
      if (declaration) {
        const kind = declaration[1] === "struct" ? "struct" : declaration[1] === "enum" ? "enum" : "interface";
        symbols.push(symbol(filePath, language, declaration[2], kind, startLine, findBlockEnd(lines, startLine)));
        return;
      }
      const functionMatch = line.match(functionPattern);
      if (functionMatch) {
        symbols.push(symbol(filePath, language, functionMatch[1], "function", startLine, findBlockEnd(lines, startLine)));
      }
    });

    return symbols.map((item) => {
      if (item.kind !== "function") {
        return item;
      }
      const parent = implBlocks
        .filter((candidate) => candidate.startLine < item.startLine && candidate.endLine >= item.endLine)
        .sort((left, right) => (left.endLine - left.startLine) - (right.endLine - right.startLine))[0];
      return parent
        ? { ...item, kind: "method", parentName: parent.name, qualifiedName: `${parent.name}.${item.name}`, id: `${item.path}:${item.startLine}:${parent.name}.${item.name}` }
        : item;
    });
  }
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function findIndentedBlockEnd(lines: string[], startLine: number): number {
  const baseIndent = indentation(lines[startLine - 1]);
  let endLine = startLine;
  for (let index = startLine; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      const nextCodeLine = lines.slice(index + 1).find((candidate) => candidate.trim());
      if (nextCodeLine && indentation(nextCodeLine) <= baseIndent) {
        break;
      }
      endLine = index + 1;
      continue;
    }
    if (indentation(line) <= baseIndent) {
      break;
    }
    endLine = index + 1;
  }
  return endLine;
}

export class PythonSymbolParser implements SymbolParser {
  supports(language: string, filePath: string): boolean {
    return language === "Python" || filePath.toLowerCase().endsWith(".py");
  }

  parse(filePath: string, language: string, content: string): IndexedSymbol[] {
    const lines = content.split("\n");
    const symbols: IndexedSymbol[] = [];
    const declarationPattern = /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)\s*\(/;
    const classPattern = /^\s*class\s+([A-Za-z_]\w*)\b/;

    lines.forEach((line, index) => {
      const startLine = index + 1;
      const declaration = line.match(declarationPattern) ?? line.match(classPattern);
      if (!declaration) {
        return;
      }
      const kind: SymbolKind = declaration[1] === "class" ? "class" : declaration[1] === "def" ? "function" : "class";
      const name = declaration[2] ?? declaration[1];
      symbols.push(symbol(filePath, language, name, kind, startLine, findIndentedBlockEnd(lines, startLine)));
    });

    const classes = symbols.filter((item) => item.kind === "class");
    return symbols.map((item) => {
      if (item.kind !== "function") {
        return item;
      }
      const parent = classes
        .filter((candidate) => candidate.startLine < item.startLine && candidate.endLine >= item.endLine)
        .sort((left, right) => (left.endLine - left.startLine) - (right.endLine - right.startLine))[0];
      return parent
        ? { ...item, kind: "method", parentName: parent.name, qualifiedName: `${parent.name}.${item.name}`, id: `${item.path}:${item.startLine}:${parent.name}.${item.name}` }
        : item;
    });
  }
}

export class SymbolIndex {
  private readonly files = new Map<string, IndexedSymbol[]>();
  private readonly parsers: SymbolParser[];

  constructor(parsers: SymbolParser[] = [new TypeScriptSymbolParser(), new JavaSymbolParser(), new KotlinSymbolParser(), new CSharpSymbolParser(), new PHPSymbolParser(), new GoSymbolParser(), new RustSymbolParser(), new PythonSymbolParser()]) {
    this.parsers = parsers;
  }

  indexFile(filePath: string, language: string, content: string): IndexedSymbol[] {
    const parser = this.parsers.find((candidate) => candidate.supports(language, filePath));
    const symbols = (parser?.parse(filePath, language, content) ?? []).map((item) => ({
      ...item,
      parser: parser?.constructor.name
    }));
    this.files.set(filePath, symbols);
    return [...symbols];
  }

  removeFile(filePath: string): void {
    this.files.delete(filePath);
  }

  clear(): void {
    this.files.clear();
  }

  snapshot(): SymbolIndexSnapshot {
    return {
      version: 1,
      symbols: this.getSymbols()
    };
  }

  restore(snapshot: SymbolIndexSnapshot): void {
    this.clear();
    if (snapshot.version !== 1 || !Array.isArray(snapshot.symbols)) {
      return;
    }
    for (const item of snapshot.symbols) {
      if (item && typeof item.path === "string" && typeof item.name === "string") {
        const existing = this.files.get(item.path) ?? [];
        this.files.set(item.path, [...existing, {
          ...item,
          ...(typeof item.parser === "string" ? { parser: item.parser } : {})
        }]);
      }
    }
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