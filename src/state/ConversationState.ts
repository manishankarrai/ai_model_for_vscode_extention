import { flow } from "../utils/flowLog";

import {
  ConversationMessage,
  MAX_CONVERSATION_HISTORY
} from "../models/types";

export class ConversationState {

  private readonly messages:
    ConversationMessage[] = [];

  addUserMessage(
    content: string
  ): void {

    this.messages.push({
      role: "user",

      content,

      timestamp: Date.now()
    });
  }

  addAssistantMessage(
    content: string
  ): void {

    this.messages.push({
      role: "assistant",

      content,

      timestamp: Date.now()
    });
  }

  getMessages(): ConversationMessage[] {
    flow("ConversationState.getMessages", 1, "enter");
    return [...this.messages];
  }

  clear(): void {
    flow("ConversationState.clear", 1, "enter");
    this.messages.length = 0;
  }

  getRecent(
    count = MAX_CONVERSATION_HISTORY
  ): ConversationMessage[] {

    return this.messages.slice(
      -Math.min(count, MAX_CONVERSATION_HISTORY)
    );
  }
}