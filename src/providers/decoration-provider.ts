import * as vscode from 'vscode';
import { ReviewResult } from '../storage/models';

export class DecorationProvider {
  private addedDecorationType: vscode.TextEditorDecorationType;
  private modifiedDecorationType: vscode.TextEditorDecorationType;
  private issueDecorationType: vscode.TextEditorDecorationType;

  private result: ReviewResult | undefined;
  private cwd: string = '';

  constructor() {
    this.addedDecorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: undefined,
      overviewRulerColor: '#2ea04370',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: '#2ea04370',
    });

    this.modifiedDecorationType = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: '#d29e2e70',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: '#d29e2e70',
    });

    this.issueDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: '#ff000015',
      overviewRulerColor: '#ff000070',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  }

  update(result: ReviewResult, cwd: string): void {
    this.result = result;
    this.cwd = cwd;
    this.applyToVisibleEditors();
  }

  applyToVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyToEditor(editor);
    }
  }

  clear(): void {
    this.result = undefined;
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.addedDecorationType, []);
      editor.setDecorations(this.modifiedDecorationType, []);
      editor.setDecorations(this.issueDecorationType, []);
    }
  }

  dispose(): void {
    this.addedDecorationType.dispose();
    this.modifiedDecorationType.dispose();
    this.issueDecorationType.dispose();
  }

  private applyToEditor(editor: vscode.TextEditor): void {
    if (!this.result) { return; }

    const filePath = editor.document.uri.fsPath.replace(this.cwd + '/', '').replace(this.cwd + '\\', '');
    const reviewedFile = this.result.files.find(f => f.path === filePath);

    if (!reviewedFile) {
      editor.setDecorations(this.addedDecorationType, []);
      editor.setDecorations(this.modifiedDecorationType, []);
      editor.setDecorations(this.issueDecorationType, []);
      return;
    }

    // Issue lines
    const issueRanges: vscode.Range[] = reviewedFile.issues.map(issue => {
      const line = Math.max(0, issue.line - 1);
      return new vscode.Range(line, 0, line, 999);
    });

    editor.setDecorations(this.issueDecorationType, issueRanges);
    editor.setDecorations(this.addedDecorationType, []); // TODO: populate from hunks if needed
  }
}
