import * as vscode from 'vscode';
import { ReviewResult, IssueSeverity } from '../storage/models';

export class DiagnosticsProvider {
  private collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('shipit');
  }

  update(result: ReviewResult, cwd: string): void {
    // Clear all previous diagnostics first
    this.collection.clear();

    // Group issues by file
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const file of result.files) {
      const diagnostics: vscode.Diagnostic[] = [];

      for (const issue of file.issues) {
        const line = Math.max(0, issue.line - 1);
        const endLine = issue.endLine ? Math.max(0, issue.endLine - 1) : line;
        const range = new vscode.Range(line, 0, endLine, 999);

        const diagnostic = new vscode.Diagnostic(
          range,
          issue.message,
          this.mapSeverity(issue.severity)
        );

        diagnostic.source = 'ShipIt';
        diagnostic.code = `${issue.analyzer}${issue.source === 'ai' ? ' (AI)' : ''}`;

        if (issue.suggestion) {
          diagnostic.message += `\n💡 ${issue.suggestion}`;
        }

        diagnostics.push(diagnostic);
      }

      if (diagnostics.length > 0) {
        const uri = vscode.Uri.file(`${cwd}/${file.path}`);
        byFile.set(file.path, diagnostics);
        this.collection.set(uri, diagnostics);
      }
    }
  }

  clear(): void {
    this.collection.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }

  private mapSeverity(severity: IssueSeverity): vscode.DiagnosticSeverity {
    switch (severity) {
      case 'error': return vscode.DiagnosticSeverity.Error;
      case 'warning': return vscode.DiagnosticSeverity.Warning;
      case 'info': return vscode.DiagnosticSeverity.Information;
    }
  }
}
