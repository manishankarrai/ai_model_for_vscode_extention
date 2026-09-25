import * as vscode from "vscode";

import { Logger } from "./utils/Logger";

import { ConversationState } from "./state/ConversationState";

import { TaskState } from "./state/TaskState";

import { Agent } from "./agent/Agent";

import { MM3ViewProvider } from "./ui/MM3ViewProvider";
import { CodeChangeApplier } from "./safety/CodeChangeApplier";

import { flow } from "./utils/flowLog";

export function activate(
  context: vscode.ExtensionContext
): void {
  flow("activate", 1, "enter");

  const logger =
    new Logger();

  context.subscriptions.push(
    logger
  );

  logger.info(
    "MM3 AI Agent activating..."
  );

  // ----------------------------------------------------------
  // Core state
  // ----------------------------------------------------------

  const conversation =
    new ConversationState();

  const taskState =
    new TaskState();

  // ----------------------------------------------------------
  // Agent
  // ----------------------------------------------------------

  const changeApplier =
    new CodeChangeApplier();

  const agent =
    new Agent(
      conversation,
      taskState,
      logger,
      changeApplier,
      context.workspaceState
    );

  // ----------------------------------------------------------
  // View provider
  // ----------------------------------------------------------

  const provider =
    new MM3ViewProvider(
      context.extensionUri,

      agent,

      logger,

      async () => {
        flow("activate.getAccessTokenCallback", 1, "enter");
        return getAccessToken(
          context
        );
      },
      async () => {
        flow("activate.resetAccessTokenCallback", 1, "enter");
        return resetAccessToken(context);
      },
      changeApplier
    );

  let watcher: vscode.FileSystemWatcher | undefined;
  let watcherDisposables: vscode.Disposable[] = [];
  let prewarmController = new AbortController();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const disposeWorkspaceWatcher = (): void => {
    watcher?.dispose();
    watcher = undefined;
    for (const disposable of watcherDisposables) {
      disposable.dispose();
    }
    watcherDisposables = [];
    prewarmController.abort();
    prewarmController = new AbortController();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
  };

  const bindWorkspaceWatcher = (): void => {
    disposeWorkspaceWatcher();
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      return;
    }

    watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspace, "**/*")
    );
    const pendingPaths = new Set<string>();
    const queueInvalidation = (uri: vscode.Uri): void => {
      pendingPaths.add(uri.fsPath);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        for (const filePath of pendingPaths) {
          agent.invalidateProjectPath(filePath);
        }
        pendingPaths.clear();
        debounceTimer = undefined;
        agent.scheduleProjectPrewarm(workspace.uri.fsPath, prewarmController.signal);
      }, 250);
    };

    watcherDisposables = [
      watcher.onDidCreate(queueInvalidation),
      watcher.onDidChange(queueInvalidation),
      watcher.onDidDelete(queueInvalidation)
    ];
  };

  bindWorkspaceWatcher();
  context.subscriptions.push(
    new vscode.Disposable(disposeWorkspaceWatcher),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      bindWorkspaceWatcher();
      void provider.handleWorkspaceChanged().catch((error) => {
        logger.warn("Workspace reinitialization unavailable", error);
      });
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MM3ViewProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );
  context.subscriptions.push(
    new vscode.Disposable(() => provider.dispose())
  );


  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mm3.openChat",
      async () => {
        flow("command.openChat", 1, "enter");
        await provider.focusChat();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mm3.resetAccessToken",
      async () => {
        flow("command.resetAccessToken", 1, "enter");
        const token = await resetAccessToken(context);
        if (token) {
          vscode.window.showInformationMessage("MM3 access token updated.");
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mm3.restartExtension",
      restartExtension
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mm3.addSelectionToChat",
      async () => {
        flow("command.addSelectionToChat", 1, "enter");
        await provider.attachCurrentSelection();
      }
    )
  );

  // ----------------------------------------------------------
  // Clear conversation
  // ----------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mm3.clearConversation",
      () => {
        flow("command.clearConversation", 1, "enter");

        agent.clearConversation();

        vscode.window.showInformationMessage(
          "MM3 conversation cleared."
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mm3.rollbackLastChanges",
      async () => {
        flow("command.rollbackLastChanges", 1, "enter");
        await provider.rollbackLastChanges();
      }
    )
  );
  logger.info(
    "MM3 AI Agent activated."
  );
}

async function restartExtension(): Promise<void> {
  const commands = await vscode.commands.getCommands(true);
  if (commands.includes("workbench.action.restartExtensionHost")) {
    await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
    return;
  }

  await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

async function getAccessToken(
  context: vscode.ExtensionContext,
  forcePrompt = false
): Promise<string> {
  flow("getAccessToken", 1, "enter", { forcePrompt });

  if (!forcePrompt) {
    const token =
      await context.secrets.get(
        "mm3.accessToken"
      );

    if (token) {
      return token;
    }
  }

  const entered =
    await vscode.window.showInputBox({
      prompt:
        forcePrompt
          ? "Enter a new MM3 access token (replaces the stored token)"
          : "Enter your MM3 access token",

      password: true,

      ignoreFocusOut: true
    });

  if (!entered) {
    return "";
  }

  await context.secrets.store(
    "mm3.accessToken",
    entered.trim()
  );

  return entered.trim();
}

async function resetAccessToken(
  context: vscode.ExtensionContext
): Promise<string> {
  flow("resetAccessToken", 1, "enter");
  await context.secrets.delete("mm3.accessToken");
  return getAccessToken(context, true);
}

export function deactivate(): void {
  flow("deactivate", 1, "enter");
}