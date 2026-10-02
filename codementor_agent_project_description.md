# CodeMentor Agent --- Project Description and Implementation Specification

## 1. Project Overview

**Working name:** CodeMentor Agent\
**Product type:** VS Code extension\
**Primary purpose:** An AI-powered coding agent that helps users build
real software while teaching them programming through the implementation
process.

CodeMentor Agent combines an autonomous coding assistant with an
adaptive programming tutor. A user describes an application or feature
in natural language. The agent inspects the workspace, proposes an
implementation plan, creates and edits files, runs commands and tests
with appropriate user approval, and explains the code and decisions as
the project develops.

The defining product goal is not simply to generate code with
explanations appended. It is to help users understand, practice, and
progressively take ownership of the software they are building.

The extension must support: - Local LLMs through Ollama, with
Qwen-family models as an initial target. - Remote models through
configurable OpenAI-compatible APIs. - A VS Code sidebar chat
interface. - Workspace-aware, multi-file implementation. - Reviewable
changes and safe tool execution. - Contextual explanations, follow-up
questions, learning checkpoints, and persistent learning notes.

**Product promise:** Build real projects with an AI agent that helps you
understand, practice, and progressively take ownership of the code.

## 2. Product Principles

1.  **Project-first learning:** Teach concepts when they become relevant
    to the user's actual project rather than forcing a generic course
    sequence.
2.  **Explain why, not only what:** Explain purpose, execution, design
    decisions, tradeoffs, and connections to broader programming
    concepts.
3.  **Layered explanations:** Provide concise explanations by default,
    with optional deeper explanations, examples, experiments, and
    knowledge checks.
4.  **User agency:** The user controls autonomy, approvals, explanation
    depth, and whether to engage with optional learning activities.
5.  **Progressive independence:** Encourage users to implement selected
    changes themselves as their understanding develops.
6.  **Grounded explanations:** Explanations must be based on actual
    workspace code, diffs, tool results, and diagnostics---not merely on
    the coding agent's claims.
7.  **Safe-by-default execution:** Show changes and request approval for
    potentially destructive or consequential operations.
8.  **Provider independence:** Do not hardcode behavior for one model or
    provider. Validate tool calls and handle provider differences.
9.  **Honest learning state:** Distinguish concepts introduced from
    concepts the user has demonstrated they understand. Do not claim
    mastery based only on exposure.
10. **Useful without teaching interruptions:** Teaching must be
    configurable and should not block ordinary coding workflows
    unnecessarily.

## 3. Target Users

### Primary

-   People with little or no programming experience who want to build
    practical applications.
-   Self-taught learners who understand some programming but need
    guidance through real projects.
-   Users learning a new language, framework, or development workflow.

### Secondary

-   Experienced developers exploring unfamiliar technologies.
-   Educators and mentors using project-based learning.
-   Users who prefer local models and local-first workflows.

The extension should allow users to configure different familiarity
levels by topic. A user may be experienced in Python but new to React or
databases.

## 4. Core User Experience

### 4.1 Start a project

The user opens a workspace and asks something like:

> Build me a simple expense tracker using React and TypeScript. I am a
> complete beginner. Explain the implementation as we go.

The agent should: 1. Inspect the workspace structure and relevant files.
2. Identify the project's language, framework, package manager, and
existing conventions where possible. 3. Ask only essential clarifying
questions. 4. Propose a plan with logical implementation increments. 5.
Explain the architecture and relevant concepts at the user's configured
level. 6. Wait for approval when required by the selected autonomy mode.
7. Implement incrementally, show changes, and explain them. 8. Run
relevant checks and explain failures. 9. Finish with a concise
implementation and learning recap.

### 4.2 Explain selected code

The user selects code in the editor and invokes **Explain Selection**
from a command, context menu, or chat action.

The explanation should cover, as appropriate: - What the selected code
does. - How execution flows through it. - Why relevant language
constructs or patterns are used. - How it connects to surrounding code
and the overall project. - Common mistakes or failure cases. - What
could happen if the code were changed.

Offer relevant follow-up prompts such as: - Explain this concept more
deeply. - Show a simpler example. - What happens if I change this? - How
does this connect to the backend? - Give me a small exercise about this
code.

### 4.3 Guided implementation checkpoints

During implementation, the agent should divide work into meaningful
increments such as a component, function, API endpoint, or cohesive
group of changes. Avoid pausing after every line.

For each increment: 1. State the objective. 2. Implement the code. 3.
Inspect the actual diff. 4. Explain the changed code and important
decisions. 5. Identify relevant concepts. 6. Offer optional questions or
a knowledge check. 7. Continue when the user is ready, or follow the
configured autonomy mode.

