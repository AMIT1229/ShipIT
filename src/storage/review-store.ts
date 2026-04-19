import * as vscode from 'vscode';
import { ReviewHistory, ReviewResult, ReviewSnapshot } from './models';

const HISTORY_KEY = 'shipit.reviewHistory';
const MAX_HISTORY = 50;

export class ReviewStore {
  constructor(private state: vscode.Memento) {}

  saveReview(result: ReviewResult): void {
    const history = this.getHistory();

    const snapshot: ReviewSnapshot = {
      score: result.score,
      totalIssues: result.totalIssues,
      errors: result.errors,
      warnings: result.warnings,
      infos: result.infos,
      timestamp: result.timestamp,
      fileCount: result.files.length,
    };

    history.reviews.unshift(snapshot);
    if (history.reviews.length > MAX_HISTORY) {
      history.reviews = history.reviews.slice(0, MAX_HISTORY);
    }

    // Update streak
    if (result.score >= 80) {
      history.streak++;
    } else {
      history.streak = 0;
    }

    // Track analyzer hit counts
    for (const file of result.files) {
      for (const issue of file.issues) {
        history.analyzerHitCounts[issue.analyzer] =
          (history.analyzerHitCounts[issue.analyzer] ?? 0) + 1;
      }
    }

    // Find most common analyzer
    let maxHits = 0;
    for (const [analyzer, count] of Object.entries(history.analyzerHitCounts)) {
      if (count > maxHits) {
        maxHits = count;
        history.mostCommonAnalyzer = analyzer;
      }
    }

    this.state.update(HISTORY_KEY, history);
  }

  getHistory(): ReviewHistory {
    return this.state.get<ReviewHistory>(HISTORY_KEY, {
      reviews: [],
      streak: 0,
      mostCommonAnalyzer: '',
      analyzerHitCounts: {},
    });
  }

  getLastScore(): number | undefined {
    const history = this.getHistory();
    return history.reviews[0]?.score;
  }
}
