import * as vscode from "vscode";

import { Logger } from "./utils/Logger";

import { ProjectIndexer } from "./intelligence/ProjectIndexer";

import { ChangeDetector } from "./intelligence/ChangeDetector";

import { ConversationState } from "./state/ConversationState";

import { IndexState } from "./state/IndexState";

import { TaskState } from "./state/TaskState";
import { ProjectMemory } from "./state/ProjectMemory";

import { Agent } from "./agent/Agent";

import { M3ViewProvider } from "./ui/M3ViewProvider";
import { ProjectUnderstanding } from "./project/project-understanding";

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

  const agent =
    new Agent(
      indexer,
      projectUnderstanding,
      conversation,
      taskState,
      projectMemory,
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
      "m3.rebuildIndex",
      async () => {

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
      "m3.clearConversation",
      () => {

        agent.clearConversation();

        vscode.window.showInformationMessage(
          "M3 conversation cleared."
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "m3.rollbackLastChanges",
      async () => {
        await provider.rollbackLastChanges();
      }
    )
  );
     // ----------------------------------------------------------
// Inspect project understanding
// ----------------------------------------------------------

context.subscriptions.push(
  vscode.commands.registerCommand(
    "m3.inspectProject",
    () => {

      const model =
        projectUnderstanding.getModel();

      if (!model) {

        vscode.window.showWarningMessage(
          "M3: Project understanding is not initialized."
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
      .getConfiguration("m3")
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
    "M3 AI Agent activated."
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
      "M3 project index and project understanding are ready."
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