## 5. Core Features

### 5.1 Coding agent

-   Natural-language task intake.
-   Workspace and project structure inspection.
-   Multi-file creation and editing.
-   Implementation planning.
-   Tool calling for workspace operations and terminal commands.
-   Test and diagnostic execution.
-   Error analysis and repair loops.
-   Diff presentation and approval.
-   Bounded execution with cancellation and clear status.
-   Context management for larger projects.

### 5.2 Teaching engine

-   Explanations attached to actual code changes.
-   Beginner-friendly language without unnecessary simplification.
-   Explanation depth settings: concise, standard, and deep.
-   Follow-up questions and concept exploration.
-   Examples grounded in the current project.
-   Optional knowledge checks, hints, and exercises.
-   Explanations of errors and debugging steps.
-   Contextual links between code locations and concepts.

### 5.3 Learning profile

Persist a lightweight, editable learning profile containing: - User's
self-reported experience level. - Familiarity by
language/framework/topic. - Concepts introduced. - Concepts the user has
demonstrated understanding of. - Concepts needing review. - Questions
and learning preferences, where appropriate. - Project-specific learning
notes.

Do not infer mastery from merely generating or reading an explanation.
Use evidence such as a correct answer, successful independent
implementation, or explicit user self-assessment. Make the profile
inspectable and editable.

### 5.4 Learning graph (later milestone)

Connect concepts to actual files, symbols, and implementation examples.
Potential questions: - Where did I use asynchronous programming in this
project? - Which files demonstrate React state? - What concepts should I
review before implementing authentication? - Show an example of a
concept I learned earlier.

### 5.5 User-configurable autonomy

Provide three modes:

**Guided** - Explain the plan. - Implement in small logical
increments. - Pause at learning checkpoints. - Ask before consequential
tool operations.

**Balanced** - Implement larger increments. - Explain important
changes. - Offer optional deep dives. - Ask before consequential tool
operations.

**Autonomous** - Complete a bounded task with minimal interruptions. -
Respect safety and approval settings. - Provide a thorough walkthrough
and learning recap afterward.

Autonomy mode must not silently disable safety protections.

## 6. Suggested VS Code Interface

Use a VS Code sidebar view for the main chat and learning experience.

Suggested UI elements: - Chat transcript with streaming responses. -
Message input and send/cancel controls. - Provider/model selector or
access through settings. - Autonomy mode selector. - Explanation depth
selector. - Approval prompts for file changes and terminal commands. -
Diff review actions. - Learning checkpoint cards. - Follow-up question
buttons. - Explain Selection command. - Optional learning profile view.

Keep the interface focused. Do not overload the user with a dashboard in
the MVP.

Use VS Code-native APIs and patterns where possible. A webview may be
used for a richer chat UI, but communication between the extension host
and webview must be validated and typed.

## 7. Technical Architecture

### 7.1 Recommended stack

-   TypeScript.
-   VS Code Extension API.
-   VS Code sidebar view / WebviewView for chat UI.
-   Ollama HTTP API for local models.
-   OpenAI-compatible API adapter for remote providers.
-   VS Code workspace APIs for file access and edits.
-   VS Code terminal integration for command execution.
-   VS Code diagnostics and document APIs where applicable.
-   `ExtensionContext` global/workspace state for initial persistence.
-   Unit tests for core logic and integration tests for extension
    behavior.

Avoid adding a separate backend server for the MVP unless a concrete
requirement demands it.

### 7.2 High-level components

**Extension Host** - Activation and commands. - Sidebar registration. -
Workspace context services. - File edit and diff handling. - Terminal
execution and approval. - Persistence. - Provider configuration.

**Chat UI** - Conversation rendering. - Streaming output. - User input
and cancellation. - Approval and diff interactions. - Learning
checkpoint display.

**Agent Orchestrator** - Task state and planning. - Context selection. -
Tool-call loop. - Tool execution and result handling. - Cancellation,
iteration limits, and error recovery. - Coordination between coding and
teaching tasks.

**Coding Agent** - Produces implementation plans and tool calls. - Reads
and edits files through controlled tools. - Runs approved commands. -
Uses diagnostics and test results to iterate.

**Teaching Engine** - Inspects actual code and diffs. - Produces
explanations and concept suggestions. - Generates optional questions,
hints, and exercises. - Updates learning state only when supported by
evidence.

**Provider Layer** - Common interface for model requests and
streaming. - Ollama adapter. - OpenAI-compatible adapter. - Provider
capability reporting. - Tool schema normalization and response
validation.

