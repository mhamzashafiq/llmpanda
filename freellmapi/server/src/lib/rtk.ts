// RTK token-saver — compress bulky tool output (git diff / grep / ls / build logs…)
// before it reaches the model. Faithful TypeScript port of 9router's `open-sse/rtk/*`
// (MIT, https://github.com/decolua/9router), itself ported from the Rust RTK
// (https://github.com/rtk-ai/rtk). Pure + DB-free: detect the shape of a tool
// result and apply a lossless, format-specific compactor; never empties or grows.

// ── constants (mirror RTK defaults) ─────────────────────────────────────────
const RAW_CAP = 10 * 1024 * 1024;     // 10 MiB — skip absurdly large blobs
const MIN_COMPRESS_SIZE = 500;        // skip tiny blobs
const DETECT_WINDOW = 1024;           // autodetect peeks the first N chars
const GIT_DIFF_HUNK_MAX_LINES = 100;
const DEDUP_LINE_MAX = 2000;
const GREP_PER_FILE_MAX = 10;
const FIND_PER_DIR_MAX = 10;
const FIND_TOTAL_DIR_MAX = 20;
const STATUS_MAX_FILES = 10;
const STATUS_MAX_UNTRACKED = 10;
const LS_EXT_SUMMARY_TOP = 5;
const LS_NOISE_DIRS = ['node_modules', '.git', 'target', '__pycache__', '.next', 'dist', 'build', '.venv', 'venv', '.cache', '.idea', '.vscode', '.DS_Store'];
const TREE_MAX_LINES = 200;
const SEARCH_LIST_PER_DIR_MAX = 10;
const SEARCH_LIST_TOTAL_DIR_MAX = 20;
const SMART_TRUNCATE_HEAD = 120;
const SMART_TRUNCATE_TAIL = 60;
const SMART_TRUNCATE_MIN_LINES = 250;
const READ_NUMBERED_MIN_HIT_RATIO = 0.7;

type Filter = ((text: string) => string) & { filterName: string };
function filter(name: string, fn: (text: string) => string): Filter {
  const f = fn as Filter;
  f.filterName = name;
  return f;
}

const READ_NUMBERED_LINE_RE = /^\s*\d+\|/;
const SEARCH_LIST_HEADER_RE = /^Result of search in '[^']*' \(total (\d+) files?\):/;

// ── filters ─────────────────────────────────────────────────────────────────

const gitDiff = filter('git-diff', (diff: string): string => {
  const maxLines = 500;
  const result: string[] = [];
  let currentFile = '';
  let added = 0, removed = 0;
  let inHunk = false, hunkShown = 0, hunkSkipped = 0, wasTruncated = false;
  const lines = diff.split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (hunkSkipped > 0) { result.push(`  ... (${hunkSkipped} lines truncated)`); wasTruncated = true; hunkSkipped = 0; }
      if (currentFile && (added > 0 || removed > 0)) result.push(`  +${added} -${removed}`);
      const parts = line.split(' b/');
      currentFile = parts.length > 1 ? parts.slice(1).join(' b/') : 'unknown';
      result.push(`\n${currentFile}`);
      added = 0; removed = 0; inHunk = false; hunkShown = 0;
    } else if (line.startsWith('@@')) {
      if (hunkSkipped > 0) { result.push(`  ... (${hunkSkipped} lines truncated)`); wasTruncated = true; hunkSkipped = 0; }
      inHunk = true; hunkShown = 0; result.push(`  ${line}`);
    } else if (inHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        added += 1;
        if (hunkShown < GIT_DIFF_HUNK_MAX_LINES) { result.push(`  ${line}`); hunkShown += 1; } else hunkSkipped += 1;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removed += 1;
        if (hunkShown < GIT_DIFF_HUNK_MAX_LINES) { result.push(`  ${line}`); hunkShown += 1; } else hunkSkipped += 1;
      } else if (hunkShown < GIT_DIFF_HUNK_MAX_LINES && !line.startsWith('\\')) {
        if (hunkShown > 0) { result.push(`  ${line}`); hunkShown += 1; }
      }
    }
    if (result.length >= maxLines) { result.push('\n... (more changes truncated)'); wasTruncated = true; break; }
  }
  if (hunkSkipped > 0) { result.push(`  ... (${hunkSkipped} lines truncated)`); wasTruncated = true; }
  if (currentFile && (added > 0 || removed > 0)) result.push(`  +${added} -${removed}`);
  if (wasTruncated) result.push('[full diff: rtk git diff --no-compact]');
  return result.join('\n');
});

