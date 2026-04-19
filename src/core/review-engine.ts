import * as fs from 'fs';
import * as path from 'path';
import { ChangedFile, ChangedLine, Issue, ReviewedFile, ReviewResult, RiskLevel } from '../storage/models';
import { detectChanges } from './change-detector';
import { createAnalyzers, resetIssueCounter } from './static-analyzers';
import { aiReviewFile } from './ai-reviewer';
import { calculateScore } from '../generators/score-calculator';
import { generatePrDescription } from '../generators/pr-description';
import { log } from '../utils/logger';

interface ReviewEngineConfig {
  cwd: string;
  analyzers: {
    consoleLog: boolean;
    secrets: boolean;
    todos: boolean;
    largeFunctions: boolean;
    typeAny: boolean;
    debugger: boolean;
  };
  largeFunctionThreshold: number;
  aiConfig?: {
    apiKey: string;
    provider: 'openai' | 'anthropic';
  };
}

/**
 * Orchestrates the full review pipeline:
 * 1. Detect git changes
 * 2. Parse diffs
 * 3. Run static analyzers (instant, local)
 * 4. Optionally run AI review (async, API call)
 * 5. Calculate score, generate PR description
 */
export async function runReview(config: ReviewEngineConfig): Promise<ReviewResult> {
  resetIssueCounter();
  log('Starting review...');

  // Step 1: Detect changes
  const changedFiles = detectChanges(config.cwd);
  log(`Found ${changedFiles.length} changed files`);

  if (changedFiles.length === 0) {
    return emptyResult();
  }

  // Step 2: Create analyzers
  const analyzers = createAnalyzers({
    ...config.analyzers,
    largeFunctionThreshold: config.largeFunctionThreshold,
  });

  // Step 3: Run static analysis + optional AI review per file
  const reviewedFiles: ReviewedFile[] = await Promise.all(
    changedFiles.map(async (file) => {
      const allIssues: Issue[] = [];

      // Get added lines for static analysis
      const addedLines = getAddedLines(file);

      // Run each static analyzer
      for (const analyzer of analyzers) {
        const issues = analyzer.analyze(file, addedLines);
        allIssues.push(...issues);
      }

      // Run AI review if configured
      if (config.aiConfig?.apiKey) {
        const fileContent = readFileContent(config.cwd, file.path);
        if (fileContent) {
          const aiIssues = await aiReviewFile(file, fileContent, config.aiConfig);
          allIssues.push(...aiIssues);
        }
      }

      // Calculate risk level
      const risk = calculateRisk(file, allIssues);

      return {
        path: file.path,
        status: file.status,
        issues: allIssues,
        risk,
        additions: file.additions,
        deletions: file.deletions,
      };
    })
  );

  // Step 4: Aggregate results
  const allIssues = reviewedFiles.flatMap(f => f.issues);
  const score = calculateScore(allIssues);
  const prDescription = generatePrDescription(reviewedFiles);

  const result: ReviewResult = {
    files: reviewedFiles.sort((a, b) => riskOrder(a.risk) - riskOrder(b.risk)),
    score,
    totalIssues: allIssues.length,
    errors: allIssues.filter(i => i.severity === 'error').length,
    warnings: allIssues.filter(i => i.severity === 'warning').length,
    infos: allIssues.filter(i => i.severity === 'info').length,
    prDescription,
    timestamp: Date.now(),
  };

  log(`Review complete: score ${score}, ${allIssues.length} issues`);
  return result;
}

function getAddedLines(file: ChangedFile): ChangedLine[] {
  const lines: ChangedLine[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'added') {
        lines.push(line);
      }
    }
  }
  return lines;
}

function readFileContent(cwd: string, filePath: string): string | null {
  try {
    return fs.readFileSync(path.join(cwd, filePath), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Calculates risk level based on file path, change size, and issues.
 */
function calculateRisk(file: ChangedFile, issues: Issue[]): RiskLevel {
  const hasErrors = issues.some(i => i.severity === 'error');
  if (hasErrors) { return 'high'; }

  // Security-sensitive paths
  const sensitivePaths = /\b(auth|security|payment|middleware|session|crypto|login|token)\b/i;
  if (sensitivePaths.test(file.path)) { return 'high'; }

  const hasWarnings = issues.some(i => i.severity === 'warning');
  const largeChange = file.additions + file.deletions > 100;
  if (hasWarnings || largeChange) { return 'medium'; }

  if (issues.length > 0) { return 'low'; }

  // Config/meta file changes
  if (/\.(json|yml|yaml|toml|lock)$/.test(file.path)) { return 'info'; }

  return 'low';
}

function riskOrder(risk: RiskLevel): number {
  const order: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return order[risk];
}

function emptyResult(): ReviewResult {
  return {
    files: [],
    score: 100,
    totalIssues: 0,
    errors: 0,
    warnings: 0,
    infos: 0,
    prDescription: 'No changes detected.',
    timestamp: Date.now(),
  };
}
