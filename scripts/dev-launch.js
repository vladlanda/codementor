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

const root = path.join(__dirname, '..');
const tmp = path.join(root, '.dev-instance');
const ud = path.join(tmp, 'udata');
const exts = path.join(tmp, 'exts');
const logs = path.join(ud, 'logs');

// ensure dirs exist
require('fs').mkdirSync(ud, { recursive: true });
require('fs').mkdirSync(exts, { recursive: true });

const code = 'D:\\Programs\\Microsoft VS Code\\Code.exe';
const args = [
  `--extensionDevelopmentPath=${root}`,
  `--extensions-dir=${exts}`,
  `--user-data-dir=${ud}`,
  '--no-sandbox',
  root, // open our workspace
];

console.log('Launching dev host (no debugger)…');
console.log('  user-data-dir:', ud);
console.log('  extension dev path:', root);
// VS Code writes its own logs under <ud>\logs — no need to redirect stdio.
spawn(code, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();

setTimeout(() => {
  try {
    // check if any Code process is using our isolated user-data dir
    const ps = execSync(
      `Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like "*${ud}*" } | Select-Object -First 1 -ExpandProperty ProcessId`,
      { shell: 'powershell', stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();
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
