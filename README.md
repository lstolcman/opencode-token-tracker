# opencode-token-tracker

[![CI](https://github.com/eserete/opencode-token-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/eserete/opencode-token-tracker/actions/workflows/ci.yml)

Real-time token usage, cost, and latency tracking for every AI request in [OpenCode](https://opencode.ai).

---

## What it does

The plugin listens to `session.idle` events and reads the last assistant message's token data to display a toast notification in the OpenCode TUI after each AI response. It reports:

- Input and output token counts
- Reasoning tokens (when the model uses extended thinking)
- Cache read/write tokens (if your provider uses prompt caching)
- Response latency
- Per-message cost and cumulative session cost
- Model identifier
- Number of premium requests made in the session
- Finish reason (only shown when it's not a normal `end_turn`)

When the main agent spawns subagents (e.g. via the Task tool), all child session tokens are automatically aggregated into a single consolidated toast labeled `[+N subagents]`.

---

## Example output

```
[tokens] in: 45,231  |  out: 1,204  |  cache↓: 120,000  |  t: 4.2s  |  $0.0032  |  session: $0.0187  |  github-copilot/claude-sonnet-4.6  |  reqs: 3
```

With subagents:

```
[tokens] in: 98,540  |  out: 3,812  |  cache↓: 240,000  |  t: 18.6s  |  $0.0091  |  session: $0.0278  |  github-copilot/claude-sonnet-4.6  |  reqs: 7  |  [+2 subagents]
```

---

## Installation

Copy `token-tracker.js` to your OpenCode plugins directory — it loads automatically at startup.

**OpenCode prompt** (recommended — just ask OpenCode):

```
/install https://github.com/eserete/opencode-token-tracker
```

OpenCode will clone the repo and place the plugin in your plugins directory automatically.

**npm**:

```bash
npm install opencode-token-tracker
cp node_modules/opencode-token-tracker/token-tracker.js ~/.config/opencode/plugins/
```

```bash
npm install opencode-token-tracker
cp node_modules/opencode-token-tracker/token-tracker.js ~/.config/opencode/plugins/
```

**Global install** (manual):

```bash
curl -sL https://github.com/eserete/opencode-token-tracker/raw/main/token-tracker.js \
  -o ~/.config/opencode/plugins/token-tracker.js
```

**Project-only install**:

```bash
mkdir -p .opencode/plugins
cp token-tracker.js .opencode/plugins/
```

Restart OpenCode and the plugin is active.

---

## Configuration

None required. The plugin works out-of-the-box with zero configuration.

---

## Field reference

| Field | Description |
|---|---|
| `in` | Input tokens sent to the model |
| `out` | Output tokens generated |
| `think` | Reasoning tokens (extended thinking, if any) |
| `cache↓` | Cache read tokens (if any) |
| `cache↑` | Cache write tokens (if any) |
| `t` | Response latency in seconds |
| `$` | Cost for this message |
| `session` | Cumulative cost since the session started |
| model | Provider/model identifier (e.g. `github-copilot/claude-sonnet-4.6`) |
| `reqs` | Number of requests with non-zero input tokens in this session |
| `finish` | Finish reason — only shown when not `end_turn` or `tool_calls` |
| `[+N subagents]` | Number of child (subagent) sessions aggregated into this toast |

---

## Pros

- **Zero config** — drop the file in and it works
- **Subagent-aware** — automatically aggregates tokens from all child sessions spawned by the Task tool
- **Deduplication** — tracks message IDs to prevent double-counting costs across events
- **Non-intrusive** — all errors are silently swallowed; the plugin never disrupts your session
- **Reasoning tokens** — shows `think:` when the model uses extended thinking (e.g. Claude with extended thinking enabled)
- **Session reset** — counters reset on each new prompt, so `session:` always reflects the current conversation

## Cons

- For simple sessions (no subagents), only the last assistant message is shown per response — intermediate tool-call costs are not broken out individually
- Cost accuracy depends on the provider reporting token counts correctly to OpenCode
- Toast persists for 10 seconds then disappears — there is no persistent log or export
- No across-session cumulative tracking — resets when a new prompt starts

---

## License

MIT
