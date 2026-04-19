import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runReview } from './core/review-engine';
import { ReviewTreeProvider } from './providers/tree-provider';
import { DiagnosticsProvider } from './providers/diagnostics-provider';
import { DecorationProvider } from './providers/decoration-provider';
import { CodeLensProvider } from './providers/codelens-provider';
import { CodeActionProvider } from './providers/codeaction-provider';
import { DashboardProvider } from './providers/webview-provider';
import { ReviewStore } from './storage/review-store';
import { getConfig } from './utils/config';
import { log, logError, getLogger } from './utils/logger';
import { isGitRepo, getGitRoot } from './utils/git';
import { ReviewResult } from './storage/models';

export function activate(context: vscode.ExtensionContext): void {
  log('ShipIt activating...');

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot || !isGitRepo(workspaceRoot)) {
    log('No git repository found — registering fallback commands.');

    // Register a fallback so the command doesn't show "not found"
    context.subscriptions.push(
      vscode.commands.registerCommand('shipit.review', () => {
        vscode.window.showWarningMessage('ShipIt: No git repository found. Open a project with a .git folder to use ShipIt.');
      }),
      vscode.commands.registerCommand('shipit.clearReview', () => { }),
      vscode.commands.registerCommand('shipit.copyPrDescription', () => { }),
      vscode.commands.registerCommand('shipit.installHook', () => { }),
    );
    return;
  }

  const cwd = getGitRoot(workspaceRoot) ?? workspaceRoot;
  log(`Git root: ${cwd}`);

  // ─── Initialize providers ──────────────────────────────────────
  const store = new ReviewStore(context.workspaceState);
  const treeProvider = new ReviewTreeProvider();
  const diagnosticsProvider = new DiagnosticsProvider();
  const decorationProvider = new DecorationProvider();
  const codeLensProvider = new CodeLensProvider();
  const codeActionProvider = new CodeActionProvider();
  const dashboardProvider = new DashboardProvider(context.extensionUri);

  // ─── Register tree view ────────────────────────────────────────
  const treeView = vscode.window.createTreeView('shipit.reviewTree', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // ─── Register webview ──────────────────────────────────────────
  const webviewDisposable = vscode.window.registerWebviewViewProvider(
    'shipit.dashboard',
    dashboardProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // ─── Register code lens ────────────────────────────────────────
  const codeLensDisposable = vscode.languages.registerCodeLensProvider(
    { scheme: 'file' },
    codeLensProvider
  );

  // ─── Register code actions ─────────────────────────────────────
  const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
    { scheme: 'file' },
    codeActionProvider,
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );

  // ─── Status bar ────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'shipit.review';
  statusBar.text = '$(shield) ShipIt';
  statusBar.tooltip = 'Run ShipIt pre-push review';
  statusBar.show();

  // ─── Decoration refresh on editor change ───────────────────────
  const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(() => {
    decorationProvider.applyToVisibleEditors();
  });

  // ─── Handle webview messages ───────────────────────────────────
  dashboardProvider.onMessage(async (msg) => {
    switch (msg.type) {
      case 'reReview':
        vscode.commands.executeCommand('shipit.review');
        break;
      case 'copyPrDescription':
        if (lastResult) {
          await vscode.env.clipboard.writeText(lastResult.prDescription);
          vscode.window.showInformationMessage('PR description copied to clipboard.');
        }
        break;
      case 'openFile':
        if (msg.data) {
          const uri = vscode.Uri.file(path.join(cwd, msg.data.path));
          const line = Math.max(0, msg.data.line - 1);
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc);
          const range = new vscode.Range(line, 0, line, 0);
          editor.selection = new vscode.Selection(range.start, range.start);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }
        break;
    }
  });

  // ─── Review state ──────────────────────────────────────────────
  let lastResult: ReviewResult | undefined;
  let isReviewing = false;

  // ─── Main review command ───────────────────────────────────────
  const reviewCommand = vscode.commands.registerCommand('shipit.review', async () => {
    if (isReviewing) {
      vscode.window.showInformationMessage('ShipIt: Review already in progress...');
      return;
    }

    isReviewing = true;
    const config = getConfig();

    statusBar.text = '$(loading~spin) ShipIt: Reviewing...';
    dashboardProvider.sendLoading('Analyzing your changes...');

    try {
      const previousScore = store.getLastScore();

      const result = await runReview({
        cwd,
        analyzers: config.analyzers,
        largeFunctionThreshold: config.largeFunctionThreshold,
        aiConfig: config.enableAiReview && config.apiKey
          ? { apiKey: config.apiKey, provider: config.provider }
          : undefined,
      });

      lastResult = result;

      // Update all providers
      treeProvider.update(result, cwd);
      diagnosticsProvider.update(result, cwd);
      decorationProvider.update(result, cwd);
      codeLensProvider.update(result, cwd);
      codeActionProvider.update(result, cwd);
      dashboardProvider.sendResult(result);

      // Save to history
      store.saveReview(result);
      dashboardProvider.sendHistory(store.getHistory());

      // Update status bar
      const icon = result.score >= 80 ? '$(check)' : result.score >= 50 ? '$(warning)' : '$(error)';
      statusBar.text = `${icon} ShipIt: ${result.score}/100`;

      // Show delta if there was a previous score
      if (previousScore !== undefined) {
        const delta = result.score - previousScore;
        if (delta > 0) {
          statusBar.tooltip = `Score improved: ${previousScore} → ${result.score} (+${delta})`;
        } else if (delta < 0) {
          statusBar.tooltip = `Score dropped: ${previousScore} → ${result.score} (${delta})`;
        }
      }

      // Show summary notification
      if (result.totalIssues === 0) {
        vscode.window.showInformationMessage('ShipIt: All clear! Score: 100/100 ✅');
      } else {
        vscode.window.showWarningMessage(
          `ShipIt: Score ${result.score}/100 — ${result.errors} error(s), ${result.warnings} warning(s), ${result.infos} info(s)`,
          'Show Dashboard'
        ).then(choice => {
          if (choice === 'Show Dashboard') {
            vscode.commands.executeCommand('shipit.dashboard.focus');
          }
        });
      }

    } catch (error) {
      logError('Review failed', error);
      statusBar.text = '$(error) ShipIt: Failed';
      dashboardProvider.sendError(error instanceof Error ? error.message : 'Unknown error');
      vscode.window.showErrorMessage(`ShipIt review failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      isReviewing = false;
    }
  });

  // ─── Clear review command ──────────────────────────────────────
  const clearCommand = vscode.commands.registerCommand('shipit.clearReview', () => {
    lastResult = undefined;
    treeProvider.clear();
    diagnosticsProvider.clear();
    decorationProvider.clear();
    codeLensProvider.clear();
    statusBar.text = '$(shield) ShipIt';
    vscode.window.showInformationMessage('ShipIt: Review cleared.');
  });

  // ─── Copy PR description command ───────────────────────────────
  const copyPrCommand = vscode.commands.registerCommand('shipit.copyPrDescription', async () => {
    if (lastResult) {
      await vscode.env.clipboard.writeText(lastResult.prDescription);
      vscode.window.showInformationMessage('PR description copied to clipboard.');
    } else {
      vscode.window.showWarningMessage('No review results yet. Run ShipIt: Review My Changes first.');
    }
  });

  // ─── Install pre-push hook command ─────────────────────────────
  const installHookCommand = vscode.commands.registerCommand('shipit.installHook', async () => {
    const hooksDir = path.join(cwd, '.git', 'hooks');
    const hookPath = path.join(hooksDir, 'pre-push');

    if (fs.existsSync(hookPath)) {
      const overwrite = await vscode.window.showWarningMessage(
        'A pre-push hook already exists. Overwrite?',
        'Overwrite',
        'Cancel'
      );
      if (overwrite !== 'Overwrite') { return; }
    }

    const hookScript = `#!/bin/sh
# ShipIt pre-push hook — notifies on low review score
# This hook does NOT block the push. It only shows a notification.
echo "ShipIt: Running pre-push review..."
# The VS Code extension handles the actual review via the command
exit 0
`;

    try {
      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
      }
      fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
      vscode.window.showInformationMessage('ShipIt: Pre-push hook installed successfully.');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to install hook: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // ─── Move to .env quick fix command ────────────────────────────
  const moveToEnvCommand = vscode.commands.registerCommand(
    'shipit.moveToEnv',
    async (uri: vscode.Uri, line: number, envKey: string) => {
      const envPath = path.join(cwd, '.env');
      const doc = await vscode.workspace.openTextDocument(uri);
      const lineText = doc.lineAt(line).text;

      // Extract the secret value
      const valueMatch = lineText.match(/['"]([^'"]{8,})['"]/);
      if (!valueMatch) {
        vscode.window.showWarningMessage('Could not extract secret value from line.');
        return;
      }

      const secretValue = valueMatch[1];

      // Append to .env file
      const envEntry = `${envKey}=${secretValue}\n`;
      fs.appendFileSync(envPath, envEntry);

      // Replace in source file
      const edit = new vscode.WorkspaceEdit();
      const fullRange = doc.lineAt(line).range;
      const newLine = lineText.replace(/['"][^'"]{8,}['"]/, `process.env.${envKey}`);
      edit.replace(uri, fullRange, newLine);
      await vscode.workspace.applyEdit(edit);

      // Check .gitignore
      const gitignorePath = path.join(cwd, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
        if (!gitignore.includes('.env')) {
          fs.appendFileSync(gitignorePath, '\n.env\n');
          vscode.window.showInformationMessage(`Secret moved to .env as ${envKey}. Added .env to .gitignore.`);
          return;
        }
      }

      vscode.window.showInformationMessage(`Secret moved to .env as ${envKey}.`);
    }
  );

  // ─── Auto-review on save ───────────────────────────────────────
  const saveDisposable = vscode.workspace.onDidSaveTextDocument(() => {
    const config = getConfig();
    if (config.autoReviewOnSave) {
      vscode.commands.executeCommand('shipit.review');
    }
  });

  // ─── Register all disposables ──────────────────────────────────
  context.subscriptions.push(
    treeView,
    webviewDisposable,
    codeLensDisposable,
    codeActionDisposable,
    statusBar,
    editorChangeDisposable,
    reviewCommand,
    clearCommand,
    copyPrCommand,
    installHookCommand,
    moveToEnvCommand,
    saveDisposable,
    diagnosticsProvider,
    decorationProvider,
    getLogger(),
  );

  log('ShipIt activated successfully.');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
