import { ReviewedFile } from '../storage/models';

/**
 * Generates a markdown PR description from review results.
 */
export function generatePrDescription(files: ReviewedFile[]): string {
  const changed = files.filter(f => f.status === 'modified');
  const added = files.filter(f => f.status === 'added');
  const deleted = files.filter(f => f.status === 'deleted');
  const renamed = files.filter(f => f.status === 'renamed');

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  const sections: string[] = [];

  sections.push('## What Changed\n');

  if (added.length > 0) {
    sections.push(`### New Files (${added.length})`);
    for (const f of added) {
      sections.push(`- \`${f.path}\` (+${f.additions} lines)`);
    }
    sections.push('');
  }

  if (changed.length > 0) {
    sections.push(`### Modified Files (${changed.length})`);
    for (const f of changed) {
      sections.push(`- \`${f.path}\` (+${f.additions}, -${f.deletions})`);
    }
    sections.push('');
  }

  if (deleted.length > 0) {
    sections.push(`### Deleted Files (${deleted.length})`);
    for (const f of deleted) {
      sections.push(`- \`${f.path}\``);
    }
    sections.push('');
  }

  if (renamed.length > 0) {
    sections.push(`### Renamed Files (${renamed.length})`);
    for (const f of renamed) {
      sections.push(`- \`${f.path}\``);
    }
    sections.push('');
  }

  sections.push('## Summary\n');
  sections.push(`- **Files changed:** ${files.length}`);
  sections.push(`- **Lines added:** ${totalAdditions}`);
  sections.push(`- **Lines removed:** ${totalDeletions}`);
  sections.push('');

  const issueFiles = files.filter(f => f.issues.length > 0);
  if (issueFiles.length > 0) {
    sections.push('## Notes\n');
    sections.push('The following items were flagged during pre-push review:\n');
    for (const f of issueFiles) {
      for (const issue of f.issues) {
        const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
        sections.push(`- ${icon} \`${f.path}:${issue.line}\` — ${issue.message}`);
      }
    }
  }

  return sections.join('\n');
}
