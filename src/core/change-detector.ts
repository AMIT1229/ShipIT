import * as fs from 'fs';
import * as path from 'path';
import { ChangedFile, ChangedLine, DiffHunk, FileStatus } from '../storage/models';
import { execGit } from '../utils/git';
import { parseDiff } from './diff-parser';

/**
 * Detects all changed files in the working tree (staged + unstaged).
 * Pure orchestration — delegates to git CLI and diff-parser.
 */
export function detectChanges(cwd: string): ChangedFile[] {
  // Check if repo has any commits
  const hasCommits = execGit('rev-parse HEAD', cwd) !== '';

  // Get both staged and unstaged changes
  // For fresh repos with no commits, diff staged files against the empty tree
  const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf899d15f6778c8d';
  const stagedDiff = hasCommits
    ? execGit('diff --staged --unified=3', cwd)
    : execGit(`diff-index -p --unified=3 --cached ${EMPTY_TREE}`, cwd);
  const unstagedDiff = hasCommits ? execGit('diff --unified=3', cwd) : '';

  // Also get untracked files (new files not yet staged)
  const untrackedRaw = execGit('ls-files --others --exclude-standard', cwd);
  const untrackedFiles = untrackedRaw ? untrackedRaw.split('\n').filter(Boolean) : [];

  // Also get staged files list — for fresh repos, these need to be analyzed too
  const stagedListCmd = hasCommits ? 'diff --cached --name-only' : 'ls-files --cached';
  const stagedListRaw = execGit(stagedListCmd, cwd);
  const stagedList = stagedListRaw ? stagedListRaw.split('\n').filter(Boolean) : [];

  // Parse diffs into structured data
  const stagedFiles = stagedDiff ? parseDiff(stagedDiff) : [];
  const unstagedFiles = unstagedDiff ? parseDiff(unstagedDiff) : [];

  // Merge staged and unstaged — staged takes priority if both exist
  const fileMap = new Map<string, ChangedFile>();

  for (const file of stagedFiles) {
    fileMap.set(file.path, file);
  }

  for (const file of unstagedFiles) {
    const existing = fileMap.get(file.path);
    if (existing) {
      // Merge hunks from unstaged into staged
      existing.hunks.push(...file.hunks);
      existing.additions += file.additions;
      existing.deletions += file.deletions;
      existing.rawDiff += '\n' + file.rawDiff;
    } else {
      fileMap.set(file.path, file);
    }
  }

  // Add untracked files as "added" with synthetic hunks from file content
  for (const filePath of untrackedFiles) {
    if (!fileMap.has(filePath)) {
      const fullPath = path.join(cwd, filePath);
      let content = '';
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        // Binary or unreadable — skip
        continue;
      }

      const fileLines = content.split('\n');
      const changedLines: ChangedLine[] = fileLines.map((line, i) => ({
        lineNumber: i + 1,
        content: line,
        type: 'added' as const,
      }));

      const hunk: DiffHunk = {
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: fileLines.length,
        lines: changedLines,
      };

      fileMap.set(filePath, {
        path: filePath,
        status: 'added' as FileStatus,
        hunks: [hunk],
        rawDiff: content,
        additions: fileLines.length,
        deletions: 0,
      });
    }
  }

  // Fallback: staged files that weren't picked up by diff (e.g. fresh repo, no commits)
  // Read them from disk and create synthetic hunks
  for (const filePath of stagedList) {
    if (!fileMap.has(filePath)) {
      const fullPath = path.join(cwd, filePath);
      let content = '';
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const fileLines = content.split('\n');
      const changedLines: ChangedLine[] = fileLines.map((line, i) => ({
        lineNumber: i + 1,
        content: line,
        type: 'added' as const,
      }));

      const hunk: DiffHunk = {
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: fileLines.length,
        lines: changedLines,
      };

      fileMap.set(filePath, {
        path: filePath,
        status: 'added' as FileStatus,
        hunks: [hunk],
        rawDiff: content,
        additions: fileLines.length,
        deletions: 0,
      });
    }
  }

  return Array.from(fileMap.values());
}
