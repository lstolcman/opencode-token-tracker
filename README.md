# opencode-token-tracker

[![CI](https://github.com/eserete/opencode-token-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/eserete/opencode-token-tracker/actions/workflows/ci.yml)

Real-time token usage, cost, and request tracking for every AI request in [OpenCode](https://opencode.ai).

---

## 🆕 OpenCode 2.x Version (RECOMMENDED) - `token-tracker-v2.tsx`

Port of the TUI version to the OpenCode 2.x CLI plugin API. Renders an
aligned table in the sidebar footer — one row per metric, in three columns:
the last request, the current cache epoch, and the whole session:

```
               last   epoch   session
input           2.1k    39.8k     1.2M
output          1.2k     0.3M     0.9M
cache read      50k     800k     2.1M
cache hit     42.3%    66.7%    61.7%
miss/reqs        —       1/9     2/12
cost           4.0¢    $0.09    $0.37
↑ sent        70.0k     1.2M     3.4M
ttft           2.1s     2.0s     2.0s
tok/s            58       55       55
```

Rows are grouped by meaning: the priced buckets the provider reports, the
cache outcome derived from them, the billed cost, the overall sent total,
then latency. A `cache write` row appears only when cache was written.

**Columns:**
- `last` — the most recent request
- `epoch` — the current warm cache chain. It restarts when a request reuses much less of the previous prompt than a warm request would (under 80%), so it shows what the current cache has cost so far and what it cost to rebuild after a break. Expiry, compaction, eviction and a model switch all break the chain the same way, so the column follows the cache itself instead of guessing causes. The start of the epoch is persisted, so the column keeps showing the current cache's cost even after the break scrolls out of the loaded history. With no break seen since the plugin started (or since a reset) it equals the session column
- `session` — everything since the reset baseline, whether or not the cache was hit; a session left open for days keeps its full totals here

**Rows:**
- `input` — prompt tokens billed at the provider's input rate: prompt tokens billed fresh instead of read from cache, the complement of `cache read`. On a warm request these are just the newly appended tokens; on a rebuild they are the whole re-sent prompt
- `output` — tokens billed at the provider's output rate: output + reasoning
- `cache read` — prompt tokens served from the provider's cache, billed at its cache-read rate
- `cache write` — tokens written into the cache, shown only when non-zero. Some providers bill it, others do not; `cost` already reflects whichever applies
- `cache hit` — the hit ratio: cache_read / (input + cache_read). Ratios near 100% keep decimals (e.g. `99.98%`) so integer rounding never fakes a full hit; input can legitimately be tiny (or 0) next to a huge cache read in agentic loops
- `miss/reqs` — `n/m` = cache misses over billed top-level requests (completed assistant messages that reported usage). A miss is a request with zero cache read or one that reused less than 80% of the previous prompt (a rebuild). The session ratio covers every request loaded since the reset baseline, the epoch ratio the requests of the current cache chain (a subset). Counts stay exact below 1000 and compact to k/M above it (`3/12.4k`, `1.2k/3.4k`), dropping decimals as needed so the pair never widens its cell. The last column has no ratio for a single request, so it shows a dim dash (`—`) and a word only when there is something: `cold` (first request), `YES` (it missed) or `EXPIRED` (a warm cache went cold after a long idle — inferred, because providers report no cache state)
- `cost` — the last request in cents (`4.0¢`); the epoch and session totals in dollars with at most three digits: `$0.00`, `$12.0`, `$123`, `$1.2k`, `$12k`
- `↑ sent` — the overall quantity, not a price bucket: `input` + `cache read` + `cache write`, every billed input-side token, cached or not. Cached tokens are never re-transmitted but they are still billed, so this is the total prompt volume the provider accounted for
- `ttft` / `tok/s` — time to first token and generation rate; the last column is sampled **once every 2 seconds**, the other columns hold averages
- Live while streaming — the thinking phase included — `output`, `ttft` and `tok/s` update from the streamed reasoning/text deltas (tokens estimated as chars / 4, or real partial usage when the provider reports it early); the input-side cells (`input`, cache, `miss`, `↑ sent`, `cost`) show `…` until the provider reports usage at step end
- Session column — taken from the server's session aggregate, the same accounting the status bar shows: it includes subagent usage and hidden overhead (title generation, compaction) that per-message sums miss. `miss/reqs` and the averages are computed over top-level requests

**Pricing:**
Provider price sheets and the table use the same names, so each priced row is exactly the quantity its rate applies to:

| price sheet key | table row | what the row counts |
| --- | --- | --- |
| `input` | `input` | prompt tokens billed fresh (not served from cache) |
| `output` | `output` | output + reasoning (reasoning is billed at the output rate) |
| `cache_read` | `cache read` | prompt tokens served from the cache |
| `cache_write` | `cache write` | tokens written to the cache; shown only when non-zero, priced only by providers that charge for it |

So one request costs:

```
  input        × input rate
+ output       × output rate
+ cache read   × cache_read rate
+ cache write  × cache_write rate   (only when the provider charges it)
= cost
```

`↑ sent` is deliberately not part of that sum: it is `input + cache read + cache write`, so applying the input rate to it would overcharge every cached token. The `cost` row is the total the provider/OpenCode reports, not a recomputation from these rows.

### Installation

OpenCode 2.x local plugins must live in a **directory**, not a loose file.

**1. Copy the plugin:**

```bash
mkdir -p ~/.config/opencode/plugins/token-tracker
curl -sL https://github.com/lstolcman/opencode-token-tracker/raw/main/token-tracker-v2.tsx \
  -o ~/.config/opencode/plugins/token-tracker/tui.tsx
```

**2. Register it in `cli.json`** (`~/.config/opencode/cli.json`):

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["./plugins/token-tracker"]
}
```

**3. Open the sidebar with `Ctrl+X B`.** OpenCode 2.x hot-reloads
`cli.json` and plugin files — no restart needed.

### Resetting the counters

The table is derived from the session, so there is nothing to clear on the
server. A reset instead stores a per-session baseline:

- `/tokens-reset`, the **Reset token statistics** command in the palette
  (`Ctrl+P`), or `<leader>z` (the leader is your configured leader key)
- the session column becomes a delta from that snapshot, and the epoch
  column restarts with it
- `last`, `miss/reqs` and the averages only see requests made after it

The baseline is persisted by OpenCode's plugin storage, so it survives a TUI
restart. A reset is refused while a response is streaming, so a request never
straddles the two windows. This is useful when a prompt cache expires
overnight: reset once, and the hit ratio and miss count describe the working
window instead of the whole session.

### Requirements

- OpenCode 2.x
- Sidebar must be open (`Ctrl+X B`) for the footer to be visible

---

## Configuration

No additional configuration required beyond the installation steps above.
OpenCode 2.x hot-reloads `cli.json` and plugin files — no restart needed.

---

## Features

- ✅ **Zero configuration** - copy and it works
- ✅ **Integrated** - aligned table in the sidebar footer, no popups
- ✅ **Last, epoch and session** - per-request detail, the current warm cache chain, and full session totals
- ✅ **Cache-aware** - cache read/write, hit ratio, miss tracking, and a lapse (expired cache) label
- ✅ **Throughput** - TTFT and tok/s per request with averages
- ✅ **Real-time** - refreshes every 2 seconds, live during generation
- ✅ **Resettable** - per-session baseline via `/tokens-reset`, persisted across restarts
- ✅ **Status-bar parity** - totals come from the server's session aggregate

---

## Limitations

- Cost accuracy depends on the provider reporting correctly
- Statistics are per session; the reset baseline is persisted, but a new session starts empty
- The sidebar must be open (`Ctrl+X B`) for the table to appear
- Updates every 2 seconds (not instantaneous)
- `miss/reqs` and the averages cover top-level requests; subagent usage is only reflected in the session column via the session aggregate
- `miss/reqs`, the averages and epoch break detection only see the messages the TUI has loaded (the newest ~20, plus older pages as you scroll), so in a very long chat those counts are a lower bound; token, cost and hit-ratio totals are exact, and the epoch start is persisted once a break is seen

---

## License

MIT