const gitStatus = filter('git-status', (input: string): string => {
  const lines = input.split('\n');
  if (lines.length === 0 || (lines.length === 1 && !lines[0].trim())) return 'Clean working tree';
  let branch = '';
  const stagedFiles: string[] = [], modifiedFiles: string[] = [], untrackedFiles: string[] = [];
  let staged = 0, modified = 0, untracked = 0, conflicts = 0;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const longBranch = raw.match(/^On branch (\S+)/);
    if (longBranch) { branch = longBranch[1]; continue; }
    if (raw.startsWith('##')) { branch = raw.replace(/^##\s*/, ''); continue; }
    if (raw.length >= 3 && /^[ MADRCU?!][ MADRCU?!] /.test(raw)) {
      const x = raw[0], y = raw[1], file = raw.slice(3);
      if (raw.slice(0, 2) === '??') { untracked++; untrackedFiles.push(file); continue; }
      if ('MADRC'.includes(x)) { staged++; stagedFiles.push(file); } else if (x === 'U') conflicts++;
      if (y === 'M' || y === 'D') { modified++; modifiedFiles.push(file); }
      continue;
    }
    const longMatch = raw.match(/^\s*(modified|new file|deleted|renamed|both modified):\s+(.+)$/);
    if (longMatch) {
      const kind = longMatch[1], p = longMatch[2].trim();
      if (kind === 'both modified') conflicts++;
      else if (kind === 'modified' || kind === 'deleted') { modified++; modifiedFiles.push(p); }
      else if (kind === 'new file' || kind === 'renamed') { staged++; stagedFiles.push(p); }
    }
  }
  let out = '';
  if (branch) out += `* ${branch}\n`;
  if (staged > 0) {
    out += `+ Staged: ${staged} files\n`;
    for (const f of stagedFiles.slice(0, STATUS_MAX_FILES)) out += `   ${f}\n`;
    if (stagedFiles.length > STATUS_MAX_FILES) out += `   ... +${stagedFiles.length - STATUS_MAX_FILES} more\n`;
  }
  if (modified > 0) {
    out += `~ Modified: ${modified} files\n`;
    for (const f of modifiedFiles.slice(0, STATUS_MAX_FILES)) out += `   ${f}\n`;
    if (modifiedFiles.length > STATUS_MAX_FILES) out += `   ... +${modifiedFiles.length - STATUS_MAX_FILES} more\n`;
  }
  if (untracked > 0) {
    out += `? Untracked: ${untracked} files\n`;
    for (const f of untrackedFiles.slice(0, STATUS_MAX_UNTRACKED)) out += `   ${f}\n`;
    if (untrackedFiles.length > STATUS_MAX_UNTRACKED) out += `   ... +${untrackedFiles.length - STATUS_MAX_UNTRACKED} more\n`;
  }
  if (conflicts > 0) out += `conflicts: ${conflicts} files\n`;
  if (staged === 0 && modified === 0 && untracked === 0 && conflicts === 0) out += 'clean — nothing to commit\n';
  return out.replace(/\n+$/, '');
});

const RE_CARGO_ERR_CONT = /^\s*(-->|\||\d+\s*\||=)/;
const buildOutput = filter('build-output', (input: string): string => {
  const lines = input.split('\n');
  if (lines.length === 0) return input;
  const errors: string[] = [], warnings: string[] = [], deprecations: string[] = [];
  let summary: string | null = null;
  let compilingCount = 0, downloadingCount = 0, inCargoError = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inCargoError) {
      if (!trimmed) { inCargoError = false; continue; }
      if (RE_CARGO_ERR_CONT.test(line)) { errors.push(line); continue; }
      inCargoError = false;
    }
    if (!trimmed) continue;
    if (/^npm (ERR!|error)/i.test(trimmed) || /^yarn error/i.test(trimmed)) { errors.push(line); continue; }
    if (/^npm warn deprecated/i.test(trimmed)) { deprecations.push(line); continue; }
    if (/^npm warn/i.test(trimmed) || /^yarn warn/i.test(trimmed)) { warnings.push(line); continue; }
    if (/^error(\[|:)/i.test(trimmed) || trimmed.startsWith('error -->')) { errors.push(line); inCargoError = true; continue; }
    if (/^warning(\[|:)/i.test(trimmed) || trimmed.startsWith('warning -->')) { warnings.push(line); inCargoError = true; continue; }
    if (/^ERROR:/i.test(trimmed)) { errors.push(line); continue; }
    if (/^\[ERROR\]/i.test(trimmed) || /^BUILD FAILED/i.test(trimmed)) { errors.push(line); continue; }
    if (/^\[WARNING\]/i.test(trimmed)) { warnings.push(line); continue; }
    if (/^\s*Compiling\s+\S+/i.test(trimmed)) { compilingCount++; continue; }
    if (/^\s*Downloading\s+\S+/i.test(trimmed) || /^Fetching\s+/i.test(trimmed)) { downloadingCount++; continue; }
    if (
      /^(added|removed|changed|audited|installed)\s+\d+\s+package/i.test(trimmed) ||
      /^\s*Finished\s+/i.test(trimmed) || /^BUILD SUCCESS/i.test(trimmed) ||
      /^\d+\s+(vulnerabilities|packages?|warnings?|errors?)/i.test(trimmed) ||
      /^Successfully (installed|built)/i.test(trimmed) || /^To address .* issues/i.test(trimmed) ||
      /^Run `npm (audit|fund)`/i.test(trimmed) || /packages are looking for funding/i.test(trimmed)
    ) { summary = summary ? `${summary}\n${line}` : line; continue; }
  }
  let out = '';
  const keepDep = deprecations.slice(0, 3);
  for (const d of keepDep) out += `${d}\n`;
  if (deprecations.length > 3) out += `... +${deprecations.length - 3} more deprecated packages\n`;
  if (compilingCount > 0) out += `Compiled ${compilingCount} packages\n`;
  if (downloadingCount > 0) out += `Downloaded ${downloadingCount} packages\n`;
  for (const e of errors) out += `${e}\n`;
  for (const w of warnings.slice(0, 5)) out += `${w}\n`;
  if (warnings.length > 5) out += `... +${warnings.length - 5} more warnings\n`;
  if (summary) out += `${summary}\n`;
  return out.replace(/\n+$/, '') || input;
});

const grep = filter('grep', (input: string): string => {
  const byFile = new Map<string, [string, string][]>();
  let total = 0;
  for (const line of input.split('\n')) {
    const first = line.indexOf(':');
    if (first === -1) continue;
    const second = line.indexOf(':', first + 1);
    if (second === -1) continue;
    const file = line.slice(0, first);
    const lineNumStr = line.slice(first + 1, second);
    const content = line.slice(second + 1);
    if (!/^\d+$/.test(lineNumStr)) continue;
    total++;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push([lineNumStr, content]);
  }
  if (total === 0) return input;
  const files = Array.from(byFile.keys()).sort();
  let out = `${total} matches in ${files.length}F:\n\n`;
  for (const file of files) {
    const matches = byFile.get(file)!;
    out += `[file] ${file} (${matches.length}):\n`;
    for (const [lineNum, content] of matches.slice(0, GREP_PER_FILE_MAX)) out += `  ${lineNum.padStart(4)}: ${content.trim()}\n`;
    if (matches.length > GREP_PER_FILE_MAX) out += `  +${matches.length - GREP_PER_FILE_MAX}\n`;
    out += '\n';
  }
  return out;
});

const find = filter('find', (input: string): string => {
  const lines = input.split('\n').filter(l => l.trim());
  if (lines.length === 0) return input;
  const byDir = new Map<string, string[]>();
  for (const path of lines) {
    const lastSlash = path.lastIndexOf('/');
    let dir: string, basename: string;
    if (lastSlash === -1) { dir = '.'; basename = path; }
    else { dir = path.slice(0, lastSlash) || '/'; basename = path.slice(lastSlash + 1); }
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(basename);
  }
  const dirs = Array.from(byDir.keys()).sort();
  let out = `${lines.length} files in ${dirs.length} dirs:\n\n`;
  for (const dir of dirs.slice(0, FIND_TOTAL_DIR_MAX)) {
    const fs = byDir.get(dir)!;
    out += `${dir}/ (${fs.length}):\n`;
    for (const f of fs.slice(0, FIND_PER_DIR_MAX)) out += `  ${f}\n`;
    if (fs.length > FIND_PER_DIR_MAX) out += `  +${fs.length - FIND_PER_DIR_MAX}\n`;
    out += '\n';
  }
  if (dirs.length > FIND_TOTAL_DIR_MAX) out += `+${dirs.length - FIND_TOTAL_DIR_MAX} more dirs\n`;
  return out;
});

const tree = filter('tree', (input: string): string => {
  const lines = input.split('\n');
  if (lines.length === 0) return input;
  const filtered: string[] = [];
  for (const line of lines) {
    if (line.includes('director') && line.includes('file')) continue;
    if (line.trim() === '' && filtered.length === 0) continue;
    filtered.push(line);
  }
  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') filtered.pop();
  if (filtered.length > TREE_MAX_LINES) {
    const cut = filtered.length - TREE_MAX_LINES;
    return filtered.slice(0, TREE_MAX_LINES).join('\n') + `\n... +${cut} more lines`;
  }
  return filtered.join('\n');
});

const LS_DATE_RE = /\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(\d{4}|\d{2}:\d{2})\s+/;
function humanSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}
const ls = filter('ls', (input: string): string => {
  const dirs: string[] = [];
  const files: [string, string][] = [];
  const byExt = new Map<string, number>();
  for (const line of input.split('\n')) {
    if (line.startsWith('total ') || line.length === 0) continue;
    const m = LS_DATE_RE.exec(line);
    if (!m) continue;
    const name = line.slice(m.index + m[0].length);
    const beforeParts = line.slice(0, m.index).split(/\s+/).filter(Boolean);
    if (beforeParts.length < 4) continue;
    const fileType = beforeParts[0].charAt(0);
    let size = 0;
    for (let i = beforeParts.length - 1; i >= 0; i--) {
      const n = Number(beforeParts[i]);
      if (Number.isInteger(n) && String(n) === beforeParts[i]) { size = n; break; }
    }
    if (name === '.' || name === '..' || LS_NOISE_DIRS.includes(name)) continue;
    if (fileType === 'd') dirs.push(name);
    else if (fileType === '-' || fileType === 'l') {
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot) : 'no ext';
      byExt.set(ext, (byExt.get(ext) || 0) + 1);
      files.push([name, humanSize(size)]);
    }
  }
  if (dirs.length === 0 && files.length === 0) return input;
  let out = '';
  for (const d of dirs) out += `${d}/\n`;
  for (const [name, size] of files) out += `${name}  ${size}\n`;
  let summary = `\nSummary: ${files.length} files, ${dirs.length} dirs`;
  if (byExt.size > 0) {
    const ext = Array.from(byExt.entries()).sort((a, b) => b[1] - a[1]);
    const parts = ext.slice(0, LS_EXT_SUMMARY_TOP).map(([e, c]) => `${c} ${e}`);
    summary += ` (${parts.join(', ')}`;
    if (ext.length > LS_EXT_SUMMARY_TOP) summary += `, +${ext.length - LS_EXT_SUMMARY_TOP} more`;
    summary += ')';
  }
  return out + summary;
});

