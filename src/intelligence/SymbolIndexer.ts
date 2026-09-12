import * as vscode from "vscode";
import { ProjectFile, SymbolInfo } from "../models/types";
export class SymbolIndexer {
    async indexFile(file: ProjectFile): Promise<SymbolInfo[]> {
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file.absolutePath));
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", document.uri);
            if (!symbols) {
                return [];
            }
            const result: SymbolInfo[] = [];
            this.flatten(symbols, file.path, result);
            return result;
        }
        catch {
            return [];
        }
    }
    private flatten(symbols: vscode.DocumentSymbol[], filePath: string, result: SymbolInfo[]): void {
        for (const symbol of symbols) {
            result.push({
                name: symbol.name,
                kind: vscode.SymbolKind[symbol.kind] ?? "unknown",
                filePath,
                line: symbol.range.start.line + 1,
                character: symbol.range.start.character
            });
            if (symbol.children.length > 0) {
                this.flatten(symbol.children, filePath, result);
            }
        }
    }
}
