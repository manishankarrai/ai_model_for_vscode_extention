import * as vscode from "vscode";

import { Logger } from "./utils/Logger";

import { ProjectIndexer } from "./intelligence/ProjectIndexer";

import { ChangeDetector } from "./intelligence/ChangeDetector";

import { ConversationState } from "./state/ConversationState";

import { IndexState } from "./state/IndexState";

import { TaskState } from "./state/TaskState";

import { Agent } from "./agent/Agent";

import { M3ViewProvider } from "./ui/M3ViewProvider";

export function activate(
  context: vscode.ExtensionContext
): void {

  const logger =
    new Logger();

  context.subscriptions.push(
    logger
  );

  logger.info(
    "M3 AI Agent activating..."
  );

  // ----------------------------------------------------------
  // Core state
  // ----------------------------------------------------------

  const conversation =
    new ConversationState();

  const taskState =
    new TaskState();

  const indexer =
    new ProjectIndexer();

  const indexState =
    new IndexState(
      context.workspaceState
    );

  // ----------------------------------------------------------
  // Change detection
  // ----------------------------------------------------------

  const changeDetector =
    new ChangeDetector(
      indexer,
      logger
    );

  context.subscriptions.push(
    changeDetector
  );

  // ----------------------------------------------------------
  // Agent
  // ----------------------------------------------------------

  const agent =
    new Agent(
      indexer,
      conversation,
      taskState,
      logger
    );

  // ----------------------------------------------------------
  // View provider
  // ----------------------------------------------------------

  const provider =
    new M3ViewProvider(
      context.extensionUri,

      agent,

      logger,

      async () => {
        return getAccessToken(
          context
        );
      }
    );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      M3ViewProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );

  // ----------------------------------------------------------
  // Scan project
  // ----------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "m3.scanProject",
      async () => {

        await scanProject(
          indexer,
          indexState,
          logger
        );
      }
    )
  );

  // ----------------------------------------------------------
  // Rebuild index
  // ----------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "m3.rebuildIndex",
      async () => {

        await scanProject(
          indexer,
          indexState,
          logger,
          true
        );
      }
    )
  );

  // ----------------------------------------------------------
  // Clear conversation
  // ----------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "m3.clearConversation",
      () => {

        agent.clearConversation();

        vscode.window.showInformationMessage(
          "M3 conversation cleared."
        );
      }
    )
  );

  // ----------------------------------------------------------
  // Auto index
  // ----------------------------------------------------------

  const autoIndex =
    vscode.workspace
      .getConfiguration("m3")
      .get<boolean>(
        "enableAutoIndex",
        true
      );

  if (autoIndex) {

    void scanProject(
      indexer,
      indexState,
      logger
    );
  }

  logger.info(
    "M3 AI Agent activated."
  );
}

async function scanProject(
  indexer: ProjectIndexer,
  indexState: IndexState,
  logger: Logger,
  force = false
): Promise<void> {

  const workspace =
    vscode.workspace.workspaceFolders?.[0];

  if (!workspace) {

    vscode.window.showWarningMessage(
      "M3: Please open a workspace first."
    );

    return;
  }

  try {

    await vscode.window.withProgress(
      {
        location:
          vscode.ProgressLocation.Notification,

        title:
          force
            ? "M3: Rebuilding project index..."
            : "M3: Indexing project..."
      },

      async progress => {

        progress.report({
          message:
            "Scanning files..."
        });

        const index =
          await indexer.build(
            workspace.uri
          );

        await indexState.save(
          index
        );

        logger.info(
          "Project indexed",
          {
            files:
              index.files.size,

            symbols:
              index.symbols.length,

            dependencies:
              index.dependencies.length,

            version:
              index.version
          }
        );

        progress.report({
          message:
            `${index.files.size} files indexed`
        });
      }
    );

    vscode.window.showInformationMessage(
      "M3 project index is ready."
    );

  } catch (error) {

    logger.error(
      "Project indexing failed",
      error
    );

    vscode.window.showErrorMessage(
      `M3 indexing failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }
}

async function getAccessToken(
  context: vscode.ExtensionContext
): Promise<string> {

  const token =
    await context.secrets.get(
      "m3.accessToken"
    );

  if (token) {
    return token;
  }

  // Temporary V1 behavior.
  //
  // Next step should replace this with
  // a proper M3 login UI.

  const entered =
    await vscode.window.showInputBox({
      prompt:
        "Enter your M3 access token",

      password: true,

      ignoreFocusOut: true
    });

  if (!entered) {
    return "";
  }

  await context.secrets.store(
    "m3.accessToken",
    entered
  );

  return entered;
}

export function deactivate(): void {
}