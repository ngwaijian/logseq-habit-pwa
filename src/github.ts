import type { GitHubConfig, HabitRecord } from './types';

const CONFIG_KEY = 'logseq_habit_pwa_gh_config';
const CACHE_PREFIX = 'logseq_habit_cache_';

export function getGitHubConfig(): GitHubConfig {
  const saved = localStorage.getItem(CONFIG_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // ignore
    }
  }
  return {
    token: '',
    owner: 'ngwaijian',
    repo: 'logseq_git',
    branch: 'main',
    folder: 'journals',
  };
}

export function saveGitHubConfig(config: GitHubConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// Parse markdown string into habit records for that day
export function parseJournalMarkdown(markdown: string, dateInt: number, filePath: string, fileSha: string): HabitRecord[] {
  const lines = markdown.split('\n');
  const records: HabitRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Skip the section heading e.g. "### habit-tracker"
    if (trimmed.startsWith('#') && trimmed.toLowerCase().includes('habit-tracker')) {
      continue;
    }

    // Must have #habit-tracker or [[habit-tracker]]
    if (!/(?:#habit-tracker|\[\[habit-tracker\]\])/i.test(rawLine)) {
      continue;
    }

    let lineContent = rawLine;
    let completed = false;
    let marker: string | undefined = undefined;

    // Check for DONE
    if (/\bDONE\b/i.test(lineContent)) {
      completed = true;
      marker = 'DONE';
      lineContent = lineContent.replace(/\bDONE\b/i, '');
    } else if (/\b(?:TODO|DOING|NOW|LATER)\b/i.test(lineContent)) {
      completed = false;
      marker = 'TODO';
      lineContent = lineContent.replace(/\b(?:TODO|DOING|NOW|LATER)\b/i, '');
    }

    // Extract clean habit name
    let habitName = lineContent
      .replace(/^[\s\t]*-\s*/, '') // remove leading bullet
      .replace(/(?:#habit-tracker|\[\[habit-tracker\]\])/ig, '')
      .trim();

    if (!habitName) continue;

    // Collect child lines / indented lines beneath this habit
    const detailLines: string[] = [];
    const indentMatch = rawLine.match(/^([\s\t]*)/);
    const baseIndent = indentMatch ? indentMatch[1].length : 0;

    let j = i + 1;
    while (j < lines.length) {
      const nextLine = lines[j];
      const nextTrimmed = nextLine.trim();

      // Stop if reached a new top-level or sibling bullet
      const nextIndentMatch = nextLine.match(/^([\s\t]*)/);
      const nextIndent = nextIndentMatch ? nextIndentMatch[1].length : 0;

      if (nextTrimmed.startsWith('- ') && nextIndent <= baseIndent) {
        break;
      }
      if (nextTrimmed.startsWith('# ') || nextTrimmed.startsWith('## ') || nextTrimmed.startsWith('### ')) {
        break;
      }

      detailLines.push(nextLine);
      j++;
    }

    let rawDetails = detailLines.join('\n');
    // Strip logbooks
    rawDetails = rawDetails.replace(/:LOGBOOK:[\s\S]*?:END:/ig, '');
    // Strip property lines (duration::, id::, etc.)
    const cleanedDetails = rawDetails
      .split('\n')
      .map(l => l.replace(/^[\s\t]*-\s*/, ''))
      .filter(l => !/^[a-zA-Z0-9_-]+::/.test(l.trim()) && l.trim().length > 0)
      .join('\n')
      .trim();

    records.push({
      id: `${dateInt}_${habitName}`,
      name: habitName,
      date: dateInt,
      completed,
      marker,
      content: rawLine,
      details: cleanedDetails || undefined,
      fileSha,
      filePath,
    });
  }

  return records;
}

// Convert base64 from GitHub API to utf-8 string safely
function base64ToUtf8(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// Convert utf-8 string to base64 for GitHub API PUT
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Fetch tree list of all files in journals/ folder
async function fetchJournalFileList(config: GitHubConfig): Promise<{ path: string; sha: string }[]> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/trees/${config.branch}?recursive=1`;

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
  };
  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token.trim()}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const folderPrefix = config.folder ? `${config.folder.replace(/\/$/, '')}/` : '';

  const files = (data.tree || [])
    .filter((item: any) => item.type === 'blob' && item.path.startsWith(folderPrefix) && item.path.endsWith('.md'))
    .map((item: any) => ({ path: item.path, sha: item.sha }));

  return files;
}

// Fetch file content with caching by SHA
async function fetchFileContent(config: GitHubConfig, path: string, sha: string): Promise<string> {
  const cacheKey = `${CACHE_PREFIX}file_${sha}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    return cached;
  }

  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
  };
  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token.trim()}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path} (${res.status})`);
  }

  const json = await res.json();
  const markdown = base64ToUtf8(json.content);

  try {
    localStorage.setItem(cacheKey, markdown);
  } catch {
    // If storage quota exceeded, ignore
  }

  return markdown;
}

// Fetch habits for a specific month
export async function getMonthHabitsFromGitHub(year: number, month: number, onProgress?: (msg: string) => void): Promise<HabitRecord[]> {
  const config = getGitHubConfig();
  if (!config.token) {
    throw new Error('Please configure your GitHub Personal Access Token in Settings.');
  }

  onProgress?.('Fetching journal file list...');
  const allFiles = await fetchJournalFileList(config);

  // Match journals e.g. journals/2026_10_*.md or journals/2026-10-*.md
  const monthStr = month.toString().padStart(2, '0');
  const monthPrefixUnderscore = `${year}_${monthStr}_`;
  const monthPrefixDash = `${year}-${monthStr}-`;

  const monthFiles = allFiles.filter(f => {
    const filename = f.path.split('/').pop() || '';
    return filename.startsWith(monthPrefixUnderscore) || filename.startsWith(monthPrefixDash);
  });

  if (monthFiles.length === 0) {
    return [];
  }

  const records: HabitRecord[] = [];
  let loaded = 0;

  await Promise.all(
    monthFiles.map(async file => {
      try {
        const filename = file.path.split('/').pop() || '';
        // Extract YYYYMMDD from filename
        const match = filename.match(/^(\d{4})[_-](\d{2})[_-](\d{2})\.md$/);
        if (!match) return;

        const dateInt = parseInt(`${match[1]}${match[2]}${match[3]}`);
        const markdown = await fetchFileContent(config, file.path, file.sha);
        const dayHabits = parseJournalMarkdown(markdown, dateInt, file.path, file.sha);
        records.push(...dayHabits);

        loaded++;
        onProgress?.(`Reading journals (${loaded}/${monthFiles.length})...`);
      } catch (err) {
        console.error(`Error processing ${file.path}:`, err);
      }
    })
  );

  return records;
}

// Toggle habit checkmark and update GitHub
export async function toggleHabitOnGitHub(record: HabitRecord, newCompletedState: boolean): Promise<HabitRecord> {
  const config = getGitHubConfig();
  if (!config.token || !record.filePath) {
    throw new Error('Missing GitHub token or file path.');
  }

  // 1. Fetch the latest file from GitHub to get fresh content & fresh sha
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${record.filePath}?ref=${config.branch}`;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `Bearer ${config.token.trim()}`,
  };

  const getRes = await fetch(url, { headers });
  if (!getRes.ok) {
    throw new Error(`Failed to load file for update (${getRes.status})`);
  }
  const fileJson = await getRes.json();
  const currentContent = base64ToUtf8(fileJson.content);
  const currentSha = fileJson.sha;

  // 2. Modify the line in markdown
  const lines = currentContent.split('\n');
  let lineModified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check if line matches this habit
    if (/(?:#habit-tracker|\[\[habit-tracker\]\])/i.test(line) && line.toLowerCase().includes(record.name.toLowerCase())) {
      if (newCompletedState) {
        // Mark as DONE
        if (/\bTODO\b/i.test(line)) {
          lines[i] = line.replace(/\bTODO\b/i, 'DONE');
        } else if (/\bDOING\b/i.test(line)) {
          lines[i] = line.replace(/\bDOING\b/i, 'DONE');
        } else if (!/\bDONE\b/i.test(line)) {
          // Add DONE after bullet
          lines[i] = line.replace(/^([\s\t]*-\s*)/, '$1DONE ');
        }
      } else {
        // Mark as undone (replace DONE with TODO or remove DONE)
        if (/\bDONE\b/i.test(line)) {
          lines[i] = line.replace(/\bDONE\s*/i, '');
        }
      }
      lineModified = true;
      break;
    }
  }

  if (!lineModified) {
    throw new Error(`Could not find habit "${record.name}" in ${record.filePath}`);
  }

  const updatedContent = lines.join('\n');

  // 3. Commit back to GitHub
  const putRes = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `chore: mark ${record.name} as ${newCompletedState ? 'DONE' : 'UNDONE'} for ${record.date}`,
      content: utf8ToBase64(updatedContent),
      sha: currentSha,
      branch: config.branch,
    }),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`Failed to save to GitHub (${putRes.status}): ${errText}`);
  }

  const putJson = await putRes.json();
  const newSha = putJson.content?.sha || currentSha;

  // Invalidate local cache
  localStorage.setItem(`${CACHE_PREFIX}file_${newSha}`, updatedContent);

  return {
    ...record,
    completed: newCompletedState,
    marker: newCompletedState ? 'DONE' : undefined,
    fileSha: newSha,
  };
}
