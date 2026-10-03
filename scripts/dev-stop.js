#!/usr/bin/env node
/**
 * dev-stop.js — kills only the isolated dev host window we launched
 * (identified by its .dev-instance user-data dir). Your main editor is untouched.
 */
const path = require('path');
const { execSync } = require('child_process');

const isWin = process.platform === 'win32';
const ud = path.join(__dirname, '..', '.dev-instance', 'udata');
const needle = ud.replace(/\\/g, '\\\\');

function findDevHostPids() {
  if (isWin) {
    return execSync(
      `Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like "*${needle}*" } | ForEach-Object { $_.ProcessId }`,
      { shell: 'powershell', stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  // macOS / Linux: match any process whose command line references our user-data dir.
  return execSync(`ps -axww -o pid=,command=`, { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .split('\n')
    .map((line) => {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      return m ? { pid: m[1], cmd: m[2] } : null;
    })
    .filter((p) => p && p.cmd.includes(needle))
    .map((p) => p.pid);
}

function killPids(pids) {
  if (isWin) {
    execSync(`Stop-Process -Id ${pids.join(',')} -Force`, { shell: 'powershell', stdio: 'ignore' });
  } else {
    for (const pid of pids) {
      try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}

try {
  const pids = findDevHostPids();

  if (pids.length === 0) {
    console.log('No isolated dev host found (already closed?).');
    process.exit(0);
  }
  killPids(pids);
  console.log(`Stopped dev host pid(s): ${pids.join(', ')}`);
} catch (e) {
  console.error('stop failed:', e.message);
  process.exit(1);
}
