import * as vscode from 'vscode';
import * as path from 'path';
import { ReviewResult, ReviewedFile, Issue, RiskLevel } from '../storage/models';

type TreeElement = FileTreeItem | IssueTreeItem;

export class ReviewTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private result: ReviewResult | undefined;
  private cwd: string = '';

  update(result: ReviewResult, cwd: string): void {
    this.result = result;
    this.cwd = cwd;
    this._onDidChangeTreeData.fire(undefined);
  }

  clear(): void {
    this.result = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!this.result) {
      return [];
    }

    // Root level — show files
    if (!element) {
      return this.result.files.map(f => new FileTreeItem(f, this.cwd));
    }

    // File level — show issues
    if (element instanceof FileTreeItem) {
      return element.reviewedFile.issues.map(i => new IssueTreeItem(i, this.cwd));
    }

    return [];
  }
}

class FileTreeItem extends vscode.TreeItem {
  constructor(public readonly reviewedFile: ReviewedFile, cwd: string) {
    const issueCount = reviewedFile.issues.length;
    const label = reviewedFile.path;
    super(label, issueCount > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None
    );

    this.description = issueCount > 0
      ? `${issueCount} issue${issueCount !== 1 ? 's' : ''}`
      : '✅ clean';

    this.iconPath = this.getIcon(reviewedFile.risk);
    this.tooltip = `${reviewedFile.path}\nRisk: ${reviewedFile.risk}\n+${reviewedFile.additions} -${reviewedFile.deletions}`;
    this.contextValue = 'file';

    if (issueCount === 0) {
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [vscode.Uri.file(path.join(cwd, reviewedFile.path))],
      };
    }
  }

  private getIcon(risk: RiskLevel): vscode.ThemeIcon {
    switch (risk) {
      case 'high': return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      case 'medium': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
      case 'low': return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
      case 'info': return new vscode.ThemeIcon('info');
    }
  }
}

class IssueTreeItem extends vscode.TreeItem {
  constructor(issue: Issue, cwd: string) {
    super(issue.message, vscode.TreeItemCollapsibleState.None);

    this.description = `L${issue.line}`;
    this.tooltip = issue.suggestion ?? issue.message;
    this.iconPath = this.getIcon(issue.severity);
    this.contextValue = 'issue';

    this.command = {
      command: 'vscode.open',
      title: 'Go to Issue',
      arguments: [
        vscode.Uri.file(path.join(cwd, issue.file)),
        { selection: new vscode.Range(issue.line - 1, 0, issue.line - 1, 999) },
      ],
    };
  }

  private getIcon(severity: string): vscode.ThemeIcon {
    switch (severity) {
      case 'error': return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      case 'warning': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
      default: return new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground'));
    }
  }
}
