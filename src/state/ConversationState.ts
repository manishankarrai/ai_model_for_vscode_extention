import { flow } from "../utils/flowLog";

import type * as vscode from "vscode";
import type { ConversationMessage } from "../models/types";

export class ConversationState {

  private readonly storageKey = "mm3.conversation.v1";

  private readonly messages:
    ConversationMessage[] = [];

  private readonly storage?: vscode.Memento;

  constructor(storage?: vscode.Memento) {
    this.storage = storage;
    const saved = storage?.get<ConversationMessage[]>(this.storageKey) ?? [];
    this.messages.push(...saved.slice(-100));
  }

  addUserMessage(
    content: string
  ): void {

    this.messages.push({
      role: "user",

      content,

      timestamp: Date.now()
    });
    void this.persist();
  }

  addAssistantMessage(
    content: string
  ): void {

    this.messages.push({
      role: "assistant",

      content,

      timestamp: Date.now()
    });
    void this.persist();
  }

  getMessages(): ConversationMessage[] {
    flow("ConversationState.getMessages", 1, "enter");
    return [...this.messages];
  }

  clear(): void {
    flow("ConversationState.clear", 1, "enter");
    this.messages.length = 0;
    void this.persist();
  }

  getRecent(
    count = 10
  ): ConversationMessage[] {

    return this.messages.slice(
      -count
    );
  }

  private async persist(): Promise<void> {
    if (!this.storage) {
      return;
    }
    await this.storage.update(this.storageKey, this.messages.slice(-100));
  }
}