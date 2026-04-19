import * as vscode from 'vscode';
import {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  ReviewResult,
  ReviewHistory,
} from '../storage/models';

export class DashboardProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private messageCallback: ((msg: WebviewToExtensionMessage) => void) | undefined;

  constructor(private extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Register any pending message callback
    if (this.messageCallback) {
      webviewView.webview.onDidReceiveMessage(this.messageCallback);
    }
  }

  sendResult(result: ReviewResult): void {
    this.postMessage({ type: 'reviewResult', data: result });
  }

  sendHistory(history: ReviewHistory): void {
    this.postMessage({ type: 'reviewHistory', data: history });
  }

  sendLoading(message: string): void {
    this.postMessage({ type: 'loading', data: { message } });
  }

  sendError(message: string): void {
    this.postMessage({ type: 'error', data: { message } });
  }

  onMessage(callback: (msg: WebviewToExtensionMessage) => void): void {
    this.messageCallback = callback;
    this.view?.webview.onDidReceiveMessage(callback);
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShipIt Dashboard</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --widget-bg: var(--vscode-editorWidget-background);
      --badge-error: #f44747;
      --badge-warning: #cca700;
      --badge-info: #3794ff;
      --green: #2ea043;
      --radius: 8px;
      --shadow: 0 2px 8px rgba(0,0,0,0.15);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--fg);
      padding: 16px 12px;
      font-size: 13px;
      overflow-x: hidden;
    }

    /* ── Animations ── */
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes scaleIn {
      from { opacity: 0; transform: scale(0.8); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.04); }
    }
    @keyframes countUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes ringFill {
      from { stroke-dashoffset: 251.2; }
    }
    .animate-in { animation: fadeInUp 0.4s ease both; }
    .animate-scale { animation: scaleIn 0.35s ease both; }
    .stagger-1 { animation-delay: 0.05s; }
    .stagger-2 { animation-delay: 0.12s; }
    .stagger-3 { animation-delay: 0.2s; }
    .stagger-4 { animation-delay: 0.28s; }
    .stagger-5 { animation-delay: 0.35s; }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .header-title {
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      letter-spacing: 0.3px;
    }
    .header-title .logo { font-size: 16px; }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 5px 14px;
      cursor: pointer;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }
    .btn:hover {
      background: var(--vscode-button-hoverBackground);
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    .btn:active { transform: translateY(0); }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .btn-outline:hover {
      background: var(--widget-bg);
      border-color: var(--vscode-focusBorder);
    }

    /* ── Score Ring ── */
    .score-card {
      text-align: center;
      margin-bottom: 16px;
      padding: 20px 16px;
      border-radius: var(--radius);
      background: var(--widget-bg);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
    }
    .score-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      border-radius: var(--radius) var(--radius) 0 0;
    }
    .score-ring-container {
      position: relative;
      width: 120px;
      height: 120px;
      margin: 0 auto 12px;
    }
    .score-ring { transform: rotate(-90deg); }
    .score-ring-bg {
      fill: none;
      stroke: var(--border);
      stroke-width: 8;
    }
    .score-ring-fill {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
      stroke-dasharray: 251.2;
      stroke-dashoffset: 251.2;
      transition: stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .score-ring-text {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }
    .score-value {
      font-size: 32px;
      font-weight: 800;
      line-height: 1;
      animation: countUp 0.6s ease both 0.3s;
    }
    .score-max { font-size: 11px; opacity: 0.4; font-weight: 400; }
    .score-label {
      font-size: 10px;
      opacity: 0.5;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .score-delta {
      display: inline-block;
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      margin-top: 8px;
    }
    .delta-positive { color: var(--green); background: rgba(46,160,67,0.12); }
    .delta-negative { color: var(--badge-error); background: rgba(244,71,71,0.12); }

    /* ── Streak Banner ── */
    .streak {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 16px;
      margin-bottom: 16px;
      border-radius: var(--radius);
      font-size: 12px;
      font-weight: 600;
      background: linear-gradient(135deg, rgba(46,160,67,0.1), rgba(55,148,255,0.1));
      border: 1px solid rgba(46,160,67,0.25);
      box-shadow: var(--shadow);
    }
    .streak-icon { font-size: 18px; }
    .streak-count {
      font-size: 18px;
      font-weight: 800;
      color: var(--green);
    }

    /* ── Badge Cards ── */
    .badges {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 16px;
    }
    .badge-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 10px 6px;
      border-radius: var(--radius);
      background: var(--widget-bg);
      border: 1px solid var(--border);
      transition: all 0.2s ease;
    }
    .badge-card:hover {
      border-color: var(--vscode-focusBorder);
      transform: translateY(-1px);
      box-shadow: var(--shadow);
    }
    .badge-count {
      font-size: 20px;
      font-weight: 800;
      line-height: 1;
    }
    .badge-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.6;
    }
    .badge-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      display: inline-block;
    }

    /* ── Section ── */
    .section { margin-bottom: 16px; }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      opacity: 0.5;
    }
    .section-count {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 10px;
      background: var(--widget-bg);
      border: 1px solid var(--border);
      opacity: 0.7;
    }

    /* ── Filter Tabs ── */
    .filter-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 10px;
      background: var(--widget-bg);
      padding: 3px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .filter-tab {
      flex: 1;
      padding: 4px 8px;
      font-size: 10px;
      font-weight: 600;
      text-align: center;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
      background: transparent;
      color: var(--fg);
      opacity: 0.6;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .filter-tab.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      opacity: 1;
    }
    .filter-tab:hover:not(.active) { opacity: 0.9; background: rgba(255,255,255,0.05); }

    /* ── Issue Cards ── */
    .issue-card {
      padding: 10px 12px;
      border-radius: var(--radius);
      margin-bottom: 6px;
      cursor: pointer;
      background: var(--widget-bg);
      border: 1px solid var(--border);
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }
    .issue-card::before {
      content: '';
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      border-radius: var(--radius) 0 0 var(--radius);
    }
    .issue-card.severity-error::before { background: var(--badge-error); }
    .issue-card.severity-warning::before { background: var(--badge-warning); }
    .issue-card.severity-info::before { background: var(--badge-info); }
    .issue-card:hover {
      border-color: var(--vscode-focusBorder);
      transform: translateX(2px);
      box-shadow: var(--shadow);
    }
    .issue-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .issue-file {
      font-size: 10px;
      opacity: 0.5;
      font-family: var(--vscode-editor-font-family);
    }
    .issue-badge {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 3px;
      letter-spacing: 0.3px;
    }
    .issue-badge.error { background: rgba(244,71,71,0.15); color: var(--badge-error); }
    .issue-badge.warning { background: rgba(204,167,0,0.15); color: var(--badge-warning); }
    .issue-badge.info { background: rgba(55,148,255,0.15); color: var(--badge-info); }
    .issue-msg {
      font-size: 12px;
      line-height: 1.4;
      padding-left: 2px;
    }
    .issue-suggestion {
      font-size: 11px;
      opacity: 0.5;
      margin-top: 4px;
      padding-left: 2px;
      font-style: italic;
    }
    .no-issues {
      text-align: center;
      padding: 20px;
      opacity: 0.4;
      font-size: 12px;
    }
    .no-issues-icon { font-size: 28px; margin-bottom: 6px; }

    /* ── PR Section ── */
    .pr-section textarea {
      width: 100%;
      min-height: 100px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: var(--radius);
      padding: 10px;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      line-height: 1.5;
      resize: vertical;
      transition: border-color 0.2s ease;
    }
    .pr-section textarea:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .pr-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .copy-feedback {
      font-size: 11px;
      color: var(--green);
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.2s ease;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .copy-feedback.show { opacity: 1; }

    /* ── File Summary ── */
    .file-summary {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .file-stat {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      opacity: 0.6;
    }
    .file-stat-icon { font-size: 13px; }

    /* ── Loading ── */
    .loading {
      text-align: center;
      padding: 50px 0;
    }
    .loading-ring {
      width: 40px; height: 40px;
      margin: 0 auto 16px;
      position: relative;
    }
    .loading-ring::before, .loading-ring::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 3px solid transparent;
    }
    .loading-ring::before {
      border-top-color: var(--vscode-progressBar-background);
      animation: spin 0.8s linear infinite;
    }
    .loading-ring::after {
      border-bottom-color: var(--badge-info);
      animation: spin 1.2s linear infinite reverse;
      inset: 4px;
    }
    .loading-text {
      font-size: 12px;
      opacity: 0.6;
      animation: pulse 1.5s ease-in-out infinite;
    }
    .loading-dots::after {
      content: '';
      animation: dots 1.5s steps(4, end) infinite;
    }
    @keyframes dots {
      0% { content: ''; }
      25% { content: '.'; }
      50% { content: '..'; }
      75% { content: '...'; }
    }

    /* ── Empty State ── */
    .empty {
      text-align: center;
      padding: 40px 16px;
    }
    .empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
      opacity: 0.3;
    }
    .empty-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .empty-desc {
      font-size: 12px;
      opacity: 0.5;
      margin-bottom: 16px;
      line-height: 1.5;
    }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
  </style>
