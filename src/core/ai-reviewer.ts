import { ChangedFile, Issue } from '../storage/models';
import { log, logError } from '../utils/logger';

interface AiReviewConfig {
  apiKey: string;
  provider: 'openai' | 'anthropic';
}

interface LlmIssue {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

let issueCounter = 0;

/**
 * Sends structured diff context to an LLM and returns parsed issues.
 * Falls back gracefully on any failure.
 */
export async function aiReviewFile(
  file: ChangedFile,
  fileContent: string,
  config: AiReviewConfig
): Promise<Issue[]> {
  if (!config.apiKey) {
    return [];
  }

  try {
    const prompt = buildPrompt(file, fileContent);
    const response = await callLlm(prompt, config);
    return parseResponse(response, file.path);
  } catch (error) {
    logError(`AI review failed for ${file.path}`, error);
    return [];
  }
}

/**
 * Builds a structured prompt with function-level context, not raw diff.
 */
function buildPrompt(file: ChangedFile, fileContent: string): string {
  const changedLineNumbers = new Set<number>();
  const changeDetails: string[] = [];

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'added') {
        changedLineNumbers.add(line.lineNumber);
        changeDetails.push(`+ L${line.lineNumber}: ${line.content}`);
      } else if (line.type === 'removed') {
        changeDetails.push(`- (removed): ${line.content}`);
      }
    }
  }

  // Extract surrounding context for changed regions
  const fileLines = fileContent.split('\n');
  const contextRanges: string[] = [];

  for (const hunk of file.hunks) {
    const start = Math.max(0, hunk.newStart - 6);
    const end = Math.min(fileLines.length, hunk.newStart + hunk.newCount + 5);
    const contextLines = fileLines.slice(start, end).map((line, i) => {
      const lineNum = start + i + 1;
      const marker = changedLineNumbers.has(lineNum) ? '>>>' : '   ';
      return `${marker} ${lineNum}: ${line}`;
    });
    contextRanges.push(contextLines.join('\n'));
  }

  return `You are a code reviewer. Review the following changes in "${file.path}" for bugs, edge cases, security issues, and improvements.

FILE: ${file.path}
STATUS: ${file.status}
ADDITIONS: ${file.additions} lines
DELETIONS: ${file.deletions} lines

CHANGES (+ = added, - = removed):
${changeDetails.join('\n')}

CODE CONTEXT (>>> marks changed lines):
${contextRanges.join('\n---\n')}

Respond ONLY with a JSON array of issues. Each issue must have:
- "line": number (the line number in the new file)
- "severity": "error" | "warning" | "info"
- "message": string (concise description of the issue)
- "suggestion": string (how to fix it)

If there are no issues, respond with an empty array: []
Do NOT include any text outside the JSON array.`;
}

/**
 * Calls the configured LLM provider.
 */
async function callLlm(prompt: string, config: AiReviewConfig): Promise<string> {
  log(`Calling ${config.provider} API...`);

  if (config.provider === 'openai') {
    return callOpenAi(prompt, config.apiKey);
  } else {
    return callAnthropic(prompt, config.apiKey);
  }
}

async function callOpenAi(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise code reviewer. Respond only with valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? '[]';
}

async function callAnthropic(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { content: { text: string }[] };
  return data.content[0]?.text ?? '[]';
}

/**
 * Parses LLM response into Issue[].
 * Handles malformed JSON gracefully.
 */
function parseResponse(response: string, filePath: string): Issue[] {
  try {
    // Extract JSON from response (in case there's surrounding text)
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log('AI response contained no JSON array');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as LlmIssue[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(item => item.line && item.severity && item.message)
      .map(item => ({
        id: `ai-${++issueCounter}`,
        file: filePath,
        line: item.line,
        severity: item.severity,
        source: 'ai' as const,
        analyzer: 'ai-review',
        message: item.message,
        suggestion: item.suggestion,
      }));
  } catch (error) {
    logError('Failed to parse AI response', error);
    return [];
  }
}
