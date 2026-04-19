import * as vscode from 'vscode';
import { ReviewResult } from '../storage/models';

export class CodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private result: ReviewResult | undefined;
  private cwd: string = '';

  update(result: ReviewResult, cwd: string): void {
    this.result = result;
    this.cwd = cwd;
    this._onDidChangeCodeLenses.fire();
  }

  clear(): void {
    this.result = undefined;
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.result) { return []; }

    const filePath = document.uri.fsPath
      .replace(this.cwd + '/', '')
      .replace(this.cwd + '\\', '');

    const reviewedFile = this.result.files.find(f => f.path === filePath);
    if (!reviewedFile || reviewedFile.issues.length === 0) { return []; }

    // Group issues by nearby lines (within 5 lines = same group)
    const groups = groupIssuesByProximity(reviewedFile.issues.map(i => i.line));
    const lenses: vscode.CodeLens[] = [];

    for (const group of groups) {
      const line = Math.max(0, group.startLine - 1);
      const range = new vscode.Range(line, 0, line, 0);
      const issueCount = group.count;
      const errCount = reviewedFile.issues.filter(
        i => i.line >= group.startLine && i.line <= group.endLine && i.severity === 'error'
      ).length;
      const warnCount = issueCount - errCount;

      const parts: string[] = [];
      if (errCount > 0) { parts.push(`${errCount} error${errCount > 1 ? 's' : ''}`); }
      if (warnCount > 0) { parts.push(`${warnCount} warning${warnCount > 1 ? 's' : ''}`); }

      lenses.push(new vscode.CodeLens(range, {
        title: `$(shield) ShipIt: ${parts.join(', ')}`,
        command: 'shipit.review',
        tooltip: `${issueCount} issue${issueCount > 1 ? 's' : ''} found in this region`,
      }));
    }

    return lenses;
  }
}

interface IssueGroup {
  startLine: number;
  endLine: number;
  count: number;
}

function groupIssuesByProximity(lines: number[]): IssueGroup[] {
  if (lines.length === 0) { return []; }

  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const groups: IssueGroup[] = [];
  let current: IssueGroup = { startLine: sorted[0], endLine: sorted[0], count: 1 };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - current.endLine <= 5) {
      current.endLine = sorted[i];
      current.count++;
    } else {
      groups.push(current);
      current = { startLine: sorted[i], endLine: sorted[i], count: 1 };
    }
  }
  groups.push(current);

  return groups;
}