const searchList = filter('search-list', (input: string): string => {
  const lines = input.split('\n');
  if (lines.length === 0) return input;
  const header = lines[0] || '';
  const paths: string[] = [];
  for (const raw of lines.slice(1)) {
    const t = raw.trim();
    if (!t.startsWith('- ')) continue;
    paths.push(t.slice(2));
  }
  if (paths.length === 0) return input;
  const byDir = new Map<string, string[]>();
  for (const p of paths) {
    const slash = p.lastIndexOf('/');
    const dir = slash === -1 ? '.' : (p.slice(0, slash) || '/');
    const name = slash === -1 ? p : p.slice(slash + 1);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(name);
  }
  const dirs = Array.from(byDir.keys()).sort();
  let out = `${header}\n${paths.length} files in ${dirs.length} dirs:\n\n`;
  for (const dir of dirs.slice(0, SEARCH_LIST_TOTAL_DIR_MAX)) {
    const names = byDir.get(dir)!;
    out += `${dir}/ (${names.length}):\n`;
    for (const n of names.slice(0, SEARCH_LIST_PER_DIR_MAX)) out += `  ${n}\n`;
    if (names.length > SEARCH_LIST_PER_DIR_MAX) out += `  +${names.length - SEARCH_LIST_PER_DIR_MAX}\n`;
    out += '\n';
  }
  if (dirs.length > SEARCH_LIST_TOTAL_DIR_MAX) out += `+${dirs.length - SEARCH_LIST_TOTAL_DIR_MAX} more dirs\n`;
  return out.replace(/\n+$/, '');
});

