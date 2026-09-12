import * as vscode from "vscode";
import { ProjectIndex } from "../models/types";
export class IndexState {
    private readonly key = "mm3.index.metadata";
    constructor(private readonly storage: vscode.Memento) { }
    async save(index: ProjectIndex): Promise<void> {
        await this.storage.update(this.key, {
            rootPath: index.rootPath,
            version: index.version,
            fileCount: index.files.size,
            updatedAt: index.updatedAt
        });
    }
    getMetadata(): unknown {
        return this.storage.get(this.key);
    }
    async clear(): Promise<void> {
        await this.storage.update(this.key, undefined);
    }
}
