# CodeMentor Agent

An AI-powered coding agent that helps you **build real software** while **teaching you programming** through the implementation process — as a VS Code extension.

CodeMentor combines an autonomous coding assistant with an adaptive programming tutor. You describe an application or feature in natural language; the agent inspects your workspace, proposes a plan, creates and edits files, runs commands and tests with your approval, and explains the code and decisions as the project develops.

> **Product promise:** Build real projects with an AI agent that helps you *understand, practice, and progressively take ownership* of the code.

The defining goal is not to generate code with explanations appended. It is to help you understand, practice, and grow into ownership of the software you're building.

---

## Features

- **Autonomous, workspace-aware coding** — inspects files, edits across multiple files, runs terminal commands, and reads diagnostics.
- **Grounded teaching** — explanations are based on the actual workspace code, diffs, tool results, and diagnostics, not just the model's claims.
- **Explain Selection** — select any code in an editor and ask CodeMentor to explain it in context.
- **Safety by default** — file changes and terminal commands require your explicit approval; sensitive paths are guarded.
- **Concurrent-edit protection** — edits are validated against the current file state (SHA-256 base check + unique-occurrence enforcement).
- **Provider independence** — works with **local models via Ollama** (Qwen-family as the initial target) and **remote models via any OpenAI-compatible API**.
- **Explicit task state machine** — visible states (`planning → awaiting_approval → executing → explaining → validating → completed`, plus `cancelled`/`failed`).
- **Configurable autonomy & explanation depth** — from guided step-by-step to autonomous, with concise/standard/deep teaching.

## Product principles

1. **Project-first learning** — teach concepts when they become relevant to your actual project.
2. **Explain why, not only what** — purpose, execution, design decisions, and tradeoffs.
3. **Layered explanations** — concise by default, with optional depth, examples, and knowledge checks.
4. **User agency** — you control autonomy, approvals, and explanation depth.
5. **Progressive independence** — encourage implementing changes yourself as you grow.
6. **Grounded explanations** — based on real workspace artifacts, not agent claims.
7. **Safe-by-default execution** — approve consequential or destructive operations.
8. **Provider independence** — no behavior hardcoded to a single model or provider.
9. **Honest learning state** — distinguish *introduced* concepts from *demonstrated* understanding.
10. **Useful without interruption** — teaching is configurable and never blocks ordinary coding.

## Requirements

- **VS Code** `^1.90.0`
- **Node.js** (for building)
- A model provider:
  - **Ollama** running locally (e.g. `http://localhost:11434`) with a Qwen-family model, *or*
  - An **OpenAI-compatible** API endpoint + API key.

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Compile
npm run compile

# 3a. Run with the debugger (F5 "Run Extension" in VS Code)
#     — or —
# 3b. Run a dev host without the debugger
npm run dev
npm run dev:stop   # close that window when done
```

### Tests & lint

```bash
npm test     # compiles + lints, then runs the node --test suite
npm run lint
npm run compile
```

## Configuration

Set these in your VS Code settings (search for `codementor.`):

| Setting | Default | Description |
|---|---|---|
| `codementor.provider.type` | `ollama` | `ollama` or `openai` (OpenAI-compatible). |
| `codementor.ollama.baseUrl` | `http://localhost:11434` | Ollama base URL. |
| `codementor.ollama.model` | `qwen2.5:7b` | Ollama model identifier. |
| `codementor.openai.baseUrl` | `https://api.openai.com/v1` | OpenAI-compatible API base URL. |
| `codementor.openai.model` | `gpt-4o-mini` | OpenAI-compatible model. |
| `codementor.autonomy` | `guided` | `guided` · `balanced` · `autonomous`. |
| `codementor.explanationDepth` | `standard` | `concise` · `standard` · `deep`. |
| `codementor.approval.fileChanges` | `true` | Require approval before file writes/edits. |
| `codementor.approval.terminalCommands` | `true` | Require approval before terminal commands. |
| `codementor.maxToolIterations` | `25` | Max tool-call iterations per task. |
| `codementor.maxOutputChars` | `20000` | Max chars of tool output fed back to the model. |
| `codementor.timeoutMs` | `120000` | Timeout for a single model request. |

API keys for the OpenAI-compatible provider are stored securely in VS Code's **Secret Storage** (never in `settings.json`).

## Commands

- **CodeMentor: New Chat** — start a fresh conversation.
- **CodeMentor: Explain Selection** — explain the current editor selection in project context.
- **CodeMentor: Cancel Active Task** — stop the running task.
- **CodeMentor: Connect Provider** — re-test the provider connection.
- **CodeMentor: View Learning Profile** — review your learning progress.

## Project status

| Milestone | Scope | Status |
|---|---|---|
| **M1** | Extension scaffold, sidebar view, commands, settings + SecretStorage, typed host↔webview protocol | ✅ Done |
| **M2** | Provider interface, Ollama + OpenAI-compatible adapters, streaming, capability/ping | ✅ Done |
| **M3** | Workspace context (safe list/read/search), path guard | ✅ Done |
| **M4** | Controlled coding tools with approval, concurrent-edit protection, terminal classification, tool registry + arg validation | ✅ Done |
| **M5** | Agent orchestrator (bounded tool-call loop, streaming, cancellation, approvals), task state machine, host wiring, Explain Selection, approval UI, tests | ✅ Done |
| **M6** | Teaching engine, real Explain Selection grounding, follow-ups, learning checkpoints, learning profile | 🔜 In progress |
| **M7** | Persistence (conversation + learning notes), polish, full test coverage | ⏳ Planned |

## Architecture

The extension is structured so the **agent core is `vscode`-free** and runs under plain Node (which is what keeps it unit-testable):

- **`src/providers/`** — provider-agnostic `LLMProvider` interface with Ollama and OpenAI-compatible adapters, shared HTTP/streaming, and a `ConnectionManager`.
- **`src/context/`** — pure `pathGuard` + a VS Code-backed `WorkspaceContext` for safe file access.
- **`src/tools/`** — `vscode`-free tool modules (read/write/terminal) with a `ToolRegistry` that validates model arguments at runtime via `zod`.
- **`src/agent/`** — `Orchestrator` + `TaskStateMachine` + system-prompt builder.
- **`src/services/`** — `AgentRunner`, `SettingsService`, and `vscode` host adapters (file sink, shell, diagnostics).
- **`src/ui/` + `resources/`** — the sidebar webview (chat UI, approval cards) and its client.
- **`src/messaging/`** — typed, discriminated-union host↔webview message protocol.

VS Code APIs are injected into the core through a `ToolContext`, so tools and the orchestrator never import `vscode` directly.

## License

MIT