const readNumbered = filter('read-numbered', (input: string): string => {
  const lines = input.split('\n');
  if (lines.length < SMART_TRUNCATE_MIN_LINES) return input;
  const head = lines.slice(0, SMART_TRUNCATE_HEAD);
  const tail = lines.slice(lines.length - SMART_TRUNCATE_TAIL);
  const cut = lines.length - head.length - tail.length;
  return [...head, `... +${cut} lines truncated (file continues)`, ...tail].join('\n');
});

const dedupLog = filter('dedup-log', (input: string): string => {
  const lines = input.split('\n');
  const out: string[] = [];
  let prev: string | null = null, runCount = 0, blankStreak = 0;
  const flushRun = () => { if (prev !== null && runCount > 1) out.push(`  ... (${runCount - 1} duplicate lines)`); };
  for (const line of lines) {
    if (line.trim() === '') {
      if (blankStreak < 1) out.push(line);
      blankStreak += 1; flushRun(); prev = null; runCount = 0; continue;
    }
    blankStreak = 0;
    if (line === prev) { runCount += 1; continue; }
    flushRun(); out.push(line); prev = line; runCount = 1;
    if (out.length >= DEDUP_LINE_MAX) { out.push(`... (truncated at ${DEDUP_LINE_MAX} lines)`); return out.join('\n'); }
  }
  flushRun();
  return out.join('\n');
});