**State and Context** - Conversation state. - Current task and plan. -
Workspace metadata. - Relevant file excerpts. - Recent diffs and tool
outputs. - Learning profile and concept history.

### 7.3 Provider abstraction

Create a provider interface that supports streaming chat and tool calls,
while exposing provider capabilities. Do not assume all
OpenAI-compatible endpoints behave identically.

Illustrative interface:

``` ts
interface LLMProvider {
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
  getModelInfo(): Promise<ModelInfo>;
  capabilities(): ProviderCapabilities;
}
```

Implement at least: - `OllamaProvider` - `OpenAICompatibleProvider`

Provider configuration should include endpoint/base URL, model
identifier, optional API key stored using VS Code `SecretStorage`, and
relevant generation settings. Never log secrets.

### 7.4 Model behavior

The initial target is the user's local Qwen model through Ollama, but do
not hardcode a particular model version or assume that every model
supports reliable tool calling or structured output.

Implement: - Tool-call validation. - Schema validation for structured
responses. - Clear errors for unsupported capabilities. - Bounded
retries for malformed output. - Cancellation and timeouts. -
Context-window-aware truncation or retrieval. - A user-visible
indication of the active provider and model.

## 8. Agent Tools and Safety

The agent should use a small, explicit tool set in the MVP, such as: -
List workspace files (respect ignore rules and exclude large/generated
directories). - Read file. - Search workspace text. - Create file. -
Edit file using validated edits. - Get diagnostics. - Run terminal
command. - Inspect recent diff.

Safety requirements: - Validate all paths and prevent workspace
escape. - Avoid reading secrets and sensitive files by default (for
example, `.env`, private keys, credential files). - Require user
approval before writing files unless the user has explicitly enabled a
suitable trusted workflow. - Show diffs before or immediately after
edits. - Require approval for terminal commands by default. - Clearly
identify commands that install packages, delete data, change
configuration, or access the network. - Never execute arbitrary
model-generated commands without the configured approval policy. -
Support cancellation. - Limit tool iterations, output size, and
execution time. - Do not claim an operation succeeded until the tool
reports success. - Keep a clear audit trail of actions within the
conversation.

For file modifications, prefer VS Code's workspace edit mechanisms and
preserve user changes. Handle concurrent edits safely; do not silently
overwrite changes made after the agent read a file.

## 9. Implementation Workflow / State Machine

Suggested flow:

1.  Receive user request.
2.  Inspect workspace and relevant project context.
3.  Clarify essential ambiguity.
4.  Create a structured implementation plan.
5.  Explain the plan and relevant concepts.
6.  Obtain required approval.
7.  Execute one logical implementation increment.
8.  Inspect actual changed files and diffs.
9.  Generate grounded teaching explanation.
10. Present checkpoint and optional learning interactions.
11. Run diagnostics/tests when appropriate.
12. If errors occur, explain and repair within bounded limits.
13. Continue remaining increments.
14. Summarize changes, validation results, and concepts introduced.
15. Update learning profile conservatively.

The orchestrator should model task status explicitly (e.g., planning,
awaiting approval, executing, explaining, validating, completed, failed,
cancelled). Avoid relying on free-form conversation text alone to track
execution state.

## 10. MVP Scope (Version 0.1)

Build a working vertical slice rather than attempting to reproduce every
feature of GitHub Copilot.

### Required MVP

1.  VS Code extension activates and registers a sidebar chat.
2.  User can configure and connect to Ollama.
3.  User can configure an OpenAI-compatible API endpoint.
4.  Chat supports streaming responses where supported.
5.  Agent can inspect workspace structure and read relevant files.
6.  Agent can propose a plan.
7.  Agent can create and edit files using controlled tools.
8.  User can review diffs and approve changes.
9.  Agent can run a terminal command only after approval.
10. Agent can inspect diagnostics and test output.
11. Agent explains each logical implementation increment based on actual
    diffs.
12. User can ask follow-up questions about the implementation.
13. User can select code and invoke Explain Selection.
14. Basic learning notes persist across sessions.
15. User can cancel an active task.
16. Errors and unsupported model capabilities are reported clearly.

### Explicitly out of scope for MVP

-   Full visual execution debugger.
-   Advanced concept graph visualization.
-   Multi-agent distributed orchestration.
-   Cloud user accounts or synchronization.
-   Institutional analytics.
-   Automatic claims of learner proficiency.
-   Support for every model/provider-specific tool-calling format.
-   Full replacement of all Copilot features.

## 11. MVP Acceptance Criteria

The MVP is considered functional when the following end-to-end scenario
works:

