import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const provider = new M3ViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("m3.chat", provider)
  );
}

class M3ViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };

    // Get your PNG icon
    const m3Icon = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "m3.png"
      )
    );

    webviewView.webview.html = `
      <!DOCTYPE html>

      <html lang="en">

      <head>
        <meta charset="UTF-8">

        <style>

          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            height: 100%;
          }

          body {
            font-family: var(
              --vscode-font-family,
              sans-serif
            );

            font-size: var(--vscode-font-size);

            color: var(--vscode-foreground);

            background:
              var(--vscode-sideBar-background);

            display: flex;
            flex-direction: column;

            overflow: hidden;
          }

          /* =========================
             Header
             ========================= */

          .header {
            display: flex;
            align-items: center;

            gap: 10px;

            padding: 14px;

            border-bottom: 1px solid
              var(--vscode-panel-border);
          }

          .logo {
            width: 34px;
            height: 34px;

            object-fit: contain;

            border-radius: 8px;
          }

          .header-info {
            display: flex;
            flex-direction: column;
          }

          .title {
            margin: 0;

            font-size: 14px;

            font-weight: 600;
          }

          .subtitle {
            margin: 3px 0 0;

            font-size: 11px;

            color:
              var(--vscode-descriptionForeground);
          }


          /* =========================
             Chat
             ========================= */

          #chat {
            flex: 1;

            overflow-y: auto;

            padding: 14px;

            display: flex;

            flex-direction: column;

            gap: 12px;
          }


          /* =========================
             Welcome
             ========================= */

          .welcome {
            text-align: center;

            margin-top: 35px;

            color:
              var(--vscode-descriptionForeground);
          }

          .welcome img {
            width: 55px;
            height: 55px;

            object-fit: contain;

            border-radius: 12px;

            margin-bottom: 10px;
          }

          .welcome h3 {
            margin: 0 0 6px;

            color:
              var(--vscode-foreground);

            font-size: 15px;
          }

          .welcome p {
            margin: 0;

            font-size: 12px;

            line-height: 1.5;
          }


          /* =========================
             Messages
             ========================= */

          .message {
            max-width: 90%;

            display: flex;

            flex-direction: column;

            gap: 4px;
          }

          .message.user {
            align-self: flex-end;

            align-items: flex-end;
          }

          .message.m3 {
            align-self: flex-start;
          }

          .message-name {
            font-size: 10px;

            color:
              var(--vscode-descriptionForeground);
          }

          .bubble {
            padding: 9px 11px;

            border-radius: 9px;

            line-height: 1.45;

            white-space: pre-wrap;

            word-break: break-word;
          }

          .user .bubble {
            background:
              var(--vscode-button-background);

            color:
              var(--vscode-button-foreground);
          }

          .m3 .bubble {
            background:
              var(--vscode-textCodeBlock-background);

            border: 1px solid
              var(--vscode-panel-border);
          }


          /* =========================
             File message
             ========================= */

          .file-list {
            padding: 9px;

            border-radius: 8px;

            background:
              var(--vscode-textCodeBlock-background);

            border: 1px solid
              var(--vscode-panel-border);

            font-size: 11px;
          }

          .file-item {
            padding: 3px 0;

            word-break: break-all;
          }


          /* =========================
             Bottom composer
             ========================= */

          .composer {
            padding: 10px;

            border-top: 1px solid
              var(--vscode-panel-border);
          }

          .toolbar {
            margin-bottom: 7px;
          }

          .select-files {
            border: none;

            background: transparent;

            color:
              var(--vscode-textLink-foreground);

            cursor: pointer;

            font-size: 11px;

            padding: 3px;
          }

          .select-files:hover {
            text-decoration: underline;
          }


          /* =========================
             Input
             ========================= */

          .input-container {
            position: relative;
          }

          #question {
            width: 100%;

            min-height: 45px;

            max-height: 120px;

            resize: vertical;

            padding: 10px 42px 10px 10px;

            border-radius: 7px;

            border: 1px solid
              var(--vscode-input-border);

            outline: none;

            background:
              var(--vscode-input-background);

            color:
              var(--vscode-input-foreground);

            font-family: inherit;

            font-size: 12px;
          }

          #question:focus {
            border-color:
              var(--vscode-focusBorder);
          }

          #question::placeholder {
            color:
              var(--vscode-input-placeholderForeground);
          }


          /* =========================
             Send
             ========================= */

          #send {
            position: absolute;

            right: 6px;

            bottom: 6px;

            width: 29px;

            height: 29px;

            border: none;

            border-radius: 5px;

            cursor: pointer;

            background:
              var(--vscode-button-background);

            color:
              var(--vscode-button-foreground);

            font-size: 15px;
          }

          #send:hover {
            background:
              var(--vscode-button-hoverBackground);
          }


          .hint {
            margin-top: 5px;

            text-align: center;

            font-size: 9px;

            color:
              var(--vscode-descriptionForeground);
          }

        </style>
      </head>


      <body>

        <!-- Header -->

        <div class="header">

          <img
            class="logo"
            src="${m3Icon}"
            alt="M3"
          >

          <div class="header-info">

            <h2 class="title">
              M3 AI Agent
            </h2>

            <p class="subtitle">
              Read-only coding assistant
            </p>

          </div>

        </div>


        <!-- Chat -->

        <div id="chat">

          <div class="welcome">

            <img
              src="${m3Icon}"
              alt="M3"
            >

            <h3>
              Welcome to M3
            </h3>

            <p>
              Ask questions about your code,<br>
              files, architecture, or errors.
            </p>

          </div>

        </div>


        <!-- Composer -->

        <div class="composer">

          <div class="toolbar">

            <button
              class="select-files"
              onclick="selectFiles()"
            >
              + Select Code Files
            </button>

          </div>


          <div class="input-container">

            <textarea
              id="question"
              placeholder="Ask about your code..."
              rows="1"
            ></textarea>

            <button
              id="send"
              onclick="ask()"
            >
              ↑
            </button>

          </div>


          <div class="hint">
            Enter to send · Shift + Enter for new line
          </div>

        </div>


        <script>

          const vscode = acquireVsCodeApi();


          // =========================
          // Select files
          // =========================

          function selectFiles() {

            vscode.postMessage({
              command: "selectFiles"
            });

          }


          // =========================
          // Ask M3
          // =========================

          function ask() {

            const input =
              document.getElementById("question");

            const question =
              input.value.trim();

            if (!question) {
              return;
            }


            addMessage(
              "user",
              question
            );


            vscode.postMessage({
              command: "ask",
              question: question
            });


            input.value = "";

            input.focus();

          }


          // =========================
          // Add chat message
          // =========================

          function addMessage(
            type,
            text
          ) {

            const message =
              document.createElement("div");

            message.className =
              "message " + type;


            const name =
              document.createElement("div");

            name.className =
              "message-name";

            name.textContent =
              type === "user"
                ? "You"
                : "M3";


            const bubble =
              document.createElement("div");

            bubble.className =
              "bubble";

            bubble.textContent =
              text;


            message.appendChild(name);

            message.appendChild(bubble);

            document
              .getElementById("chat")
              .appendChild(message);


            scrollChat();

          }


          // =========================
          // Scroll chat
          // =========================

          function scrollChat() {

            const chat =
              document.getElementById("chat");

            chat.scrollTop =
              chat.scrollHeight;

          }


          // =========================
          // Enter key
          // =========================

          document
            .getElementById("question")
            .addEventListener(
              "keydown",
              function(event) {

                if (
                  event.key === "Enter" &&
                  !event.shiftKey
                ) {

                  event.preventDefault();

                  ask();

                }

              }
            );


          // =========================
          // Messages from extension
          // =========================

          window.addEventListener(
            "message",
            function(event) {

              const message =
                event.data;


              // Files selected

              if (
                message.command === "files"
              ) {

                const container =
                  document.createElement("div");

                container.className =
                  "message m3";


                const name =
                  document.createElement("div");

                name.className =
                  "message-name";

                name.textContent =
                  "Selected files";


                const list =
                  document.createElement("div");

                list.className =
                  "file-list";


                message.files.forEach(
                  function(file) {

                    const item =
                      document.createElement("div");

                    item.className =
                      "file-item";

                    item.textContent =
                      "📄 " + file;

                    list.appendChild(item);

                  }
                );


                container.appendChild(name);

                container.appendChild(list);


                document
                  .getElementById("chat")
                  .appendChild(container);


                scrollChat();

              }


              // M3 response

              if (
                message.command === "response"
              ) {

                addMessage(
                  "m3",
                  message.text
                );

              }

            }
          );

        </script>

      </body>
      </html>
    `;

    // Receive messages from Webview
    webviewView.webview.onDidReceiveMessage(
      async (message) => {

        if (message.command === "selectFiles") {

          const files =
            await vscode.window.showOpenDialog({
              canSelectMany: true,
              canSelectFiles: true,
              canSelectFolders: false,
              openLabel: "Select Code Files",
            });


          if (files) {

            webviewView.webview.postMessage({
              command: "files",

              files: files.map((file) =>
                vscode.workspace.asRelativePath(file)
              ),
            });

          }

        }


        if (message.command === "ask") {

          webviewView.webview.postMessage({
            command: "response",

            text:
              "Dummy response: I received your question.",
          });

        }

      }
    );
  }
}