const smartTruncate = filter('smart-truncate', (input: string): string => {
  const lines = input.split('\n');
  if (lines.length < SMART_TRUNCATE_MIN_LINES) return input;
  const head = lines.slice(0, SMART_TRUNCATE_HEAD);
  const tail = lines.slice(lines.length - SMART_TRUNCATE_TAIL);
  const cut = lines.length - head.length - tail.length;
  return [...head, `... +${cut} lines truncated`, ...tail].join('\n');
});

// ── autodetect ──────────────────────────────────────────────────────────────
const RE_GIT_DIFF = /^diff --git /m;
const RE_GIT_DIFF_HUNK = /^@@ /m;
const RE_GIT_STATUS = /^On branch |^nothing to commit|^Changes (not |to be )|^Untracked files:/m;
const RE_PORCELAIN = /^[ MADRCU?!][ MADRCU?!] \S/m;
const RE_BUILD_OUTPUT = /^(npm (warn|error|ERR!)|yarn (warn|error)|\s*Compiling\s+\S+|\s*Downloading\s+\S+|added \d+ package|\[ERROR\]|BUILD (SUCCESS|FAILED)|\s*Finished\s+|Successfully (installed|built)|ERROR:)/im;
const RE_TREE_GLYPH = /[├└]──|│  /;
const RE_LS_ROW = /^[-dlbcps][rwx-]{9}/m;
const RE_LS_TOTAL = /^total \d+$/m;

