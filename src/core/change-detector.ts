import { ChangedFile, FileStatus } from '../storage/models';
import { execGit } from '../utils/git';
import { parseDiff } from './diff-parser';

/**
 * Detects all changed files in the working tree (staged + unstaged).
 * Pure orchestration — delegates to git CLI and diff-parser.
 */
export function detectChanges(cwd: string): ChangedFile[] {
  // Get both staged and unstaged changes
  const stagedDiff = execGit('diff --staged --unified=3', cwd);
  const unstagedDiff = execGit('diff --unified=3', cwd);

  // Also get untracked files (new files not yet staged)
  const untrackedRaw = execGit('ls-files --others --exclude-standard', cwd);
  const untrackedFiles = untrackedRaw ? untrackedRaw.split('\n').filter(Boolean) : [];

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

  // Add untracked files as "added" with no diff hunks
  for (const filePath of untrackedFiles) {
    if (!fileMap.has(filePath)) {
      fileMap.set(filePath, {
        path: filePath,
        status: 'added' as FileStatus,
        hunks: [],
        rawDiff: '',
        additions: 0,
        deletions: 0,
      });
    }
  }

  return Array.from(fileMap.values());
}
