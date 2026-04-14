# opencode-token-tracker

[![CI](https://github.com/eserete/opencode-token-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/eserete/opencode-token-tracker/actions/workflows/ci.yml)

Real-time token usage, cost, and request tracking for every AI request in [OpenCode](https://opencode.ai).

---

## 🆕 TUI Version (RECOMMENDED) - `token-tracker.tsx`

Displays tokens **directly in the OpenCode sidebar footer**, in real-time during agent execution — **no popups or toasts**.

```
⏳ last:  in: 70.0k · out: 1.2k · 1 req · $0.04
📊 total: in: 1.2m  · out: 0.3m · 42 reqs · $1.23
```

When the agent finishes:

```
✓  last:  in: 70.0k · out: 1.2k · 1 req · $0.04
📊 total: in: 1.2m  · out: 0.3m · 42 reqs · $1.23
```

**Lines:**
- `⏳`/`✓` **last** — tokens and cost of the **last request** (useful to see the cost of each individual interaction)
- `📊` **total** — cumulative for the **entire session** (tokens in, out, request count, and total cost)

**Updates:** every 2 seconds during execution.

### Installation

**1. Copy the plugin:**

```bash
curl -sL https://github.com/eserete/opencode-token-tracker/raw/main/token-tracker.tsx \
  -o ~/.config/opencode/plugins/token-tracker.tsx
```

**2. Register it in `tui.json`** (`~/.config/opencode/tui.json`):

```json
{
  "$schema": "https://opencode.ai/config/tui.json",
  "plugin": ["./plugins/token-tracker.tsx"]
}
```

**3. Restart OpenCode** and open the sidebar with `Ctrl+X B`.

### Requirements

- OpenCode v1.4.3+
- Sidebar must be open (`Ctrl+X B`) for the footer to be visible

---

## Real-time Toast Version - `token-tracker-realtime.js`

Shows tokens in real-time via a toast notification during agent execution:

```
⏳ 1.2k tokens · 12 reqs · $0.05
```

**Installation:**

```bash
curl -sL https://github.com/eserete/opencode-token-tracker/raw/main/token-tracker-realtime.js \
  -o ~/.config/opencode/plugins/token-tracker-realtime.js
```

---

## Classic Version (Toast) - `token-tracker.js`

Shows a toast **after** each request completes:

```
[tokens] in: 45,231  |  out: 1,204  |  cache↓: 120,000  |  t: 4.2s  |  $0.0032  |  reqs: 3
```

**Installation:**

```bash
curl -sL https://github.com/eserete/opencode-token-tracker/raw/main/token-tracker.js \
  -o ~/.config/opencode/plugins/token-tracker.js
```

---

## Which version should I use?

| Feature | TUI Slot (tsx) | Real-time Toast | Classic |
|---------|---------------|----------------|---------|
| **Interface** | Sidebar footer | Toast/popup | Toast/popup |
| **When it shows** | Always visible | During execution | After completion |
| **Last vs Total** | ✅ Both | ❌ Total only | ✅ Per request |
| **Compatibility** | OpenCode v1.4.3+ | All versions | All versions |
| **Update frequency** | Every 2s | Every 2s | Once |

**Recommendation:** Use **`token-tracker.tsx`** (TUI) — it's the most complete and doesn't interrupt your workflow.

---

## Configuration

No additional configuration required beyond the installation steps above.

**Important:** After installing or updating, **restart OpenCode** for the plugin to be reloaded.

---

## Field Reference (Classic Version)

| Field | Description |
|---|---|
| `in` | Input tokens |
| `out` | Output tokens |
| `think` | Reasoning tokens |
| `cache↓` | Cache read tokens |
| `cache↑` | Cache write tokens |
| `t` | Latency in seconds |
| `$` | Message cost |
| `session` | Cumulative session cost |
| model | Provider/model |
| `reqs` | Number of requests |
| `finish` | Finish reason |
| `[+N subagents]` | Aggregated subagents |

---

## Features

- ✅ **Zero configuration** - copy and it works
- ✅ **No popups** - integrated display in the OpenCode UI
- ✅ **Last vs Total** - see the cost of each interaction separately from the session total
- ✅ **Subagent-aware** - aggregates tokens automatically
- ✅ **Non-intrusive** - errors are silent
- ✅ **Real-time** - track usage while the agent works

---

## Limitations

- Cost accuracy depends on the provider reporting correctly
- No persistence across sessions
- TUI version requires the sidebar to be open for the footer to appear
- Updates every 2 seconds (not instantaneous)

---

## License

MIT