function isGrepLine(line: string): boolean {
  const first = line.indexOf(':');
  if (first === -1) return false;
  const second = line.indexOf(':', first + 1);
  if (second === -1) return false;
  return /^\d+$/.test(line.slice(first + 1, second));
}
function isPathLike(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.includes(':')) return false;
  return t.startsWith('.') || t.startsWith('/') || t.includes('/');
}
function isMostlyPorcelain(head: string): boolean {
  const lines = head.split('\n').filter(l => l.trim());
  if (lines.length < 3) return false;
  return lines.filter(l => RE_PORCELAIN.test(l)).length / lines.length >= 0.6;
}
function isLineNumbered(lines: string[]): boolean {
  let hits = 0, nonEmpty = 0;
  for (const l of lines.slice(0, 100)) {
    if (l.length === 0) continue;
    nonEmpty++;
    if (READ_NUMBERED_LINE_RE.test(l)) hits++;
  }
  if (nonEmpty < 5) return false;
  return hits / nonEmpty >= READ_NUMBERED_MIN_HIT_RATIO;
}
function countMatches(text: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return (text.match(g) || []).length;
}

export function autoDetectFilter(text: string): Filter | null {
  const head = text.length > DETECT_WINDOW ? text.slice(0, DETECT_WINDOW) : text;
  if (RE_GIT_DIFF.test(head) || RE_GIT_DIFF_HUNK.test(head)) return gitDiff;
  if (RE_GIT_STATUS.test(head)) return gitStatus;
  if (RE_BUILD_OUTPUT.test(head)) return buildOutput;
  if (isMostlyPorcelain(head)) return gitStatus;
  const lines = head.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.slice(0, 5).some(isGrepLine)) return grep;
  if (nonEmpty.length >= 3 && nonEmpty.every(isPathLike)) return find;
  if (RE_TREE_GLYPH.test(head)) return tree;
  if (RE_LS_TOTAL.test(head) || countMatches(head, RE_LS_ROW) >= 3) return ls;
  if (SEARCH_LIST_HEADER_RE.test(head)) return searchList;
  if (lines.length >= SMART_TRUNCATE_MIN_LINES && isLineNumbered(lines)) return readNumbered;
  if (nonEmpty.length >= 5) return dedupLog;
  if (text.split('\n').length >= SMART_TRUNCATE_MIN_LINES) return smartTruncate;
  return null;
}

function safeApply(fn: Filter, text: string): string {
  try {
    const out = fn(text);
    return typeof out === 'string' ? out : text;
  } catch (err) {
    console.warn(`[rtk] filter '${fn.filterName}' threw — passing through raw: ${(err as Error)?.message ?? err}`);
    return text;
  }
}

// Compress one tool-output string. Guards: skip tiny/huge, never empty, never grow.
// Returns the (possibly) compressed text + which filter fired + bytes saved.
export function compressToolOutput(text: string): { text: string; filter: string | null; saved: number } {
  const bytesIn = text.length;
  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) return { text, filter: null, saved: 0 };
  const fn = autoDetectFilter(text);
  if (!fn) return { text, filter: null, saved: 0 };
  const out = safeApply(fn, text);
  if (!out || out.length === 0 || out.length >= bytesIn) return { text, filter: null, saved: 0 };
  return { text: out, filter: fn.filterName, saved: bytesIn - out.length };
}
