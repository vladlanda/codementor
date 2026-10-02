import * as vscode from 'vscode';

import { ChatViewProvider } from './ui/ChatViewProvider';
import { ProviderService } from './providers/ProviderService';
import { SettingsService } from './services/SettingsService';
import { ConnectionManager } from './providers/ConnectionManager';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const settings = new SettingsService(context.secrets);
  const providerService = new ProviderService(settings, context.secrets);
  const connection = new ConnectionManager(providerService, settings);

  const view = new ChatViewProvider(context, settings, connection, providerService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, view, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const commands: Array<[string, (uri?: vscode.Uri) => unknown]> = [
    ['codementor.newChat', () => view.resetChat()],
    ['codementor.explainSelection', (uri) => view.explainSelection(uri)],
    ['codementor.cancelTask', () => view.cancelActiveTask()],
    ['codementor.connectProvider', () => view.promptProviderConnection()],
    ['codementor.viewLearningProfile', () => view.openLearningProfile()],
  ];
  for (const [id, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  // Refresh provider connection info when settings change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codementor')) {
        void view.refreshConnection();
      }
    })
  );

  void view.refreshConnection();
}

export function deactivate(): void {
  // Nothing to dispose; all subscriptions are managed by the extension context.
}
