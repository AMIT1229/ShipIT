import * as vscode from 'vscode';
import { ReviewResult, Issue } from '../storage/models';

/**
 * Provides quick fix code actions for ShipIt issues.
 * Ctrl+. on a diagnostic → shows fix options.
 */
export class CodeActionProvider implements vscode.CodeActionProvider {
  private result: ReviewResult | undefined;
  private cwd: string = '';

  update(result: ReviewResult, cwd: string): void {
    this.result = result;
    this.cwd = cwd;
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    if (!this.result) { return []; }

    const actions: vscode.CodeAction[] = [];

    // Only process ShipIt diagnostics
    const shipItDiags = context.diagnostics.filter(d => d.source === 'ShipIt');

    for (const diag of shipItDiags) {
      const filePath = document.uri.fsPath
        .replace(this.cwd + '/', '')
        .replace(this.cwd + '\\', '');

      const file = this.result.files.find(f => f.path === filePath);
      if (!file) { continue; }

      // Find the matching issue
      const issue = file.issues.find(i =>
        i.line - 1 === diag.range.start.line
      );

      if (!issue?.quickFix) { continue; }

      const action = this.createAction(document, diag, issue);
      if (action) {
        actions.push(action);
      }
    }

    return actions;
  }

  private createAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    issue: Issue
  ): vscode.CodeAction | undefined {
    const quickFix = issue.quickFix!;

    switch (quickFix.kind) {
      case 'remove-line': {
        const action = new vscode.CodeAction(
          quickFix.label,
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        const line = diagnostic.range.start.line;
        const fullLineRange = new vscode.Range(line, 0, line + 1, 0);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.delete(document.uri, fullLineRange);
        return action;
      }

      case 'replace-line': {
        if (!quickFix.replacementText) { return undefined; }
        const action = new vscode.CodeAction(
          quickFix.label,
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, diagnostic.range, quickFix.replacementText);
        return action;
      }

      case 'move-to-env': {
        if (!quickFix.envKey) { return undefined; }
        const action = new vscode.CodeAction(
          quickFix.label,
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        // This one requires a command since it touches multiple files
        action.command = {
          command: 'shipit.moveToEnv',
          title: quickFix.label,
          arguments: [document.uri, diagnostic.range.start.line, quickFix.envKey],
        };
        return action;
      }
    }
  }
}
