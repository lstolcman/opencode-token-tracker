# README Design Spec — opencode-token-tracker

**Date:** 2026-03-21  
**Author:** Eduardo Serete  
**Status:** Approved

---

## Overview

The `opencode-token-tracker` project is a single-file OpenCode plugin (`token-tracker.js`) that hooks into OpenCode's event system to display token usage, cost, and performance metrics as a toast notification after each AI request.

The repository is currently public but has no README, no installation instructions, and no explanation of what the plugin does. This spec defines the content and structure of the README to be created.

---

## Goals

- Enable any OpenCode user to understand what the plugin does in under 30 seconds
- Provide copy-paste installation instructions
- Document every field shown in the toast output
- Honestly communicate tradeoffs (pros/cons)

---

## Target Audience

OpenCode users who are comfortable with CLI tools and want visibility into how many tokens and how much money each AI request is costing them.

---

## README Structure

### 1. Title + Tagline
- Repo name: `opencode-token-tracker`
- Tagline: one sentence describing the plugin's value

### 2. What it does
Short paragraph explaining the plugin behavior:
- Listens to `session.idle` events
- Reads the last assistant message's token data
- Displays a toast with all metrics
- Aggregates data from subagent child sessions when present

Fields shown in the toast:
| Field | Description |
|---|---|
| `in` | Input tokens |
| `out` | Output tokens |
| `think` | Reasoning tokens (if any) |
| `cache↓` | Cache read tokens (if any) |
| `cache↑` | Cache write tokens (if any) |
| `t` | Response latency in seconds |
| `$` | Cost for this message |
| `session` | Cumulative cost for the session |
| model | Provider/model used |
| `reqs` | Number of premium requests in the session |
| `finish` | Finish reason (only shown if not `end_turn` or `tool_calls`) |
| `[+N subagents]` | Number of subagent sessions aggregated (if any) |

### 3. Screenshot / Example output
A fenced code block showing a realistic toast line:
```
[tokens] in: 45,231  |  out: 1,204  |  cache↓: 120,000  |  t: 4.2s  |  $0.0032  |  session: $0.0187  |  github-copilot/claude-sonnet-4.6  |  reqs: 3
```

### 4. Installation

Two options — no `opencode.json` edit required for local installs:

**Option A — Global (all projects)**
Copy `token-tracker.js` to `~/.config/opencode/plugins/`

**Option B — Project-only**
Copy `token-tracker.js` to `.opencode/plugins/` inside the project directory

Files in these directories are auto-loaded at OpenCode startup. No further configuration needed.

**Option C — via npm (if published)**
Add to `opencode.json`:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-token-tracker"]
}
```

### 5. Configuration
None required. The plugin works out-of-the-box with zero configuration.

### 6. Pros
- Zero configuration
- Works with subagents — automatically aggregates child session tokens
- Deduplicates cost by message ID to avoid double-counting
- Never disrupts the session (all errors are silently swallowed)
- Resets per-session counters on new prompt, so `session:` cost reflects the current conversation
- Shows reasoning tokens when the model uses extended thinking

### 7. Cons / Limitations
- For simple sessions (no subagents), only the last assistant message is shown — intermediate tool-call costs are not broken out individually
- Cost accuracy depends on the provider reporting token counts correctly to OpenCode
- Toast persists for 5 minutes then disappears — no persistent log
- No cumulative across-session tracking (resets when a new prompt starts)

### 8. License
MIT

---

## Style Guidelines

- Language: English
- Tone: concise, practical, no marketing fluff
- No badges (keep it minimal)
- Code blocks for all commands and JSON snippets
- Table for the field reference

---

## Out of Scope

- Adding new features to the plugin itself
- Creating a configuration system
- Persistent logging or export functionality
