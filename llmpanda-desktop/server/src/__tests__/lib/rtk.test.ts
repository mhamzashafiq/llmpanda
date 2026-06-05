import { describe, it, expect } from 'vitest';
import { autoDetectFilter, compressToolOutput } from '../../lib/rtk.js';

describe('RTK autoDetectFilter', () => {
  it('detects git diff', () => {
    const diff = 'diff --git a/x.ts b/x.ts\n@@ -1,3 +1,3 @@\n-old\n+new\n context\n';
    expect(autoDetectFilter(diff)?.filterName).toBe('git-diff');
  });
  it('detects grep', () => {
    const g = 'src/a.ts:10:const x = 1\nsrc/a.ts:20:const y = 2\nsrc/b.ts:5:foo()\n';
    expect(autoDetectFilter(g)?.filterName).toBe('grep');
  });
  it('detects ls -la (total header)', () => {
    const l = 'total 12\n-rw-r--r-- 1 u g 100 Jan 1 12:00 a.ts\n-rw-r--r-- 1 u g 200 Jan 1 12:00 b.ts\ndrwxr-xr-x 2 u g 4096 Jan 1 12:00 dir\n';
    expect(autoDetectFilter(l)?.filterName).toBe('ls');
  });
  it('falls back to dedup-log for generic repeated lines', () => {
    const d = Array.from({ length: 20 }, () => 'a generic noisy log line of some length here').join('\n');
    expect(autoDetectFilter(d)?.filterName).toBe('dedup-log');
  });
});

describe('RTK compressToolOutput', () => {
  it('skips tiny blobs (< MIN_COMPRESS_SIZE)', () => {
    const r = compressToolOutput('short');
    expect(r.filter).toBeNull();
    expect(r.text).toBe('short');
  });

  it('compresses a large grep dump (never empty, never grows)', () => {
    const lines: string[] = [];
    for (let f = 0; f < 3; f++) for (let n = 0; n < 40; n++) lines.push(`src/file${f}.ts:${n}:  some matching code content number ${n}`);
    const input = lines.join('\n');
    const r = compressToolOutput(input);
    expect(r.filter).toBe('grep');
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.text.length).toBeLessThan(input.length);
    expect(r.saved).toBe(input.length - r.text.length);
  });

  it('collapses duplicate log lines', () => {
    const input = Array.from({ length: 200 }, () => 'repeated noisy line of moderate length that duplicates').join('\n');
    const r = compressToolOutput(input);
    expect(r.filter).toBe('dedup-log');
    expect(r.text.length).toBeLessThan(input.length);
    expect(r.text).toContain('duplicate lines');
  });

  it('compacts a git diff with context', () => {
    const hunks: string[] = ['diff --git a/big.ts b/big.ts', '@@ -1,50 +1,50 @@'];
    for (let i = 0; i < 60; i++) hunks.push(` unchanged context line ${i} that stays the same in the diff`);
    hunks.push('+a new added line of code');
    hunks.push('-an old removed line of code');
    const input = hunks.join('\n');
    const r = compressToolOutput(input);
    expect(r.filter).toBe('git-diff');
    expect(r.text.length).toBeLessThanOrEqual(input.length);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('never returns empty even when a filter would', () => {
    // pathological: many blank-ish lines
    const input = '\n'.repeat(600) + 'x'.repeat(600);
    const r = compressToolOutput(input);
    expect(r.text.length).toBeGreaterThan(0);
  });
});
