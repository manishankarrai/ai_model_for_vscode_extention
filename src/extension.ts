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
export function activate(context: vscode.ExtensionContext): void {
    const logger = new Logger();
    context.subscriptions.push(logger);
    const conversation = new ConversationState();
    const taskState = new TaskState();
    const projectMemory = new ProjectMemory(context.workspaceState);
    const indexer = new ProjectIndexer();
    const indexState = new IndexState(context.workspaceState);
    const projectUnderstanding = new ProjectUnderstanding();
    const changeDetector = new ChangeDetector(indexer, logger);
    context.subscriptions.push(changeDetector);
    const changeApplier = new CodeChangeApplier();
    const agent = new Agent(indexer, projectUnderstanding, conversation, taskState, projectMemory, logger, changeApplier);
    const provider = new MM3ViewProvider(context.extensionUri, agent, logger, async () => {
        return getAccessToken(context);
    }, async () => {
        return resetAccessToken(context);
    }, changeApplier);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(MM3ViewProvider.viewType, provider, {
        webviewOptions: {
            retainContextWhenHidden: true
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("mm3.openChat", async () => {
        await provider.focusChat();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("mm3.resetAccessToken", async () => {
        const token = await resetAccessToken(context);
        if (token) {
            vscode.window.showInformationMessage("MM3 access token updated.");
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("mm3.addSelectionToChat", async () => {
        await provider.attachCurrentSelection();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("mm3.scanProject", async () => {
        await scanProject(indexer, indexState, projectUnderstanding, projectMemory, logger);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("mm3.rebuildIndex", async () => {
        await scanProject(indexer, indexState, projectUnderstanding, projectMemory, logger, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("mm3.clearConversation", () => {
        agent.clearConversation();
        vscode.window.showInformationMessage("MM3 conversation cleared.");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("mm3.rollbackLastChanges", async () => {
        await provider.rollbackLastChanges();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("mm3.inspectProject", () => {
        const model = projectUnderstanding.getModel();
        if (!model) {
            vscode.window.showWarningMessage("MM3: Project understanding is not initialized.");
            return;
        }
        vscode.window.showInformationMessage([
            `Languages: ${model.languages.join(", ") || "None"}`,
            `Frameworks: ${model.frameworks.join(", ") || "None"}`,
            `Files: ${model.files.length}`,
            `Entry points: ${model.entryPoints.length}`,
            `Modules: ${model.modules.length}`,
            `Tests: ${model.testFiles.length}`,
            `Config files: ${model.configFiles.length}`
        ].join(" | "));
    }));
    const autoIndex = vscode.workspace
        .getConfiguration("mm3")
        .get<boolean>("enableAutoIndex", true);
    if (autoIndex) {
        void scanProject(indexer, indexState, projectUnderstanding, projectMemory, logger);
    }
}
async function scanProject(indexer: ProjectIndexer, indexState: IndexState, projectUnderstanding: ProjectUnderstanding, projectMemory: ProjectMemory, logger: Logger, force = false): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
        vscode.window.showWarningMessage("MM3: Please open a workspace first.");
        return;
    }
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: force
                ? "MM3: Rebuilding project index..."
                : "MM3: Indexing project..."
        }, async (progress) => {
            progress.report({
                message: "Scanning files..."
            });
            const index = await indexer.build(workspace.uri);
            await indexState.save(index);
            progress.report({
                message: `${index.files.size} files indexed`
            });
            progress.report({
                message: "Building project understanding..."
            });
            const projectModel = projectUnderstanding.initialize(index);
            projectMemory.initializeFromProjectModel(projectModel);
            await projectMemory.save();
            progress.report({
                message: "Project understanding ready"
            });
        });
        vscode.window.showInformationMessage("MM3 project index and project understanding are ready.");
    }
    catch (error) {
        vscode.window.showErrorMessage(`MM3 indexing failed: ${error instanceof Error
            ? error.message
            : String(error)}`);
    }
}
async function getAccessToken(context: vscode.ExtensionContext, forcePrompt = false): Promise<string> {
    if (!forcePrompt) {
        const token = await context.secrets.get("mm3.accessToken");
        if (token) {
            return token;
        }
    }
    const entered = await vscode.window.showInputBox({
        prompt: forcePrompt
            ? "Enter a new MM3 access token (replaces the stored token)"
            : "Enter your MM3 access token",
        password: true,
        ignoreFocusOut: true
    });
    if (!entered) {
        return "";
    }
    await context.secrets.store("mm3.accessToken", entered.trim());
    return entered.trim();
}
async function resetAccessToken(context: vscode.ExtensionContext): Promise<string> {
    await context.secrets.delete("mm3.accessToken");
    return getAccessToken(context, true);
}
export function deactivate(): void {
}