1.  A user opens an empty or existing workspace.
2.  They ask: "Build a simple expense tracker using React and
    TypeScript. I am a beginner; explain as you go."
3.  The extension inspects the workspace and presents a plan.
4.  The user approves the plan.
5.  The agent creates or modifies project files and presents reviewable
    diffs.
6.  After each logical increment, the extension explains the relevant
    code and decisions in understandable language.
7.  The user can ask a follow-up question and receive an answer grounded
    in the project.
8.  The user selects a code block and invokes Explain Selection.
9.  The agent runs a relevant command only after approval.
10. The agent reports actual command/test results and explains any
    failure.
11. The user can cancel an in-progress task.
12. The conversation and basic learning notes remain available after
    restarting VS Code.

## 12. Development Plan

Implement in small, testable milestones. Do not attempt all features at
once.

### Milestone 1 --- Extension foundation

-   Scaffold TypeScript VS Code extension.
-   Register sidebar and commands.
-   Implement settings and provider configuration.
-   Establish typed message passing between extension host and UI.

### Milestone 2 --- LLM connectivity

-   Implement Ollama provider.
-   Implement OpenAI-compatible provider.
-   Add streaming, cancellation, error handling, and model
    configuration.
-   Add provider capability reporting.

### Milestone 3 --- Workspace context

-   Implement safe file listing, reading, and text search.
-   Respect ignore rules and exclude generated/dependency directories.
-   Add context size limits and relevant-file selection.

### Milestone 4 --- Controlled coding tools

-   Implement create/edit file tools.
-   Add path validation, diff review, approval, and concurrent-edit
    protection.
-   Implement terminal command approval and bounded execution.
-   Add diagnostics retrieval.

### Milestone 5 --- Agent orchestration

-   Implement explicit task states and tool-call loop.
-   Add planning, bounded iterations, cancellation, and recovery.
-   Implement a simple end-to-end multi-file task.

### Milestone 6 --- Teaching experience

-   Explain actual diffs after each logical increment.
-   Implement Explain Selection.
-   Add follow-up questions and configurable explanation depth.
-   Add optional learning checkpoints.

### Milestone 7 --- Persistence and polish

-   Persist conversation and basic learning notes.
-   Improve errors, loading states, and cancellation.
-   Add tests and documentation.
-   Validate against the local Qwen model and at least one remote
    compatible provider.

## 13. Engineering Requirements

-   Use strict TypeScript settings.
-   Keep UI, provider, orchestration, tools, context, and learning logic
    separated.
-   Use typed schemas for tool inputs and structured agent outputs.
-   Validate all model-produced arguments at runtime.
-   Do not expose API keys in logs, UI messages, or persisted plaintext
    settings.
-   Avoid blocking the extension host with long-running operations.
-   Stream model output where possible.
-   Support cancellation throughout model requests and tool execution.
-   Include unit tests for path validation, tool argument validation,
    state transitions, and provider response parsing.
-   Include clear setup instructions for Ollama and remote API
    configuration.
-   Document model limitations and safe-use settings.
-   Do not fabricate tool results, test results, file contents, or
    successful completion.

## 14. Instructions to the Implementing Coding Agent

Implement this project specification as a real, runnable VS Code
extension.

Before coding: 1. Inspect the current workspace and identify existing
files, package manager, and project conventions. 2. Report a concise
implementation plan. 3. Identify any missing information that blocks
implementation; otherwise make reasonable, documented choices. 4. Start
with Milestone 1 and proceed incrementally.

During implementation: - Create a coherent project structure. - Prefer
simple, maintainable architecture over premature abstraction. - Keep the
extension functional at each milestone. - Explain significant
architectural and language decisions in the conversation. - Show diffs
or summarize exact files changed. - Run available type checks, linting,
and tests. - Fix errors based on actual diagnostics. - Ask before
destructive operations, dependency installation, or consequential
terminal commands. - Do not silently replace existing user work. - Do
not claim unimplemented features are complete.

At completion, provide: - What was implemented. - Files and major
components created. - Commands executed and their actual results. - How
to run/debug the extension in VS Code. - How to configure Ollama and the
remote provider. - Known limitations and the next milestone.

## 15. Product Success Measures (Future Validation)

The product's educational claims should be validated rather than
assumed. Potential measures: - Can users explain code generated for
their project? - Can they modify a related feature without the agent? -
Can they debug a similar error later? - Do they retain concepts after a
delay? - How often do users open optional explanations or request
hints? - Does teaching mode improve understanding without making
implementation unacceptably slow?

Do not optimize only for generated lines of code, task completion speed,
or conversation length. The product's differentiator is useful software
creation paired with demonstrable user understanding.
