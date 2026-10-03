#!/usr/bin/env node
/**
 * dev-stop.js — kills only the isolated dev host window we launched
 * (identified by its .dev-instance user-data dir). Your main editor is untouched.
 */
const path = require('path');
const { execSync } = require('child_process');

const ud = path.join(__dirname, '..', '.dev-instance', 'udata').replace(/\\/g, '\\\\');
try {
  const pids = execSync(
    `Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like "*${ud}*" } | ForEach-Object { $_.ProcessId }`,
    { shell: 'powershell', stdio: ['ignore', 'pipe', 'ignore'] }
  ).toString().trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  if (pids.length === 0) {
    console.log('No isolated dev host found (already closed?).');
    process.exit(0);
  }
  execSync(`Stop-Process -Id ${pids.join(',')} -Force`, { shell: 'powershell', stdio: 'ignore' });
  console.log(`Stopped dev host pid(s): ${pids.join(', ')}`);
} catch (e) {
  console.error('stop failed:', e.message);
  process.exit(1);
}
