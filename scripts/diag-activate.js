/* eslint-disable */
// Diagnostic: load the compiled extension with a minimal `vscode` stub and
// call activate() to surface any top-level throw or synchronous hang that would
// make the real extension host fail to start.
const Module = require('module');
const origLoad = Module._load;

const noop = () => undefined;
const event = { dispose: noop };
const config = {
  get: () => undefined,
  update: async () => undefined,
  has: () => false,
  inspect: () => undefined,
};
const stub = {
  version: '1.90.0',
  Uri: {
    file: (p) => ({ fsPath: p, scheme: 'file', toString: () => 'file://' + p }),
    joinPath: (b, ...s) => ({ fsPath: b.fsPath + '/' + s.join('/'), toString: () => '' }),
    parse: (s) => ({ fsPath: s, toString: () => s }),
  },
  workspace: {
    getConfiguration: () => config,
    workspaceFolders: [{ uri: { fsPath: __dirname, toString: () => __dirname }, name: 'code', index: 0 }],
    fs: {
      readFile: async () => Buffer.from(''),
      writeFile: async () => undefined,
      readDirectory: async () => [],
      stat: async () => ({ size: 0 }),
    },
    textDocuments: [],
    onDidChangeConfiguration: () => event,
    asRelativePath: (u) => (u && u.fsPath ? u.fsPath.replace(__dirname, '') : ''),
  },
  window: {
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showInputBox: async () => undefined,
    registerWebviewViewProvider: () => event,
    activeTextEditor: undefined,
    createOutputChannel: () => ({ appendLine: noop, dispose: noop }),
  },
  commands: { registerCommand: () => event, executeCommand: async () => undefined },
  languages: { getDiagnostics: () => [] },
  EventEmitter: class { constructor() { this.event = noop; this.fire = noop; } dispose() {} },
  Disposable: class { constructor(dispose) { this.dispose = dispose || noop; } static from(...d) { return { dispose: () => d.forEach((x) => x.dispose && x.dispose()) }; } },
  StatusBarAlignment: { Left: 1, Right: 2 },
  FileType: { File: 1, Directory: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  Range: class {},
  Position: class {},
  Selection: class {},
  ProgressLocation: { SourceControl: 0, Window: 10, Notification: 15 },
  ViewColumn: { One: 1, Two: 2 },
};

Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return stub;
  }
  return origLoad.apply(this, arguments);
};

(async () => {
  const path = require('path');
  const started = Date.now();
  const ext = require(path.join(__dirname, '..', 'out', 'extension.js'));
  console.log('loaded extension.js in', Date.now() - started, 'ms; activate =', typeof ext.activate);

  const context = {
    subscriptions: [],
    extensionUri: { fsPath: __dirname, toString: () => __dirname },
    extensionPath: __dirname,
    globalState: { get: () => undefined, update: async () => undefined, keys: () => [] },
    workspaceState: { get: () => undefined, update: async () => undefined, keys: () => [] },
    secrets: { get: async () => undefined, store: async () => undefined, delete: async () => undefined },
    globalStorageUri: { fsPath: __dirname },
    logUri: { fsPath: __dirname },
  };

  const watchdog = setTimeout(() => {
    console.error('WATCHDOG: activate() did not resolve within 15s — this mirrors the 10s extension-host timeout.');
    process.exit(3);
  }, 15000);

  try {
    const p = ext.activate(context);
    console.log('activate() returned a promise');
    await p;
    clearTimeout(watchdog);
    console.log('activate() resolved OK in', Date.now() - started, 'ms');
    console.log('subscriptions registered:', context.subscriptions.length);
    process.exit(0);
  } catch (e) {
    clearTimeout(watchdog);
    console.error('ACTIVATE THREW:', e && e.stack ? e.stack : e);
    process.exit(2);
  }
})();
