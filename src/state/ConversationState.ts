import { ConversationMessage } from "../models/types";
export class ConversationState {
    private readonly messages: ConversationMessage[] = [];
    addUserMessage(content: string): void {
        this.messages.push({
            role: "user",
            content,
            timestamp: Date.now()
        });
    }
    addAssistantMessage(content: string): void {
        this.messages.push({
            role: "assistant",
            content,
            timestamp: Date.now()
        });
    }
    getMessages(): ConversationMessage[] {
        return [...this.messages];
    }
    clear(): void {
        this.messages.length = 0;
    }
    getRecent(count = 10): ConversationMessage[] {
        return this.messages.slice(-count);
    }
}