</head>
<body>
  <div id="app">
    <div class="empty animate-scale">
      <div class="empty-icon">🛡️</div>
      <div class="empty-title">Ready to Ship?</div>
      <div class="empty-desc">Review your changes before pushing.<br>ShipIt will analyze code quality, security, and best practices.</div>
      <button class="btn" data-action="reReview">Start Review</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const app = document.getElementById('app');
    let currentFilter = 'all';
    let currentResult = null;

    function postMsg(msg) { vscode.postMessage(msg); }

    // Delegated click handler
    app.addEventListener('click', function(e) {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'reReview') {
        postMsg({ type: 'reReview' });
      } else if (action === 'copyPrDescription') {
        postMsg({ type: 'copyPrDescription' });
        const fb = document.getElementById('copy-feedback');
        if (fb) { fb.classList.add('show'); setTimeout(() => fb.classList.remove('show'), 2000); }
      } else if (action === 'openFile') {
        postMsg({ type: 'openFile', data: { path: target.dataset.path, line: parseInt(target.dataset.line) } });
      } else if (action === 'filter') {
        currentFilter = target.dataset.filter;
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        target.classList.add('active');
        renderIssues(currentResult);
      }
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'reviewResult': currentResult = msg.data; renderResult(msg.data); break;
        case 'reviewHistory': renderHistory(msg.data); break;
        case 'loading': renderLoading(msg.data.message); break;
        case 'error': renderError(msg.data.message); break;
      }
    });

    function renderLoading(message) {
      app.innerHTML =
        '<div class="loading animate-scale">' +
          '<div class="loading-ring"></div>' +
          '<div class="loading-text">' + esc(message) + '<span class="loading-dots"></span></div>' +
        '</div>';
    }

    function renderError(message) {
      app.innerHTML =
        '<div class="empty animate-scale">' +
          '<div class="empty-icon">⚠️</div>' +
          '<div class="empty-title" style="color:var(--badge-error)">Review Failed</div>' +
          '<div class="empty-desc">' + esc(message) + '</div>' +
          '<button class="btn" data-action="reReview">Try Again</button>' +
        '</div>';
    }

    function renderResult(result) {
      currentFilter = 'all';
      const scoreColor = result.score >= 80 ? 'var(--green)' : result.score >= 50 ? 'var(--badge-warning)' : 'var(--badge-error)';
      const circumference = 251.2;
      const offset = circumference - (circumference * result.score / 100);

      let html = '';

      // Header
      html += '<div class="header animate-in">' +
        '<div class="header-title"><span class="logo">🛡️</span> ShipIt</div>' +
        '<button class="btn" data-action="reReview">Re-review</button>' +
      '</div>';

      // Score Ring
      html += '<div class="score-card animate-in stagger-1">' +
        '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:' + scoreColor + ';border-radius:8px 8px 0 0"></div>' +
        '<div class="score-ring-container">' +
          '<svg class="score-ring" width="120" height="120" viewBox="0 0 120 120">' +
            '<circle class="score-ring-bg" cx="60" cy="60" r="40"></circle>' +
            '<circle class="score-ring-fill" cx="60" cy="60" r="40" style="stroke:' + scoreColor + ';stroke-dashoffset:' + offset + '"></circle>' +
          '</svg>' +
          '<div class="score-ring-text">' +
            '<div class="score-value" style="color:' + scoreColor + '">' + result.score + '</div>' +
            '<div class="score-label">Score</div>' +
          '</div>' +
        '</div>' +
      '</div>';

      // Badge cards
      html += '<div class="badges animate-in stagger-2">' +
        '<div class="badge-card">' +
          '<div class="badge-count" style="color:var(--badge-error)">' + result.errors + '</div>' +
          '<div class="badge-label"><span class="badge-dot" style="background:var(--badge-error)"></span> Errors</div>' +
        '</div>' +
        '<div class="badge-card">' +
          '<div class="badge-count" style="color:var(--badge-warning)">' + result.warnings + '</div>' +
          '<div class="badge-label"><span class="badge-dot" style="background:var(--badge-warning)"></span> Warnings</div>' +
        '</div>' +
        '<div class="badge-card">' +
          '<div class="badge-count" style="color:var(--badge-info)">' + result.infos + '</div>' +
          '<div class="badge-label"><span class="badge-dot" style="background:var(--badge-info)"></span> Info</div>' +
        '</div>' +
      '</div>';

      // File summary
      const totalAdded = result.files.reduce((s, f) => s + f.additions, 0);
      const totalRemoved = result.files.reduce((s, f) => s + f.deletions, 0);
      html += '<div class="file-summary animate-in stagger-2">' +
        '<div class="file-stat"><span class="file-stat-icon">📁</span> ' + result.files.length + ' files</div>' +
        '<div class="file-stat" style="color:var(--green)"><span class="file-stat-icon">+</span>' + totalAdded + ' added</div>' +
        '<div class="file-stat" style="color:var(--badge-error)"><span class="file-stat-icon">−</span>' + totalRemoved + ' removed</div>' +
      '</div>';

      // Issues section
      html += '<div class="section animate-in stagger-3" id="issues-section">' +
        '<div class="section-header">' +
          '<div class="section-title">Issues</div>' +
          '<div class="section-count">' + result.totalIssues + ' total</div>' +
        '</div>';

      if (result.totalIssues > 0) {
        html += '<div class="filter-tabs">' +
          '<button class="filter-tab active" data-action="filter" data-filter="all">All</button>' +
          '<button class="filter-tab" data-action="filter" data-filter="error">Errors</button>' +
          '<button class="filter-tab" data-action="filter" data-filter="warning">Warnings</button>' +
          '<button class="filter-tab" data-action="filter" data-filter="info">Info</button>' +
        '</div>';
      }

      html += '<div id="issue-list"></div>';
      html += '</div>';

      // PR Description
      html += '<div class="section pr-section animate-in stagger-4">' +
        '<div class="section-header"><div class="section-title">PR Description</div></div>' +
        '<textarea readonly>' + esc(result.prDescription) + '</textarea>' +
        '<div class="pr-actions">' +
          '<button class="btn btn-outline" data-action="copyPrDescription">📋 Copy to Clipboard</button>' +
          '<span class="copy-feedback" id="copy-feedback">✓ Copied!</span>' +
        '</div>' +
      '</div>';

      app.innerHTML = html;
      renderIssues(result);
    }

    function renderIssues(result) {
      if (!result) return;
      const list = document.getElementById('issue-list');
      if (!list) return;

      let allIssues = [];
      for (const file of result.files) {
        for (const issue of file.issues) {
          allIssues.push(issue);
        }
      }

      if (currentFilter !== 'all') {
        allIssues = allIssues.filter(i => i.severity === currentFilter);
      }

      if (allIssues.length === 0) {
        if (result.totalIssues === 0) {
          list.innerHTML = '<div class="no-issues animate-scale"><div class="no-issues-icon">🎉</div>No issues found. Ship it!</div>';
        } else {
          list.innerHTML = '<div class="no-issues">No ' + currentFilter + ' issues</div>';
        }
        return;
      }

      let html = '';
      allIssues.forEach(function(issue, idx) {
        const delay = Math.min(idx * 0.04, 0.4);
        html += '<div class="issue-card severity-' + issue.severity + '" data-action="openFile" data-path="' + esc(issue.file) + '" data-line="' + issue.line + '" style="animation: fadeInUp 0.3s ease both ' + delay + 's">' +
          '<div class="issue-top">' +
            '<div class="issue-file">' + esc(issue.file) + ':' + issue.line + '</div>' +
            '<span class="issue-badge ' + issue.severity + '">' + issue.severity + '</span>' +
          '</div>' +
          '<div class="issue-msg">' + esc(issue.message) + '</div>' +
          (issue.suggestion ? '<div class="issue-suggestion">💡 ' + esc(issue.suggestion) + '</div>' : '') +
        '</div>';
      });
      list.innerHTML = html;
    }

    function renderHistory(history) {
      if (!history || history.reviews.length === 0) return;
      const streak = history.streak;
      if (streak > 0) {
        const existing = document.querySelector('.streak');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'streak animate-in';
        el.innerHTML = '<span class="streak-icon">⚡</span> <span class="streak-count">' + streak + '</span> clean push' + (streak > 1 ? 'es' : '') + ' in a row!';
        const scoreCard = document.querySelector('.score-card');
        if (scoreCard) scoreCard.after(el);
      }
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

    postMsg({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
