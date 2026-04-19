import { Issue } from '../storage/models';

/**
 * Calculates a readiness score from 0-100.
 * Starts at 100 and deducts based on issue severity.
 */
export function calculateScore(issues: Issue[]): number {
  let score = 100;

  for (const issue of issues) {
    switch (issue.severity) {
      case 'error':
        score -= 15;
        break;
      case 'warning':
        score -= 5;
        break;
      case 'info':
        score -= 1;
        break;
    }
  }

  return Math.max(0, Math.min(100, score));
}
