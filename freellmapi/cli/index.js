#!/usr/bin/env node
'use strict';

// llmpanda — launch coding agents against your LLM Panda free-model proxy.
//
//   npx llmpanda <agent> [--model auto] [--base-url URL] [--key KEY] [-- ...agent args]
//   npx llmpanda login                # save your key + base URL
//   npx llmpanda env <agent>          # print the export lines (for editors)
//
// It injects the right env vars for each agent and execs the real binary.
// Claude Code speaks the Anthropic Messages API (/v1/messages); the rest are
// OpenAI-compatible (/v1/chat/completions or /v1/responses).

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const DEFAULT_BASE = 'https://llmpanda.io';
const CONFIG_DIR = path.join(os.homedir(), '.llmpanda');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Agent → how to launch it. `kind` selects the env recipe.
//   anthropic : ANTHROPIC_BASE_URL (root) + ANTHROPIC_AUTH_TOKEN
//   openai    : OPENAI_BASE_URL / OPENAI_API_BASE (/v1) + OPENAI_API_KEY
// `bin` is the binary to exec; `modelFlag` injects --model when given.
const AGENTS = {
  claude:   { kind: 'anthropic', bin: 'claude',   modelFlag: '--model' },
  codex:    { kind: 'openai',    bin: 'codex',     modelFlag: '-m' },
  aider:    { kind: 'openai',    bin: 'aider',     modelFlag: '--model' },
  goose:    { kind: 'openai',    bin: 'goose',     modelFlag: null },
  opencode: { kind: 'openai',    bin: 'opencode',  modelFlag: '--model' },
  continue: { kind: 'openai',    bin: 'cn',        modelFlag: null },
  // Editor integrations (no spawnable CLI) — use `llmpanda env <agent>` and
  // paste the values into the extension's OpenAI-compatible provider settings.
  cline:    { kind: 'openai',    bin: null,        modelFlag: null },
  roo:      { kind: 'openai',    bin: null,        modelFlag: null },
  zed:      { kind: 'openai',    bin: null,        modelFlag: null },
};

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function writeConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

// Parse argv into { agent, flags, passthrough }. Everything after `--` is passed
// straight to the agent binary.
function parseArgs(argv) {
  const flags = {};
  const rest = [];
  let agent = null;
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (a === '--base-url' || a === '--base') { flags.baseUrl = argv[++i]; continue; }
    if (a === '--key') { flags.key = argv[++i]; continue; }
    if (a === '--model') { flags.model = argv[++i]; continue; }
    if (a.startsWith('--base-url=')) { flags.baseUrl = a.slice(11); continue; }
    if (a.startsWith('--model=')) { flags.model = a.slice(8); continue; }
    if (a.startsWith('--key=')) { flags.key = a.slice(6); continue; }
    if (!agent) { agent = a; continue; }
    rest.push(a); // unknown leading arg → forward to agent
  }
  return { agent, flags, passthrough: rest };
}

// Trim a trailing slash so we can append paths predictably.
function trimSlash(u) { return u.replace(/\/+$/, ''); }

function buildEnv(kind, base, key) {
  const root = trimSlash(base);
  if (kind === 'anthropic') {
    return {
      ANTHROPIC_BASE_URL: root,        // Claude Code appends /v1/messages
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_API_KEY: '',
    };
  }
  const v1 = `${root}/v1`;
  return {
    OPENAI_BASE_URL: v1,               // codex, opencode, continue…
    OPENAI_API_BASE: v1,               // aider uses this name
    OPENAI_API_KEY: key,
  };
}

function envLines(env) {
  return Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join('\n');
}

function resolve(flags) {
  const cfg = readConfig();
  const baseUrl = flags.baseUrl || process.env.LLMPANDA_BASE_URL || cfg.baseUrl || DEFAULT_BASE;
  const key = flags.key || process.env.LLMPANDA_KEY || cfg.key || '';
  return { baseUrl, key };
}

