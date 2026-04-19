import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function getLogger(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('ShipIt');
  }
  return outputChannel;
}

export function log(message: string): void {
  getLogger().appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const errorMsg = error instanceof Error ? error.message : String(error ?? '');
  getLogger().appendLine(`[${new Date().toLocaleTimeString()}] ERROR: ${message} ${errorMsg}`);
}
