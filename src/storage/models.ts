// ─── Git & Diff Types ───────────────────────────────────────────

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export type LineType = 'added' | 'removed' | 'context';

export interface ChangedLine {
  lineNumber: number;
  content: string;
  type: LineType;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ChangedLine[];
}

export interface ChangedFile {
  path: string;
  status: FileStatus;
  hunks: DiffHunk[];
  rawDiff: string;
  additions: number;
  deletions: number;
}

// ─── Analysis Types ─────────────────────────────────────────────

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueSource = 'static' | 'ai';

export interface Issue {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  severity: IssueSeverity;
  source: IssueSource;
  analyzer: string;
  message: string;
  suggestion?: string;
  quickFix?: QuickFixAction;
}

export type QuickFixKind = 'remove-line' | 'replace-line' | 'move-to-env';

export interface QuickFixAction {
  kind: QuickFixKind;
  label: string;
  replacementText?: string;
  envKey?: string;
}

export interface ReviewedFile {
  path: string;
  status: FileStatus;
  issues: Issue[];
  risk: RiskLevel;
  additions: number;
  deletions: number;
}

export type RiskLevel = 'high' | 'medium' | 'low' | 'info';

// ─── Review Result ──────────────────────────────────────────────

export interface ReviewResult {
  files: ReviewedFile[];
  score: number;
  totalIssues: number;
  errors: number;
  warnings: number;
  infos: number;
  prDescription: string;
  timestamp: number;
}

// ─── Review History ─────────────────────────────────────────────

export interface ReviewSnapshot {
  score: number;
  totalIssues: number;
  errors: number;
  warnings: number;
  infos: number;
  timestamp: number;
  fileCount: number;
}

export interface ReviewHistory {
  reviews: ReviewSnapshot[];
  streak: number;
  mostCommonAnalyzer: string;
  analyzerHitCounts: Record<string, number>;
}

// ─── Static Analyzer Interface ──────────────────────────────────

export interface StaticAnalyzer {
  id: string;
  name: string;
  analyze(file: ChangedFile, lines: ChangedLine[]): Issue[];
}

// ─── Webview Messages ───────────────────────────────────────────

export type ExtensionToWebviewMessage =
  | { type: 'reviewResult'; data: ReviewResult }
  | { type: 'reviewHistory'; data: ReviewHistory }
  | { type: 'loading'; data: { message: string } }
  | { type: 'error'; data: { message: string } };

export type WebviewToExtensionMessage =
  | { type: 'copyPrDescription' }
  | { type: 'openFile'; data: { path: string; line: number } }
  | { type: 'reReview' }
  | { type: 'ready' };
