import { ChangedFile, ChangedLine, DiffHunk, FileStatus, LineType } from '../storage/models';

/**
 * Parses unified diff output from git into structured ChangedFile objects.
 * Handles edge cases: binary files, renames, no-newline-at-EOF.
 */
export function parseDiff(rawDiff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const fileSections = splitIntoFileSections(rawDiff);

  for (const section of fileSections) {
    const file = parseFileSection(section);
    if (file) {
      files.push(file);
    }
  }

  return files;
}

/**
 * Splits a multi-file diff into individual file sections.
 * Each section starts with "diff --git"
 */
function splitIntoFileSections(rawDiff: string): string[] {
  const sections: string[] = [];
  const lines = rawDiff.split('\n');
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      sections.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) {
    sections.push(current.join('\n'));
  }

  return sections;
}

/**
 * Parses a single file's diff section into a ChangedFile.
 */
function parseFileSection(section: string): ChangedFile | null {
  const lines = section.split('\n');

  // Skip binary files
  if (lines.some(l => l.startsWith('Binary files'))) {
    return null;
  }

  const path = extractFilePath(lines);
  if (!path) {
    return null;
  }

  const status = detectFileStatus(lines);
  const hunks = parseHunks(lines);

  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'added') { additions++; }
      if (line.type === 'removed') { deletions++; }
    }
  }

  return { path, status, hunks, rawDiff: section, additions, deletions };
}

/**
 * Extracts the file path from diff headers.
 * Handles both normal and rename cases.
 */
function extractFilePath(lines: string[]): string | null {
  // Try +++ line first (most reliable for the "new" file path)
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      return line.slice(6);
    }
    if (line.startsWith('+++ /dev/null')) {
      // File was deleted — use the --- line
      for (const l of lines) {
        if (l.startsWith('--- a/')) {
          return l.slice(6);
        }
      }
    }
  }

  // Fallback: parse "diff --git a/path b/path"
  const diffLine = lines.find(l => l.startsWith('diff --git '));
  if (diffLine) {
    const match = diffLine.match(/diff --git a\/.+ b\/(.+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Detects file status from diff headers.
 */
function detectFileStatus(lines: string[]): FileStatus {
  for (const line of lines) {
    if (line.startsWith('new file mode')) { return 'added'; }
    if (line.startsWith('deleted file mode')) { return 'deleted'; }
    if (line.startsWith('rename from')) { return 'renamed'; }
  }
  return 'modified';
}

/**
 * Parses all hunks from a file diff section.
 * Hunk headers look like: @@ -oldStart,oldCount +newStart,newCount @@
 */
function parseHunks(lines: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let currentNewLine = 0;

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);

    if (hunkHeader) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      const oldStart = parseInt(hunkHeader[1], 10);
      const oldCount = parseInt(hunkHeader[2] || '1', 10);
      const newStart = parseInt(hunkHeader[3], 10);
      const newCount = parseInt(hunkHeader[4] || '1', 10);

      currentHunk = { oldStart, oldCount, newStart, newCount, lines: [] };
      currentNewLine = newStart;
      continue;
    }

    if (!currentHunk) { continue; }

    // Skip "no newline at end of file" markers
    if (line.startsWith('\\ No newline at end of file')) { continue; }

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        lineNumber: currentNewLine,
        content: line.slice(1),
        type: 'added' as LineType,
      });
      currentNewLine++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        lineNumber: currentNewLine,
        content: line.slice(1),
        type: 'removed' as LineType,
      });
      // Removed lines don't increment new line number
    } else if (line.startsWith(' ') || line === '') {
      currentHunk.lines.push({
        lineNumber: currentNewLine,
        content: line.startsWith(' ') ? line.slice(1) : line,
        type: 'context' as LineType,
      });
      currentNewLine++;
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}
