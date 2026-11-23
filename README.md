# MM3 AI Agent for VS Code

MM3 is a local-first AI coding agent that helps you investigate code, understand repositories, plan fixes, review changes, and implement approved edits inside Visual Studio Code.

## Features

- **Ask mode** for context-aware questions about files, selections, and the current workspace
- **Agent mode** for bounded, read-only investigation and implementation planning
- **Project intelligence** with repository indexing, symbol lookup, semantic search, and ranked context selection
- **Specialist workflows** for exploration, debugging, review, architecture, implementation, testing, and project memory
- **Streaming responses** with progress updates, evidence, citations, confidence, and validation results
- **Approval-gated edits** with diff previews, selective acceptance, and change rollback
- **Workspace safety** with path boundaries, sensitive-file protection, command policies, and tool limits
- **Account and usage management** for models, plans, credits, and access tokens

## Installation

### Marketplace

Install [MM3 AI Agent](https://marketplace.visualstudio.com/items?itemName=mm3ai.mm3-ai-agent) from the Visual Studio Code Marketplace, then open a workspace.

### From source

```bash
git clone https://github.com/manishankarrai/m3.git
cd m3
npm install
npm run compile
npx @vscode/vsce package
code --install-extension mm3-ai-agent-*.vsix
```

Press `F5` in VS Code to launch an Extension Development Host for interactive development.

## Getting Started

1. Open a folder or workspace in VS Code.
2. Open **MM3: Open Chat** from the Command Palette or the MM3 activity-bar view.
3. Sign in or create an account at [mm3ai.com](https://www.mm3ai.com).
4. Enter your MM3 access token when prompted.
5. Choose **Ask** or **Agent**, select a specialist if needed, and submit a question.

You can attach files with the paperclip control or use **MM3: Add Selection to Chat** from the editor context menu.

## Safety and Privacy

- Workspace file access and terminal tools run through the extension, not through the hosted backend.
- Ask mode cannot investigate or modify the workspace.
- Agent mode can read the workspace and propose changes, but file changes require explicit approval.
- Sensitive paths and workspace boundaries are checked before file access.
- Context is selected locally and only relevant evidence needed for the request is sent to the backend.
- Access tokens are stored using VS Code Secret Storage and can be removed with **MM3: Reset Access Token**.

Review every proposed diff before accepting changes. Use **MM3: Roll Back Last Approved Changes** to reverse the most recently approved change set.

## Commands

| Command | Description |
| --- | --- |
| **MM3: Open Chat** | Opens the MM3 chat view |
| **MM3: Add Selection to Chat** | Adds selected editor text to the conversation |
| **MM3: Clear Conversation** | Clears the current conversation |
| **MM3: Roll Back Last Approved Changes** | Rolls back the last approved change set |
| **MM3: Reset Access Token** | Removes and resets the stored access token |
| **MM3: Restart Extension** | Restarts the extension |

## Configuration

Configure MM3 in VS Code Settings or in `settings.json`:

```json
{
  "mm3.backendUrl": "https://api.mm3ai.com",
  "mm3.maxContextChars": 300000,
  "mm3.maxFilesInContext": 30,
  "mm3.implementationRoot": "",
  "mm3.debugLogs": false
}
```

| Setting | Description |
| --- | --- |
| `mm3.backendUrl` | MM3 API endpoint |
| `mm3.maxContextChars` | Maximum source context sent to the backend |
| `mm3.maxFilesInContext` | Maximum files included in ranked context |
| `mm3.implementationRoot` | Optional workspace-relative directory used for implementation tasks |
| `mm3.debugLogs` | Enables detailed diagnostic flow logs |

## Development

### Requirements

- Node.js 20 or newer
- npm
- VS Code 1.90 or newer

### Scripts

```bash
npm run check-types
npm run lint
npm test
npm run compile
npm run package
npm run watch
```

The test suite covers context selection, project retrieval, safety policies, change validation, diff previews, task state, adaptive investigation, and utility behavior.

## Repository Layout

- `src/agent` - agent orchestration, planning, scheduling, and verification
- `src/backend` - authenticated API and event-stream clients
- `src/intelligence` - retrieval, context budgeting, confidence, and investigation state
- `src/project` - workspace scanning, indexing, search, and code graph models
- `src/safety` - approved change sets and workspace validation
- `src/tools` - bounded workspace tools and command policies
- `src/ui` - VS Code webview integration

## Requirements

- VS Code 1.90 or newer
- Network access to the configured MM3 backend
- An MM3 account, access token, and available credits

## Support

- Website: [www.mm3ai.com](https://www.mm3ai.com)
- Email: [support@mm3ai.com](mailto:support@mm3ai.com)
- Issues: [GitHub Issues](https://github.com/manishankarrai/m3/issues)

## License

Licensed under the [MIT License](LICENSE).