function ask(question, { silent = false } = {}) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (silent) {
      // Mute echo while typing a secret.
      const onData = () => { rl.output.write('[2K[200D' + question); };
      rl._writeToOutput = function () { rl.output.write(''); };
      process.stdin.on('data', onData);
      rl.question(question, (ans) => { process.stdin.off('data', onData); rl.close(); process.stdout.write('\n'); res(ans.trim()); });
    } else {
      rl.question(question, (ans) => { rl.close(); res(ans.trim()); });
    }
  });
}

async function cmdLogin(flags) {
  const cfg = readConfig();
  const base = flags.baseUrl || (await ask(`Base URL [${cfg.baseUrl || DEFAULT_BASE}]: `)) || cfg.baseUrl || DEFAULT_BASE;
  const key = flags.key || (await ask('LLM Panda API key (Coding Agents key): ', { silent: true })) || cfg.key || '';
  writeConfig({ baseUrl: trimSlash(base), key });
  console.log(`Saved to ${CONFIG_FILE}`);
}

function printHelp() {
  const names = Object.keys(AGENTS).join(', ');
  console.log(`llmpanda — run coding agents on your LLM Panda free models

Usage:
  llmpanda <agent> [--model auto] [--base-url URL] [--key KEY] [-- ...agent args]
  llmpanda login                 Save your key + base URL to ~/.llmpanda/config.json
  llmpanda env <agent>           Print the export lines (for editors: Cline, Roo, Zed)
  llmpanda help

Agents: ${names}

Examples:
  llmpanda login
  llmpanda claude --model auto
  llmpanda codex
  llmpanda aider -- --yes
  llmpanda env cline             # paste the printed values into Cline's OpenAI provider

Resolution order for key/base: --flags > env (LLMPANDA_KEY / LLMPANDA_BASE_URL) > ~/.llmpanda/config.json > default (${DEFAULT_BASE}).`);
}

function launch(agentKey, flags, passthrough) {
  const spec = AGENTS[agentKey];
  const { baseUrl, key } = resolve(flags);
  if (!key) {
    console.error('No API key. Run `llmpanda login`, pass --key, or set LLMPANDA_KEY.');
    process.exit(1);
  }
  const env = buildEnv(spec.kind, baseUrl, key);

  if (!spec.bin) {
    // Editor integration — no CLI to spawn. Print the values to paste.
    console.log(`# ${agentKey} is an editor integration — paste these into its OpenAI-compatible provider settings:\n`);
    console.log(envLines(env));
    console.log(`\n# Base URL:   ${trimSlash(baseUrl)}/v1\n# API key:    (your Coding Agents key)\n# Model:      auto (or a specific id)`);
    return;
  }

  const args = [...passthrough];
  if (spec.modelFlag && flags.model) args.unshift(spec.modelFlag, flags.model);

  const child = spawn(spec.bin, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(`'${spec.bin}' not found on PATH. Install ${agentKey} first, then re-run.`);
      console.error(`Tip: \`llmpanda env ${agentKey}\` prints the env vars to set manually.`);
      process.exit(127);
    }
    console.error(String(err.message || err));
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

async function main() {
  const { agent, flags, passthrough } = parseArgs(process.argv.slice(2));

  if (!agent || agent === 'help' || agent === '--help' || agent === '-h') { printHelp(); return; }
  if (agent === 'login') { await cmdLogin(flags); return; }
  if (agent === 'env') {
    const target = passthrough[0];
    if (!target || !AGENTS[target]) { console.error(`Usage: llmpanda env <${Object.keys(AGENTS).join('|')}>`); process.exit(1); }
    const { baseUrl, key } = resolve(flags);
    console.log(envLines(buildEnv(AGENTS[target].kind, baseUrl, key)));
    return;
  }

  if (!AGENTS[agent]) {
    console.error(`Unknown agent '${agent}'. Known: ${Object.keys(AGENTS).join(', ')}`);
    console.error('Run `llmpanda help` for usage.');
    process.exit(1);
  }
  launch(agent, flags, passthrough);
}

main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
