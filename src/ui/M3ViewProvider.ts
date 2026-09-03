
import * as vscode from "vscode";

import { Agent } from "../agent/Agent";
import { Logger } from "../utils/Logger";
import {
  AIResponse,
  AIUsage,
} from "../models/types";

export class M3ViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "m3.chat";

  private view?: vscode.WebviewView;

  private isProcessing = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agent: Agent,
    private readonly logger: Logger,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,

      localResourceRoots: [
        this.extensionUri,
      ],
    };

    webviewView.webview.html =
      this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        try {
          await this.handleMessage(message);
        } catch (error) {
          this.logger.error(
            "Webview message handling failed",
            error
          );

          this.post({
            type: "error",
            error:
              "Something went wrong while processing your request.",
          });
        }
      },
      undefined
    );
  }

  show(): void {
    this.view?.show?.(true);
  }

  private async handleMessage(
    message: WebviewMessage
  ): Promise<void> {
    switch (message.type) {
      case "send_message":
        await this.handleQuestion(message.value);
        break;

      case "clear":
        this.agent.clearConversation();

        this.post({
          type: "cleared",
        });

        break;

      case "open_output":
        this.logger.show();
        break;

      default:
        break;
    }
  }

  private async handleQuestion(
    question: string
  ): Promise<void> {
    const trimmedQuestion =
      question.trim();

    if (!trimmedQuestion) {
      return;
    }

    if (this.isProcessing) {
      this.post({
        type: "error",
        error:
          "M3 is already processing another request.",
      });

      return;
    }

    this.isProcessing = true;

    this.post({
      type: "thinking",
    });

    try {
      const accessToken =
        await this.getAccessToken();

      if (!accessToken) {
        throw new AuthenticationError(
          "M3 authentication required."
        );
      }

      const response: AIResponse =
        await this.agent.process(
          trimmedQuestion,
          accessToken
        );

      this.post({
        type: "answer",
        answer: response.answer,
        usage: response.usage,
        requestId: response.request_id,
        model: response.model,
      });

    } catch (error) {

      const message =
        this.getErrorMessage(error);

      this.post({
        type: "error",
        error: message,
      });

      this.logger.error(
        "M3 request failed",
        error
      );

    } finally {

      this.isProcessing = false;

      this.post({
        type: "ready",
      });
    }
  }

  private getErrorMessage(
    error: unknown
  ): string {

    if (
      error instanceof AuthenticationError
    ) {
      return error.message;
    }

    if (
      error instanceof Error
    ) {
      return error.message;
    }

    return "An unexpected error occurred.";
  }

  private post(
    message: WebviewResponse
  ): void {

    if (!this.view) {
      return;
    }

    void this.view.webview.postMessage(
      message
    );
  }

  private getHtml(
    webview: vscode.Webview
  ): string {

    const nonce =
      this.getNonce();

    const cspSource =
      webview.cspSource;

    return `
<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  http-equiv="Content-Security-Policy"
  content="
    default-src 'none';
    style-src 'unsafe-inline' ${cspSource};
    script-src 'nonce-${nonce}';
  "
>

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>M3 AI Agent</title>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;

  margin: 0;
  padding: 0;
}

body {
  color:
    var(--vscode-foreground);

  background:
    var(--vscode-sideBar-background);

  font-family:
    var(--vscode-font-family);

  font-size:
    var(--vscode-font-size);

  overflow: hidden;
}

.container {
  display: flex;

  flex-direction: column;

  height: 100vh;
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

.header {
  display: flex;

  align-items: center;

  justify-content: space-between;

  padding: 10px 12px;

  border-bottom:
    1px solid
    var(--vscode-panel-border);

  font-weight: 600;

  user-select: none;
}

.header-title {
  display: flex;

  align-items: center;

  gap: 6px;
}

.model {
  margin-left: auto;

  font-size: 10px;

  opacity: 0.5;

  font-weight: normal;
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

.messages {
  flex: 1;

  overflow-y: auto;

  padding: 12px;

  scroll-behavior: smooth;
}

.message {
  margin-bottom: 12px;

  padding: 10px 12px;

  border-radius: 8px;

  word-break: break-word;

  line-height: 1.5;
}

.user {
  background:
    var(--vscode-textBlockQuote-background);

  border:
    1px solid
    var(--vscode-textBlockQuote-border);

  white-space: pre-wrap;
}

.assistant {
  background:
    var(--vscode-editor-background);

  border:
    1px solid
    var(--vscode-panel-border);

  white-space: normal;
}

.error {
  background:
    var(--vscode-inputValidation-errorBackground);

  color:
    var(--vscode-inputValidation-errorForeground);

  border:
    1px solid
    var(--vscode-inputValidation-errorBorder);

  white-space: pre-wrap;
}

/* -------------------------------------------------------------------------- */
/* Markdown                                                                   */
/* -------------------------------------------------------------------------- */

.markdown {
  width: 100%;
}

.markdown p {
  margin:
    0 0 10px 0;
}

.markdown p:last-child {
  margin-bottom: 0;
}

.markdown h1,
.markdown h2,
.markdown h3,
.markdown h4 {
  margin-top: 16px;

  margin-bottom: 8px;

  line-height: 1.3;
}

.markdown h1 {
  font-size: 1.35em;
}

.markdown h2 {
  font-size: 1.2em;
}

.markdown h3 {
  font-size: 1.08em;
}

.markdown h4 {
  font-size: 1em;
}

.markdown strong {
  font-weight: 700;
}

.markdown em {
  font-style: italic;
}

.markdown code.inline-code {
  padding:
    2px 5px;

  border-radius: 4px;

  background:
    var(--vscode-textCodeBlock-background);

  color:
    var(--vscode-textPreformat-foreground);

  font-family:
    var(--vscode-editor-font-family);

  font-size: 0.9em;
}

.markdown ul,
.markdown ol {
  margin-top: 6px;

  margin-bottom: 10px;

  padding-left: 24px;
}

.markdown li {
  margin-bottom: 4px;
}

.markdown hr {
  border: none;

  border-top:
    1px solid
    var(--vscode-panel-border);

  margin:
    14px 0;
}

/* -------------------------------------------------------------------------- */
/* Code blocks                                                                */
/* -------------------------------------------------------------------------- */

.code-block {
  margin:
    12px 0;

  border:
    1px solid
    var(--vscode-panel-border);

  border-radius: 6px;

  overflow: hidden;

  background:
    var(--vscode-textCodeBlock-background);
}

.code-header {
  display: flex;

  align-items: center;

  justify-content: space-between;

  min-height: 30px;

  padding:
    4px 8px;

  border-bottom:
    1px solid
    var(--vscode-panel-border);

  background:
    var(--vscode-editorGroupHeader-tabsBackground);

  font-size: 11px;

  opacity: 0.9;
}

.code-language {
  font-family:
    var(--vscode-editor-font-family);

  text-transform: lowercase;

  opacity: 0.8;
}

.copy-button {
  min-height: 24px;

  padding:
    3px 8px;

  border:
    1px solid
    var(--vscode-button-border);

  border-radius: 4px;

  color:
    var(--vscode-button-secondaryForeground);

  background:
    var(--vscode-button-secondaryBackground);

  cursor: pointer;

  font-size: 11px;
}

.copy-button:hover {
  background:
    var(--vscode-button-secondaryHoverBackground);
}

.code-content {
  display: block;

  margin: 0;

  padding: 10px 12px;

  overflow-x: auto;

  white-space: pre;

  font-family:
    var(--vscode-editor-font-family);

  font-size:
    var(--vscode-editor-font-size);

  line-height: 1.45;

  color:
    var(--vscode-editor-foreground);
}

.code-content code {
  font-family:
    inherit;
}

/* -------------------------------------------------------------------------- */
/* Usage                                                                      */
/* -------------------------------------------------------------------------- */

.usage {
  margin-top: -6px;

  margin-bottom: 12px;

  padding-left: 4px;

  font-size: 10px;

  opacity: 0.6;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

.status {
  padding:
    5px 10px;

  font-size: 11px;

  opacity: 0.7;

  min-height: 24px;
}

/* -------------------------------------------------------------------------- */
/* Composer                                                                   */
/* -------------------------------------------------------------------------- */

.composer {
  display: flex;

  align-items: flex-end;

  gap: 8px;

  padding: 10px;

  border-top:
    1px solid
    var(--vscode-panel-border);
}

textarea {
  flex: 1;

  resize: none;

  min-height: 42px;

  max-height: 150px;

  padding:
    8px 10px;

  color:
    var(--vscode-input-foreground);

  background:
    var(--vscode-input-background);

  border:
    1px solid
    var(--vscode-input-border);

  border-radius: 5px;

  outline: none;

  font-family:
    var(--vscode-font-family);

  font-size:
    var(--vscode-font-size);

  line-height: 1.4;
}

textarea:focus {
  border-color:
    var(--vscode-focusBorder);
}

textarea:disabled {
  opacity: 0.6;

  cursor: not-allowed;
}

button {
  min-height: 42px;

  border: none;

  border-radius: 5px;

  padding:
    8px 14px;

  color:
    var(--vscode-button-foreground);

  background:
    var(--vscode-button-background);

  cursor: pointer;

  font-family:
    var(--vscode-font-family);

  font-size:
    var(--vscode-font-size);
}

button:hover:not(:disabled) {
  background:
    var(--vscode-button-hoverBackground);
}

button:disabled {
  opacity: 0.5;

  cursor: not-allowed;
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

.empty {
  display: flex;

  align-items: center;

  justify-content: center;

  height: 100%;

  text-align: center;

  opacity: 0.5;

  padding: 20px;
}

</style>

</head>

<body>

<div class="container">

  <div class="header">

    <div class="header-title">

      <span>
        M3 AI Agent
      </span>

      <span
        id="model"
        class="model"
      ></span>

    </div>

  </div>

  <div
    id="messages"
    class="messages"
  >

    <div
      id="empty"
      class="empty"
    >
      Ask M3 about your project.
    </div>

  </div>

  <div
    id="status"
    class="status"
  >
    Ready
  </div>

  <div class="composer">

    <textarea
      id="input"
      rows="1"
      placeholder="Ask M3 about your project..."
      aria-label="Ask M3"
    ></textarea>

    <button
      id="send"
      type="button"
    >
      Send
    </button>

  </div>

</div>

<script nonce="${nonce}">

const vscode =
  acquireVsCodeApi();

const input =
  document.getElementById("input");

const send =
  document.getElementById("send");

const messages =
  document.getElementById("messages");

const status =
  document.getElementById("status");

const model =
  document.getElementById("model");

const empty =
  document.getElementById("empty");

let processing = false;

/* -------------------------------------------------------------------------- */
/* HTML escaping                                                              */
/* -------------------------------------------------------------------------- */

function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* -------------------------------------------------------------------------- */
/* Inline Markdown                                                            */
/* -------------------------------------------------------------------------- */

function renderInlineMarkdown(text) {

  let value =
    escapeHtml(text);

  const inlineCodes = [];

  value =
    value.replace(
      /\`([^\`]+)\`/g,
      (_, code) => {

        const index =
          inlineCodes.length;

        inlineCodes.push(
          '<code class="inline-code">' +
          code +
          '</code>'
        );

        return (
          "___M3_INLINE_CODE_" +
          index +
          "___"
        );
      }
    );

  value =
    value.replace(
      /\\*\\*([^*]+)\\*\\*/g,
      "<strong>$1</strong>"
    );

  value =
    value.replace(
      /\\*([^*]+)\\*/g,
      "<em>$1</em>"
    );

  value =
    value.replace(
      /___M3_INLINE_CODE_(\\d+)___/g,
      (_, index) =>
        inlineCodes[
          Number(index)
        ]
    );

  return value;
}

/* -------------------------------------------------------------------------- */
/* Markdown renderer                                                          */
/* -------------------------------------------------------------------------- */

function renderMarkdown(markdown) {

  const text =
    String(markdown ?? "")
      .replace(/\\r\\n/g, "\\n")
      .replace(/\\r/g, "\\n");

  const codeBlocks = [];

  const withoutCode =
    text.replace(
      /\`\`\`([a-zA-Z0-9_+#.-]*)\\n([\\s\\S]*?)\`\`\`/g,
      (_, language, code) => {

        const index =
          codeBlocks.length;

        codeBlocks.push({
          language:
            language || "code",

          code:
            code.replace(/\\n$/, "")
        });

        return (
          "\\n___M3_CODE_BLOCK_" +
          index +
          "___\\n"
        );
      }
    );

  const lines =
    withoutCode.split("\\n");

  const output = [];

  let paragraph = [];

  let listType = null;

  function flushParagraph() {

    if (
      paragraph.length === 0
    ) {
      return;
    }

    const content =
      paragraph
        .join("\\n")
        .trim();

    if (content) {

      output.push(
        "<p>" +
        renderInlineMarkdown(
          content
        ).replace(/\\n/g, "<br>") +
        "</p>"
      );
    }

    paragraph = [];
  }

  function closeList() {

    if (!listType) {
      return;
    }

    output.push(
      "</" +
      listType +
      ">"
    );

    listType = null;
  }

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const line =
      lines[i];

    const trimmed =
      line.trim();

    if (!trimmed) {

      flushParagraph();

      closeList();

      continue;
    }

    const codeMatch =
      trimmed.match(
        /^___M3_CODE_BLOCK_(\\d+)___$/
      );

    if (codeMatch) {

      flushParagraph();

      closeList();

      const codeBlock =
        codeBlocks[
          Number(codeMatch[1])
        ];

      if (codeBlock) {

        output.push(
          createCodeBlock(
            codeBlock.language,
            codeBlock.code
          )
        );
      }

      continue;
    }

    const headingMatch =
      line.match(
        /^\\s*(#{1,4})\\s+(.+?)\\s*$/
      );

    if (headingMatch) {

      flushParagraph();

      closeList();

      const level =
        headingMatch[1].length;

      output.push(
        "<h" +
        level +
        ">" +
        renderInlineMarkdown(
          headingMatch[2]
        ) +
        "</h" +
        level +
        ">"
      );

      continue;
    }

    if (
      /^\\s*(---+|\\*\\*\\*+)\\s*$/.test(line)
    ) {

      flushParagraph();

      closeList();

      output.push(
        "<hr>"
      );

      continue;
    }

    const unorderedMatch =
      line.match(
        /^\\s*[-*]\\s+(.+)$/
      );

    if (unorderedMatch) {

      flushParagraph();

      if (listType !== "ul") {

        closeList();

        output.push("<ul>");

        listType = "ul";
      }

      output.push(
        "<li>" +
        renderInlineMarkdown(
          unorderedMatch[1]
        ) +
        "</li>"
      );

      continue;
    }

    const orderedMatch =
      line.match(
        /^\\s*\\d+[.)]\\s+(.+)$/
      );

    if (orderedMatch) {

      flushParagraph();

      if (listType !== "ol") {

        closeList();

        output.push("<ol>");

        listType = "ol";
      }

      output.push(
        "<li>" +
        renderInlineMarkdown(
          orderedMatch[1]
        ) +
        "</li>"
      );

      continue;
    }

    closeList();

    paragraph.push(line);
  }

  flushParagraph();

  closeList();

  return output.join("");
}

/* -------------------------------------------------------------------------- */
/* Code block                                                                 */
/* -------------------------------------------------------------------------- */

function createCodeBlock(
  language,
  code
) {

  const wrapper =
    document.createElement("div");

  wrapper.className =
    "code-block";

  const header =
    document.createElement("div");

  header.className =
    "code-header";

  const languageElement =
    document.createElement("span");

  languageElement.className =
    "code-language";

  languageElement.textContent =
    language || "code";

  const copyButton =
    document.createElement("button");

  copyButton.className =
    "copy-button";

  copyButton.type =
    "button";

  copyButton.textContent =
    "Copy";

  copyButton.addEventListener(
    "click",
    async () => {

      try {

        await copyText(code);

        copyButton.textContent =
          "Copied";

        setTimeout(
          () => {
            copyButton.textContent =
              "Copy";
          },
          1500
        );

      } catch {

        copyButton.textContent =
          "Copy failed";

        setTimeout(
          () => {
            copyButton.textContent =
              "Copy";
          },
          1500
        );
      }
    }
  );

  header.appendChild(
    languageElement
  );

  header.appendChild(
    copyButton
  );

  const pre =
    document.createElement("pre");

  pre.className =
    "code-content";

  const codeElement =
    document.createElement("code");

  codeElement.textContent =
    code;

  pre.appendChild(
    codeElement
  );

  wrapper.appendChild(
    header
  );

  wrapper.appendChild(
    pre
  );

  return wrapper.outerHTML;
}

/* -------------------------------------------------------------------------- */
/* Copy code                                                                  */
/* -------------------------------------------------------------------------- */

async function copyText(text) {

  if (
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {

    await navigator.clipboard.writeText(
      text
    );

    return;
  }

  const textarea =
    document.createElement("textarea");

  textarea.value =
    text;

  textarea.style.position =
    "fixed";

  textarea.style.opacity =
    "0";

  document.body.appendChild(
    textarea
  );

  textarea.focus();

  textarea.select();

  const successful =
    document.execCommand(
      "copy"
    );

  textarea.remove();

  if (!successful) {

    throw new Error(
      "Copy failed"
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Add message                                                                */
/* -------------------------------------------------------------------------- */

function addMessage(
  text,
  type
) {

  if (empty) {
    empty.remove();
  }

  const element =
    document.createElement("div");

  element.className =
    "message " + type;

  if (
    type === "assistant"
  ) {

    const markdown =
      document.createElement("div");

    markdown.className =
      "markdown";

    markdown.innerHTML =
      renderMarkdown(
        String(text ?? "")
      );

    element.appendChild(
      markdown
    );

  } else {

    element.textContent =
      String(text ?? "");
  }

  messages.appendChild(
    element
  );

  messages.scrollTop =
    messages.scrollHeight;
}

/* -------------------------------------------------------------------------- */
/* Usage                                                                      */
/* -------------------------------------------------------------------------- */

function addUsage(
  usage
) {

  if (!usage) {
    return;
  }

  const element =
    document.createElement("div");

  element.className =
    "usage";

  const aiApiCalls =
    Number(
      usage.ai_api_calls ?? 0
    );

  const totalTokens =
    Number(
      usage.total_tokens ?? 0
    );

  const estimatedCost =
    Number(
      usage.estimated_cost ?? 0
    );

  element.textContent =
    "AI calls: " +
    aiApiCalls +
    " • Tokens: " +
    totalTokens +
    " • Cost: $" +
    estimatedCost.toFixed(6);

  messages.appendChild(
    element
  );

  messages.scrollTop =
    messages.scrollHeight;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

function setStatus(
  text
) {

  status.textContent =
    String(text ?? "");
}

/* -------------------------------------------------------------------------- */
/* Processing                                                                 */
/* -------------------------------------------------------------------------- */

function setProcessing(
  value
) {

  processing =
    value;

  input.disabled =
    value;

  send.disabled =
    value;

  if (value) {

    send.textContent =
      "Working...";

  } else {

    send.textContent =
      "Send";
  }
}

/* -------------------------------------------------------------------------- */
/* Send message                                                               */
/* -------------------------------------------------------------------------- */

function sendMessage() {

  if (processing) {
    return;
  }

  const value =
    input.value.trim();

  if (!value) {
    return;
  }

  addMessage(
    value,
    "user"
  );

  input.value =
    "";

  setProcessing(
    true
  );

  setStatus(
    "M3 is investigating..."
  );

  vscode.postMessage({
    type: "send_message",
    value: value
  });
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

send.addEventListener(
  "click",
  sendMessage
);

input.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      sendMessage();
    }
  }
);

window.addEventListener(
  "message",
  event => {

    const message =
      event.data;

    switch (
      message.type
    ) {

      case "thinking":

        setProcessing(
          true
        );

        setStatus(
          "Analyzing project..."
        );

        break;

      case "answer":

        setProcessing(
          false
        );

        addMessage(
          message.answer,
          "assistant"
        );

        addUsage(
          message.usage
        );

        if (message.model) {

          model.textContent =
            message.model;
        }

        setStatus(
          "Ready"
        );

        input.focus();

        break;

      case "error":

        setProcessing(
          false
        );

        addMessage(
          message.error,
          "error"
        );

        setStatus(
          "Error"
        );

        input.focus();

        break;

      case "ready":

        setProcessing(
          false
        );

        if (
          status.textContent !==
          "Error"
        ) {

          setStatus(
            "Ready"
          );
        }

        break;

      case "cleared":

        messages.innerHTML =
          "";

        const newEmpty =
          document.createElement(
            "div"
          );

        newEmpty.id =
          "empty";

        newEmpty.className =
          "empty";

        newEmpty.textContent =
          "Ask M3 about your project.";

        messages.appendChild(
          newEmpty
        );

        setProcessing(
          false
        );

        setStatus(
          "Ready"
        );

        input.focus();

        break;
    }
  }
);

input.focus();

</script>

</body>

</html>
`;
  }

  private getNonce(): string {

    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    let result =
      "";

    for (
      let i = 0;
      i < 32;
      i++
    ) {

      result +=
        chars.charAt(
          Math.floor(
            Math.random() * chars.length
          )
        );
    }

    return result;
  }
}

/* -------------------------------------------------------------------------- */
/* Webview message types                                                      */
/* -------------------------------------------------------------------------- */

type WebviewMessage =
  | {
      type: "send_message";
      value: string;
    }
  | {
      type: "clear";
    }
  | {
      type: "open_output";
    };

type WebviewResponse =
  | {
      type: "thinking";
    }
  | {
      type: "answer";
      answer: string;
      usage: AIUsage;
      requestId: string;
      model: string;
    }
  | {
      type: "error";
      error: string;
    }
  | {
      type: "ready";
    }
  | {
      type: "cleared";
    };

class AuthenticationError extends Error {

  constructor(
    message: string
  ) {

    super(message);

    this.name =
      "AuthenticationError";
  }
}

