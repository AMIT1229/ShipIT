import * as vscode from 'vscode';

export interface ShipItConfig {
  apiKey: string;
  provider: 'openai' | 'anthropic';
  enableAiReview: boolean;
  analyzers: {
    consoleLog: boolean;
    secrets: boolean;
    todos: boolean;
    largeFunctions: boolean;
    typeAny: boolean;
    debugger: boolean;
    tsDirective: boolean;
  };
  largeFunctionThreshold: number;
  scoreThreshold: number;
  autoReviewOnSave: boolean;
}

export function getConfig(): ShipItConfig {
  const cfg = vscode.workspace.getConfiguration('shipit');
  return {
    apiKey: cfg.get<string>('apiKey', ''),
    provider: cfg.get<'openai' | 'anthropic'>('provider', 'openai'),
    enableAiReview: cfg.get<boolean>('enableAiReview', true),
    analyzers: {
      consoleLog: cfg.get<boolean>('analyzers.consoleLog', true),
      secrets: cfg.get<boolean>('analyzers.secrets', true),
      todos: cfg.get<boolean>('analyzers.todos', true),
      largeFunctions: cfg.get<boolean>('analyzers.largeFunctions', true),
      typeAny: cfg.get<boolean>('analyzers.typeAny', true),
      debugger: cfg.get<boolean>('analyzers.debugger', true),
      tsDirective: cfg.get<boolean>('analyzers.tsDirective', true),
    },
    largeFunctionThreshold: cfg.get<number>('largeFunctionThreshold', 50),
    scoreThreshold: cfg.get<number>('scoreThreshold', 80),
    autoReviewOnSave: cfg.get<boolean>('autoReviewOnSave', false),
  };
}
