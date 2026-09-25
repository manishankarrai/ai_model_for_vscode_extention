import type { ContextManagerResult } from "./ContextManager.ts";
import type * as vscode from "vscode";

export interface ContextCacheStore {
  get(key: string): ContextManagerResult | undefined;
  set(key: string, value: ContextManagerResult): void;
  delete(key: string): void;
  clear(): void;
}

export class MemoryContextCacheStore implements ContextCacheStore {
  private readonly values = new Map<string, ContextManagerResult>();

  get(key: string): ContextManagerResult | undefined {
    return this.values.get(key);
  }

  set(key: string, value: ContextManagerResult): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

export class MementoContextCacheStore implements ContextCacheStore {
  private readonly indexKey = "mm3.contextCache.keys";
  private readonly memento: vscode.Memento;

  constructor(memento: vscode.Memento) {
    this.memento = memento;
  }

  get(key: string): ContextManagerResult | undefined {
    return this.memento.get<ContextManagerResult>(this.storageKey(key));
  }

  set(key: string, value: ContextManagerResult): void {
    const keys = new Set(this.memento.get<string[]>(this.indexKey, []));
    keys.add(key);
    void this.memento.update(this.indexKey, [...keys]);
    void this.memento.update(this.storageKey(key), value);
  }

  delete(key: string): void {
    const keys = new Set(this.memento.get<string[]>(this.indexKey, []));
    keys.delete(key);
    void this.memento.update(this.indexKey, [...keys]);
    void this.memento.update(this.storageKey(key), undefined);
  }

  clear(): void {
    const keys = this.memento.get<string[]>(this.indexKey, []);
    void this.memento.update(this.indexKey, []);
    for (const key of keys) {
      void this.memento.update(this.storageKey(key), undefined);
    }
  }

  private storageKey(key: string): string {
    return `mm3.contextCache.${key}`;
  }
}