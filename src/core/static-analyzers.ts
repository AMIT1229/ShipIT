import {
  ChangedFile,
  ChangedLine,
  Issue,
  StaticAnalyzer,
  QuickFixAction,
} from '../storage/models';

let issueCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++issueCounter}`;
}

/** File extensions that contain code (not documentation/config). */
const CODE_EXTENSIONS = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|vue|svelte|py|rb|go|rs|java|kt|cs|c|cpp|h|hpp|php|swift|sh|bash|zsh|ps1)$/;

/** Files that should be skipped by all code-quality analyzers. */
function isNonCodeFile(filePath: string): boolean {
  return !CODE_EXTENSIONS.test(filePath);
}

// ─── Console Log Analyzer ───────────────────────────────────────

export class ConsoleLogAnalyzer implements StaticAnalyzer {
  id = 'console-log';
  name = 'Console Log Detector';

  private jsPattern = /\bconsole\.(log|warn|error|debug|info|trace|dir|table)\s*\(/;
  private pyPattern = /\bprint\s*\(/;

  analyze(file: ChangedFile, lines: ChangedLine[]): Issue[] {
    const issues: Issue[] = [];
    if (isNonCodeFile(file.path)) { return issues; }

    const isPython = /\.py$/.test(file.path);

    for (const line of lines) {
      if (line.type !== 'added') { continue; }

      if (!isPython && this.jsPattern.test(line.content)) {
        const match = line.content.match(this.jsPattern);
        issues.push({
          id: nextId(this.id),
          file: file.path,
          line: line.lineNumber,
          severity: 'warning',
          source: 'static',
          analyzer: this.id,
          message: `console.${match?.[1] ?? 'log'} left in code`,
          suggestion: 'Remove before pushing, or use a proper logging utility.',
          quickFix: {
            kind: 'remove-line',
            label: 'Remove this console statement',
          },
        });
      } else if (isPython && this.pyPattern.test(line.content)) {
        // Skip common false positives: print used in argparse, help text, etc.
        if (/^\s*#/.test(line.content)) { continue; }
        issues.push({
          id: nextId(this.id),
          file: file.path,
          line: line.lineNumber,
          severity: 'warning',
          source: 'static',
          analyzer: this.id,
          message: 'print() statement left in code',
          suggestion: 'Remove before pushing, or use the logging module.',
          quickFix: {
            kind: 'remove-line',
            label: 'Remove this print statement',
          },
        });
      }
    }
    return issues;
  }
}

// ─── Debugger Statement Analyzer ────────────────────────────────

export class DebuggerAnalyzer implements StaticAnalyzer {
  id = 'debugger';
  name = 'Debugger Statement Detector';

  analyze(file: ChangedFile, lines: ChangedLine[]): Issue[] {
    const issues: Issue[] = [];
    if (isNonCodeFile(file.path)) { return issues; }

    const isPython = /\.py$/.test(file.path);

    for (const line of lines) {
      if (line.type !== 'added') { continue; }

      // JS/TS: debugger statement
      if (!isPython && /\bdebugger\b/.test(line.content)) {
        issues.push({
          id: nextId(this.id),
          file: file.path,
          line: line.lineNumber,
          severity: 'error',
          source: 'static',
          analyzer: this.id,
          message: 'debugger statement left in code',
          suggestion: 'Remove the debugger statement before pushing.',
          quickFix: {
            kind: 'remove-line',
            label: 'Remove debugger statement',
          },
        });
      }

      // Python: pdb.set_trace(), breakpoint(), import pdb
      if (isPython) {
        if (/\bpdb\.set_trace\s*\(/.test(line.content) || /\bbreakpoint\s*\(/.test(line.content)) {
          issues.push({
            id: nextId(this.id),
            file: file.path,
            line: line.lineNumber,
            severity: 'error',
            source: 'static',
            analyzer: this.id,
            message: 'Python debugger breakpoint left in code',
            suggestion: 'Remove pdb/breakpoint() before pushing.',
            quickFix: {
              kind: 'remove-line',
              label: 'Remove debugger breakpoint',
            },
          });
        } else if (/\bimport\s+pdb\b/.test(line.content)) {
          issues.push({
            id: nextId(this.id),
            file: file.path,
            line: line.lineNumber,
            severity: 'warning',
            source: 'static',
            analyzer: this.id,
            message: 'pdb import left in code',
            suggestion: 'Remove the pdb import before pushing.',
            quickFix: {
              kind: 'remove-line',
              label: 'Remove pdb import',
            },
          });
        }
      }
    }
    return issues;
  }
}

// ─── Secret / API Key Analyzer ──────────────────────────────────

export class SecretAnalyzer implements StaticAnalyzer {
  id = 'secrets';
  name = 'Hardcoded Secret Detector';

  /** Well-known token prefixes that match anywhere. */
  private universalPatterns: { regex: RegExp; label: string }[] = [
    { regex: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key' },
    { regex: /(?:sk-|pk_live_|sk_live_|pk_test_|sk_test_)[a-zA-Z0-9]{20,}/, label: 'API secret key' },
    { regex: /ghp_[a-zA-Z0-9]{36}/, label: 'GitHub personal access token' },
    { regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, label: 'Private key' },
    { regex: /eyJ[a-zA-Z0-9\-_]+\.eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/, label: 'JWT token' },
    { regex: /xox[bpsar]-[a-zA-Z0-9\-]{10,}/, label: 'Slack token' },
    { regex: /SG\.[a-zA-Z0-9\-_]{22,}\.[a-zA-Z0-9\-_]{22,}/, label: 'SendGrid API key' },
  ];

  /** Patterns for code files (values in quotes). */
  private codePatterns: { regex: RegExp; label: string }[] = [
    { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i, label: 'API key' },
    { regex: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i, label: 'Secret/password' },
    { regex: /(?:Bearer|bearer)\s+[a-zA-Z0-9\-_.]{20,}/, label: 'Bearer token' },
  ];

  /** Patterns for .env files (KEY=value, no quotes required). */
  private envPatterns: { regex: RegExp; label: string }[] = [
    { regex: /^[A-Z_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|KEY|APIKEY|API_KEY)[A-Z_]*\s*=\s*\S{8,}/i, label: 'Secret/credential' },
    { regex: /^DATABASE_URL\s*=\s*\S+:\/\/\S+:\S+@/i, label: 'Database connection string with password' },
  ];

  /** Patterns for YAML files (CI/CD, k8s, docker-compose). */
  private yamlPatterns: { regex: RegExp; label: string }[] = [
    { regex: /(?:password|passwd|secret|token|api_?key|apikey)\s*:\s*['"]?[^'"#\s]{8,}/i, label: 'Secret in YAML' },
    { regex: /(?:POSTGRES_PASSWORD|MYSQL_ROOT_PASSWORD|MYSQL_PASSWORD|REDIS_PASSWORD)\s*:\s*\S+/i, label: 'Database password in YAML' },
    { regex: /(?:--build-arg|ARG)\s+\w*(?:SECRET|TOKEN|PASSWORD|KEY)\w*\s*=\s*\S{8,}/i, label: 'Secret in build argument' },
    { regex: /(?:Authorization|Bearer)\s*:\s*['"]?[a-zA-Z0-9\-_.]{20,}/i, label: 'Auth header in YAML' },
    { regex: /value:\s*['"]?[a-zA-Z0-9\-_.]{20,}['"]?\s*$/i, label: 'Potential secret value' },
  ];

  /** Patterns for Dockerfiles (ARG, ENV with secrets). */
  private dockerPatterns: { regex: RegExp; label: string }[] = [
    { regex: /(?:ARG|ENV)\s+\w*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|KEY|APIKEY|API_KEY)\w*\s*=\s*\S{8,}/i, label: 'Secret in Docker ARG/ENV' },
    { regex: /(?:ARG|ENV)\s+\w*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|KEY|APIKEY|API_KEY)\w*\s+\S{8,}/i, label: 'Secret in Docker ARG/ENV' },
    { regex: /curl\s.*(?:Authorization|Bearer|token)\s*[:=]\s*\S{8,}/i, label: 'Auth token in curl command' },
  ];

  /** Patterns for SQL files (passwords in connection strings, grants). */
  private sqlPatterns: { regex: RegExp; label: string }[] = [
    { regex: /(?:PASSWORD|IDENTIFIED\s+BY)\s*(?:=|')\s*'[^']{6,}'/i, label: 'SQL password' },
    { regex: /(?:password|passwd|pwd)\s*=\s*['"][^'"]{6,}['"]/i, label: 'Connection password in SQL' },
    { regex: /:\/\/\w+:[^@\s]{6,}@/i, label: 'Connection string with password' },
  ];

  /** Patterns for JSON files (config, package manifests). */
  private jsonPatterns: { regex: RegExp; label: string }[] = [
    { regex: /["'](?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth)["']\s*:\s*["'][^"']{8,}["']/i, label: 'Secret in JSON' },
    { regex: /["'](?:connection[_-]?string|database[_-]?url|redis[_-]?url)["']\s*:\s*["'][^"']*:\/\/\w+:[^@"']+@/i, label: 'Connection string with credentials' },
  ];

  /** File types the secret analyzer supports beyond code files. */
  private static SECRET_SCAN_FILES = /\.env(\..*)?$|\.ya?ml$|Dockerfile|\.dockerignore$|\.sql$|\.json$/i;
  private static COMMENT_PATTERNS: Record<string, RegExp> = {
    env: /^\s*(#|$)/,
    yaml: /^\s*#/,
    docker: /^\s*#/,
    sql: /^\s*--/,
  };

  analyze(file: ChangedFile, lines: ChangedLine[]): Issue[] {
    const issues: Issue[] = [];
    const fileType = this.getFileType(file.path);

    // Skip files we don't scan
    if (!fileType) {
      return issues;
    }

    const patterns = this.getPatternsForType(fileType);
    const commentRegex = SecretAnalyzer.COMMENT_PATTERNS[fileType];

    for (const line of lines) {
      if (line.type !== 'added') { continue; }

      // Skip comments
      if (commentRegex && commentRegex.test(line.content)) { continue; }

      for (const { regex, label } of patterns) {
        if (regex.test(line.content)) {
          const { message, suggestion } = this.buildMessage(fileType, label, line.content);
          const envKey = fileType === 'code' ? this.suggestEnvKey(line.content) : undefined;
          issues.push({
            id: nextId(this.id),
            file: file.path,
            line: line.lineNumber,
            severity: 'error',
            source: 'static',
            analyzer: this.id,
            message,
            suggestion,
            quickFix: fileType === 'code' && envKey
              ? { kind: 'move-to-env', label: `Move to .env as ${envKey}`, envKey }
              : undefined,
          });
          break; // One issue per line
        }
      }
    }
    return issues;
  }

  private getFileType(filePath: string): string | null {
    if (/\.env(\..*)?$/.test(filePath)) { return 'env'; }
    if (/\.ya?ml$/.test(filePath)) { return 'yaml'; }
    if (/Dockerfile/.test(filePath)) { return 'docker'; }
    if (/\.sql$/.test(filePath)) { return 'sql'; }
    if (/\.json$/.test(filePath)) { return 'json'; }
    if (CODE_EXTENSIONS.test(filePath)) { return 'code'; }
    return null;
  }

  private getPatternsForType(type: string): { regex: RegExp; label: string }[] {
    switch (type) {
      case 'env': return [...this.envPatterns, ...this.universalPatterns];
      case 'yaml': return [...this.yamlPatterns, ...this.universalPatterns];
      case 'docker': return [...this.dockerPatterns, ...this.universalPatterns];
      case 'sql': return [...this.sqlPatterns, ...this.universalPatterns];
      case 'json': return [...this.jsonPatterns, ...this.universalPatterns];
      case 'code': return [...this.codePatterns, ...this.universalPatterns];
      default: return this.universalPatterns;
    }
  }

  private buildMessage(fileType: string, label: string, _content: string): { message: string; suggestion: string } {
    switch (fileType) {
      case 'env':
        return {
          message: `Possible ${label} committed in .env file`,
          suggestion: 'Ensure .env is in .gitignore and never committed to version control.',
        };
      case 'yaml':
        return {
          message: `${label} — secret in CI/CD or config YAML`,
          suggestion: 'Use variable substitution, sealed secrets, or a secrets manager instead of hardcoding.',
        };
      case 'docker':
        return {
          message: `${label} — secret exposed in Dockerfile`,
          suggestion: 'Use --secret flag, multi-stage builds, or runtime env variables instead of build-time secrets.',
        };
      case 'sql':
        return {
          message: `${label} — credential in SQL file`,
          suggestion: 'Use parameterized connections or environment variables. Never commit passwords in SQL scripts.',
        };
      case 'json':
        return {
          message: `${label} — credential in JSON config`,
          suggestion: 'Move sensitive values to environment variables or a secrets manager.',
        };
      default:
        return {
          message: `Possible hardcoded ${label} detected`,
          suggestion: 'Move this to an environment variable.',
        };
    }
  }

  private suggestEnvKey(content: string): string {
    const match = content.match(/(?:const|let|var)\s+(\w+)/);
    if (match) {
      return match[1].replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    }
    return 'SECRET_VALUE';
  }
}

// ─── TODO / FIXME Analyzer ──────────────────────────────────────

export class TodoAnalyzer implements StaticAnalyzer {
  id = 'todos';
  name = 'TODO/FIXME Detector';

  analyze(file: ChangedFile, lines: ChangedLine[]): Issue[] {
    const issues: Issue[] = [];
    if (isNonCodeFile(file.path)) { return issues; }
    const pattern = /\b(TODO|FIXME|HACK|XXX|BUG)\b[:\s]*(.*)/i;

    for (const line of lines) {
      if (line.type !== 'added') { continue; }
      const match = line.content.match(pattern);
      if (match) {
        issues.push({
          id: nextId(this.id),
          file: file.path,
          line: line.lineNumber,
          severity: 'info',
          source: 'static',
          analyzer: this.id,
          message: `${match[1].toUpperCase()} comment: ${match[2]?.trim() || '(no description)'}`,
          suggestion: 'Resolve this before pushing, or create a tracking issue.',
        });
      }
    }
    return issues;
  }
}

// ─── Large Function Analyzer ────────────────────────────────────

export class LargeFunctionAnalyzer implements StaticAnalyzer {
  id = 'large-functions';
  name = 'Large Function Detector';

  constructor(private threshold: number = 50) {}

  analyze(file: ChangedFile, _lines: ChangedLine[]): Issue[] {
    const issues: Issue[] = [];
    if (isNonCodeFile(file.path)) { return issues; }

    // Work on the full diff to find function boundaries
    for (const hunk of file.hunks) {
      const addedLines = hunk.lines.filter(l => l.type === 'added');
      if (addedLines.length < this.threshold) { continue; }

      // Check if there's a function-like pattern near the start
      const firstFewLines = hunk.lines.slice(0, 5).map(l => l.content).join('\n');
      const funcMatch = firstFewLines.match(
        /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=.*(?:=>|\bfunction\b)|(\w+)\s*\([^)]*\)\s*{)/
      );

      if (funcMatch || addedLines.length >= this.threshold) {
        const funcName = funcMatch?.[1] ?? funcMatch?.[2] ?? funcMatch?.[3] ?? 'anonymous';
        issues.push({
          id: nextId(this.id),
          file: file.path,
          line: hunk.newStart,
          endLine: hunk.newStart + hunk.newCount,
          severity: 'warning',
          source: 'static',
          analyzer: this.id,
          message: `Large change block (${addedLines.length} lines added${funcName !== 'anonymous' ? ` in ${funcName}` : ''}) — consider breaking this up`,
          suggestion: `Functions over ${this.threshold} lines are harder to review and test. Consider extracting helpers.`,
        });
      }
    }
    return issues;
  }
}

// ─── TypeScript `any` Analyzer ──────────────────────────────────

export class TypeAnyAnalyzer implements StaticAnalyzer {
  id = 'type-any';
  name = 'TypeScript Any Detector';

  analyze(file: ChangedFile, lines: ChangedLine[]): Issue[] {
    // Only analyze TypeScript files
    if (!/\.(ts|tsx)$/.test(file.path)) { return []; }

    const issues: Issue[] = [];
    const pattern = /:\s*any\b/;

    for (const line of lines) {
      if (line.type !== 'added') { continue; }
      if (pattern.test(line.content)) {
        issues.push({
          id: nextId(this.id),
          file: file.path,
          line: line.lineNumber,
          severity: 'warning',
          source: 'static',
          analyzer: this.id,
          message: 'Type `any` used — weakens type safety',
          suggestion: 'Use a specific type, `unknown`, or a generic instead.',
        });
      }
    }
    return issues;
  }
}

// ─── @ts-ignore / @ts-nocheck Analyzer ──────────────────────────

export class TsDirectiveAnalyzer implements StaticAnalyzer {
  id = 'ts-directive';
  name = 'TypeScript Suppression Detector';

  analyze(file: ChangedFile, lines: ChangedLine[]): Issue[] {
    // Only analyze TypeScript/JavaScript files
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(file.path)) { return []; }

    const issues: Issue[] = [];
    const pattern = /@ts-(ignore|nocheck|expect-error)\b/;

    for (const line of lines) {
      if (line.type !== 'added') { continue; }
      const match = line.content.match(pattern);
      if (match) {
        const directive = match[1];
        issues.push({
          id: nextId(this.id),
          file: file.path,
          line: line.lineNumber,
          severity: directive === 'nocheck' ? 'error' : 'warning',
          source: 'static',
          analyzer: this.id,
          message: `@ts-${directive} suppresses type checking`,
          suggestion: directive === 'expect-error'
            ? 'Acceptable for tests, but fix the underlying type issue when possible.'
            : `Remove @ts-${directive} and fix the type error instead.`,
          quickFix: {
            kind: 'remove-line',
            label: `Remove @ts-${directive} comment`,
          },
        });
      }
    }
    return issues;
  }
}

// ─── Export All Analyzers ───────────────────────────────────────

export function createAnalyzers(config: {
  consoleLog: boolean;
  secrets: boolean;
  todos: boolean;
  largeFunctions: boolean;
  typeAny: boolean;
  debugger: boolean;
  tsDirective?: boolean;
  largeFunctionThreshold?: number;
}): StaticAnalyzer[] {
  const analyzers: StaticAnalyzer[] = [];

  if (config.consoleLog) { analyzers.push(new ConsoleLogAnalyzer()); }
  if (config.debugger) { analyzers.push(new DebuggerAnalyzer()); }
  if (config.secrets) { analyzers.push(new SecretAnalyzer()); }
  if (config.todos) { analyzers.push(new TodoAnalyzer()); }
  if (config.largeFunctions) { analyzers.push(new LargeFunctionAnalyzer(config.largeFunctionThreshold)); }
  if (config.typeAny) { analyzers.push(new TypeAnyAnalyzer()); }
  if (config.tsDirective !== false) { analyzers.push(new TsDirectiveAnalyzer()); }

  return analyzers;
}

export function resetIssueCounter(): void {
  issueCounter = 0;
}
