#!/usr/bin/env node
/**
 * dev-launch.js — launches a VS Code dev extension-host instance with our
 * extension loaded, WITHOUT the debugger (avoids the js-debug attach bug).
 *
 * Uses an isolated --user-data-dir so it doesn't merge with your running
 * main editor window, and prints a clear success/failure indicator.
 *
 * Run:  node scripts/dev-launch.js
 * To stop the launched window: close the window or run  npm run dev:stop
 */
const path = require('path');
const { spawn, execSync } = require('child_process');

const isWin = process.platform === 'win32';

const root = path.join(__dirname, '..');
const tmp = path.join(root, '.dev-instance');
const ud = path.join(tmp, 'udata');
const exts = path.join(tmp, 'exts');
const logs = path.join(ud, 'logs');

// ensure dirs exist
require('fs').mkdirSync(ud, { recursive: true });
require('fs').mkdirSync(exts, { recursive: true });

// Resolve the VS Code binary for the current platform.
function resolveCodeBinary() {
  // Prefer the `code` CLI on PATH, then common install locations.
  const candidates = isWin
    ? [
        'code',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
        'D:\\Programs\\Microsoft VS Code\\Code.exe',
      ]
    : [
        'code',
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
        '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
        '/usr/local/bin/code',
        '/opt/homebrew/bin/code',
      ];
  const fs = require('fs');
  for (const c of candidates) {
    if (c === 'code') continue; // handled via PATH below
    if (fs.existsSync(c)) return c;
  }
  return 'code'; // fall back to PATH lookup
}
const code = resolveCodeBinary();

const args = [
  `--extensionDevelopmentPath=${root}`,
  `--extensions-dir=${exts}`,
  `--user-data-dir=${ud}`,
  '--no-sandbox',
  root, // open our workspace
];

console.log('Launching dev host (no debugger)…');
console.log('  code binary:', code);
console.log('  user-data-dir:', ud);
console.log('  extension dev path:', root);
// VS Code writes its own logs under <ud>/logs — no need to redirect stdio.
spawn(code, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();

// Find a running dev-host process using our isolated user-data dir.
function findDevHostPid() {
  const needle = ud.replace(/\\/g, '\\\\');
  if (isWin) {
    return execSync(
      `Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like "*${needle}*" } | Select-Object -First 1 -ExpandProperty ProcessId`,
      { shell: 'powershell', stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();
  }
  // macOS / Linux: match any process whose command line references our user-data dir.
  const out = execSync(`ps -axww -o pid=,command=`, { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .split('\n')
    .map((line) => {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      return m ? { pid: m[1], cmd: m[2] } : null;
    })
    .filter((p) => p && p.cmd.includes(needle))
    .map((p) => p.pid);
  return out[0] || '';
}

setTimeout(() => {
  try {
    // check if any Code process is using our isolated user-data dir
    const ps = findDevHostPid();
    if (ps) {
      console.log(`\nSUCCESS — dev host is running (pid ${ps}).`);
      console.log('Look for the new VS Code window. The CodeMentor sidebar should be active.');
      console.log('To stop: close that window, or run  npm run dev:stop');
      process.exit(0);
    } else {
      console.log('\nDEV HOST NOT DETECTED (may still be starting or failed).');
      const fs = require('fs');
      const tail = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').slice(-30).join('\n'); } catch { return ''; } };
      if (fs.existsSync(logs)) {
        const sessions = fs.readdirSync(logs).filter((n) => fs.statSync(path.join(logs, n)).isDirectory()).sort().reverse();
        for (const s of sessions.slice(0, 1)) {
          for (const win of ['window1', 'window2', 'window3']) {
            const rh = path.join(logs, s, win, 'renderer.log');
            const eh = path.join(logs, s, win, 'exthost.log');
            const r = tail(rh), e = tail(eh);
            if (r) console.log(`--- ${win}/renderer.log ---\n${r}`);
            if (e) console.log(`--- ${win}/exthost.log ---\n${e}`);
          }
        }
      }
      process.exit(2);
    }
  } catch (e) {
    console.error('check failed:', e.message);
    process.exit(3);
  }
}, 18000);
