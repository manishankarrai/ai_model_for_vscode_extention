export function containsExecutableSymbolReference(
  content: string,
  symbolName: string
): boolean {
  if (!symbolName.trim()) {
    return false;
  }

  const code = content
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*import\s+[\s\S]*?;?$/gm, "");
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return [
    new RegExp(`\\b${escaped}\\s*\\(`),
    new RegExp(`(?:\\.|\\bnew\\s+|\\bextends\\s+|\\bimplements\\s+|\\btype\\s+|\\binterface\\s+)${escaped}\\b`),
    new RegExp(`\\b${escaped}\\s*[<{]`)
  ].some((pattern) => pattern.test(code));
}