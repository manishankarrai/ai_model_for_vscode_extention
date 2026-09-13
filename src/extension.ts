import * as vscode from "vscode";

import { Logger } from "./utils/Logger";

import { ProjectIndexer } from "./intelligence/ProjectIndexer";

import { ChangeDetector } from "./intelligence/ChangeDetector";

import { ConversationState } from "./state/ConversationState";

import { IndexState } from "./state/IndexState";

import { TaskState } from "./state/TaskState";
import { ProjectMemory } from "./state/ProjectMemory";

import { Agent } from "./agent/Agent";

import { MM3ViewProvider } from "./ui/MM3ViewProvider";
import { CodeChangeApplier } from "./safety/CodeChangeApplier";
import { ProjectUnderstanding } from "./project/project-understanding";

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
    new ConversationState(context.workspaceState);

  const taskState =
    new TaskState(context.workspaceState);

  const projectMemory =
    new ProjectMemory(
      context.workspaceState
    );

  const indexer =
    new ProjectIndexer();

  const indexState =
    new IndexState(
      context.workspaceState
    );

  const projectUnderstanding =
    new ProjectUnderstanding();
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

  const changeApplier =
    new CodeChangeApplier();

  const agent =
    new Agent(
      indexer,
      projectUnderstanding,
      conversation,
      taskState,
      projectMemory,
      logger,
      changeApplier
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
      changeApplier,
      context.workspaceState
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
      "mm3.moveToSecondarySidebar",
      async () => {
        flow("command.moveToSecondarySidebar", 1, "enter");
        await provider.focusChat();
        await vscode.commands.executeCommand("workbench.action.moveView");
      }
    )
  );

  // ----------------------------------------------------------
  // One-time nudge: MM3 works best docked in the Secondary Side Bar,
  // similar to Copilot Chat. VS Code has no API to place it there by
  // default, so offer a guided one-click move instead.
  // ----------------------------------------------------------

  const sidebarPromptKey = "mm3.secondarySidebarPromptShown";
  if (!context.globalState.get<boolean>(sidebarPromptKey)) {
    void context.globalState.update(sidebarPromptKey, true);
    void vscode.window
      .showInformationMessage(
        "MM3 works best in the Secondary Side Bar, like Copilot Chat. Move it there now?",
        "Move Chat",
        "Later"
      )
      .then((choice) => {
        if (choice === "Move Chat") {
          void vscode.commands.executeCommand("mm3.moveToSecondarySidebar");
        }
      });
  }

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
      "mm3.addSelectionToChat",
      async () => {
        flow("command.addSelectionToChat", 1, "enter");
        await provider.attachCurrentSelection();
      }
    )
  );

  // ----------------------------------------------------------
  // Scan project
  // ----------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mm3.scanProject",
      async () => {
        flow("command.scanProject", 1, "enter");

        await scanProject(
          indexer,
          indexState,
          projectUnderstanding,
          projectMemory,
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
      "mm3.rebuildIndex",
      async () => {
        flow("command.rebuildIndex", 1, "enter");

        await scanProject(
          indexer,
          indexState,
          projectUnderstanding,
          projectMemory,
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
     // ----------------------------------------------------------
// Inspect project understanding
// ----------------------------------------------------------

context.subscriptions.push(
  vscode.commands.registerCommand(
    "mm3.inspectProject",
    () => {
      flow("command.inspectProject", 1, "enter");

      const model =
        projectUnderstanding.getModel();

      if (!model) {

        vscode.window.showWarningMessage(
          "MM3: Project understanding is not initialized."
        );

        return;
      }

      logger.info(
        "Project Model",
        {
          rootPath:
            model.rootPath,

          languages:
            model.languages,

          frameworks:
            model.frameworks,

          files:
            model.files.length,

          symbols:
            model.symbols.length,

          imports:
            model.imports.length,

          dependencies:
            model.dependencies.length,

          entryPoints:
            model.entryPoints.length,

          modules:
            model.modules.length,

          configFiles:
            model.configFiles.length,

          testFiles:
            model.testFiles.length
        }
      );

      vscode.window.showInformationMessage(
        [
          `Languages: ${model.languages.join(", ") || "None"}`,
          `Frameworks: ${model.frameworks.join(", ") || "None"}`,
          `Files: ${model.files.length}`,
          `Entry points: ${model.entryPoints.length}`,
          `Modules: ${model.modules.length}`,
          `Tests: ${model.testFiles.length}`,
          `Config files: ${model.configFiles.length}`
        ].join(" | ")
      );
    }
  )
);
  // ----------------------------------------------------------
  // Auto index
  // ----------------------------------------------------------

  const autoIndex =
    vscode.workspace
      .getConfiguration("mm3")
      .get<boolean>(
        "enableAutoIndex",
        true
      );

  if (autoIndex) {

    void scanProject(
      indexer,
      indexState,
      projectUnderstanding,
      projectMemory,
      logger
    );
  }

  logger.info(
    "MM3 AI Agent activated."
  );
}

async function scanProject(
  indexer: ProjectIndexer,
  indexState: IndexState,
  projectUnderstanding: ProjectUnderstanding,
  projectMemory: ProjectMemory,
  logger: Logger,
  force = false
): Promise<void> {
  flow("scanProject", 1, "enter", { force });

  const workspace =
    vscode.workspace.workspaceFolders?.[0];

  if (!workspace) {

    vscode.window.showWarningMessage(
      "MM3: Please open a workspace first."
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
            ? "MM3: Rebuilding project index..."
            : "MM3: Indexing project..."
      },

      async progress => {

        // ----------------------------------------------------
        // Stage 1 - Project Index
        // ----------------------------------------------------

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

        // ----------------------------------------------------
        // Stage 2 - Project Understanding
        // ----------------------------------------------------

        progress.report({
          message:
            "Building project understanding..."
        });

        const projectModel =
          projectUnderstanding.initialize(
            index
          );

        projectMemory.initializeFromProjectModel(
          projectModel
        );

        await projectMemory.save();

        logger.info(
          "Project understanding ready",
          {
            languages:
              projectModel.languages,

            frameworks:
              projectModel.frameworks,

            files:
              projectModel.files.length,

            entryPoints:
              projectModel.entryPoints.length,

            modules:
              projectModel.modules.length,

            configFiles:
              projectModel.configFiles.length,

            testFiles:
              projectModel.testFiles.length
          }
        );

        progress.report({
          message:
            "Project understanding ready"
        });
      }
    );

    vscode.window.showInformationMessage(
      "MM3 project index and project understanding are ready."
    );

  } catch (error) {

    logger.error(
      "Project indexing failed",
      error
    );

    vscode.window.showErrorMessage(
      `MM3 indexing failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }
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