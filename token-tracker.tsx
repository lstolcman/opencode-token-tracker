/**
 * Token Tracker Plugin - Real-time Display (sidebar_footer slot)
 *
 * Displays live token usage, request count, and cost in the sidebar footer.
 * Updates every 2 seconds during agent execution.
 *
  * Shows two lines:
  *   last:  ↑70k ↓1.2k cache 50k (42%) cache write 1k 4.0¢ ⇅ 2.1s 58 tok/s
  *   total: ↑1.2m ↓0.3m cache 800k (40%) miss 2/12 42 reqs 123¢ ⌀⇅2.0s ⌀55 tok/s
 * Cache is always shown: last miss shows "cache: MISS" in warning (muted
 * "cache: cold" on first request), total always shows cache + "miss n/m".
 * miss n/m = requests with cache.read == 0 in last min(99, reqs).
 * Hit ratio = cache_read / (fresh input + cache_read)
 * Arrows are billing-side from your perspective: ↑ = sent to provider
 * (fresh input + cache read + cache write), ↓ = received from provider
 * (output + reasoning). Cached tokens count under ↑ (billed input-side)
 * even though never re-transmitted; cache / cache write remain as composition detail.
 * TTFT = first part start of any type - created, TPS = (output + reasoning) /
 * (completed - first start); avgs are means over requests with timing data
 * ("—" when unavailable).
 *
 * Requirements:
 *   - OpenCode v1.4.3+
 *   - tui.json must have: { "plugin": ["./plugins/token-tracker.tsx"] }
 *   - Sidebar must be open (Ctrl+X B) to see the footer
 */

/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { createMemo, createSignal, onCleanup } from "solid-js"

function TokenFooter(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current

  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick(t => t + 1), 2000)
  onCleanup(() => clearInterval(timer))

  const tokenData = createMemo(() => {
    tick()

    const state = props.api.state

    const msgs = state.session.messages(props.session_id)
    const assistantMsgs = msgs.filter((m): m is AssistantMessage =>
      m.role === "assistant" && !!m.tokens
    )

    // Totals across entire session (in = fresh input + all cached tokens,
    // out = visible output + reasoning, so headline numbers cover ALL tokens)
    const rawTotalInp = assistantMsgs.reduce((sum, m) => sum + (m.tokens.input || 0), 0)
    const totalReasoning = assistantMsgs.reduce((sum, m) => sum + (m.tokens.reasoning || 0), 0)
    const totalCacheRead = assistantMsgs.reduce((sum, m) => sum + (m.tokens.cache?.read || 0), 0)
    const totalCacheWrite = assistantMsgs.reduce((sum, m) => sum + (m.tokens.cache?.write || 0), 0)
    const totalInp = rawTotalInp + totalCacheRead + totalCacheWrite
    const totalOut = assistantMsgs.reduce((sum, m) => sum + (m.tokens.output || 0), 0) + totalReasoning
    const totalCost = assistantMsgs.reduce((sum, m) => sum + ((m as any).cost || 0), 0)
    const reqCount = assistantMsgs.filter(m => m.tokens.input > 0).length

    // Last request only (last assistant message with input tokens)
    const lastMsg = [...assistantMsgs].reverse().find(m => m.tokens.input > 0)
    const rawLastInp = lastMsg?.tokens.input || 0
    const lastReasoning = lastMsg?.tokens.reasoning || 0
    const lastCacheRead = lastMsg?.tokens.cache?.read || 0
    const lastCacheWrite = lastMsg?.tokens.cache?.write || 0
    const lastInp = rawLastInp + lastCacheRead + lastCacheWrite
    const lastOut = (lastMsg?.tokens.output || 0) + lastReasoning
    const lastCost = (lastMsg as any)?.cost || 0

    // Cache hit ratio: cached read / (fresh input + cached read)
    const lastDenom = rawLastInp + lastCacheRead
    const lastHit = lastDenom > 0 ? (lastCacheRead / lastDenom) * 100 : 0
    const totalDenom = rawTotalInp + totalCacheRead
    const totalHit = totalDenom > 0 ? (totalCacheRead / totalDenom) * 100 : 0

    // Cache misses over last 99 requests (miss = cache.read == 0)
    const reqMsgs = assistantMsgs.filter(m => m.tokens.input > 0)
    const windowMsgs = reqMsgs.slice(-99)
    const missCount = windowMsgs.filter(m => (m.tokens.cache?.read || 0) === 0).length
    const windowSize = windowMsgs.length
    const lastMiss = lastCacheRead === 0

    // Throughput per message (TTFT as in opencode-throughput, but TPS counts
    // output + reasoning so thinking models aren't under-reported):
    // TTFT = first part start of any type - created, TPS = (output + reasoning) / (completed - first start)
    const perfOf = (m: AssistantMessage) => {
      const created = (m as any).time?.created as number | undefined
      const completed = (m as any).time?.completed as number | undefined
      if (!created || !completed) return { ttft: null as number | null, tps: null as number | null, latency: null as number | null }
      const latency = completed - created
      let firstStart: number | null = null
      try {
        const parts = props.api.state.part(m.id)
        for (const p of parts) {
          // Any part type counts (text, reasoning, ...): TTFT is when the
          // first token of any kind arrived from the provider.
          const start = (p as any).time?.start as number | undefined
          if (start != null && (firstStart == null || start < firstStart)) firstStart = start
        }
      } catch { firstStart = null }
      const ttft = firstStart != null ? firstStart - created : null
      const out = (m.tokens.output || 0) + (m.tokens.reasoning || 0)
      const genMs = firstStart != null ? completed - firstStart : latency
      const tps = genMs > 0 && out > 0 ? (out / genMs) * 1000 : null
      return { ttft, tps, latency }
    }

    const lastPerf = lastMsg ? perfOf(lastMsg) : { ttft: null as number | null, tps: null as number | null, latency: null as number | null }
    const ttfts: number[] = []
    const tpss: number[] = []
    for (const m of reqMsgs) {
      const p = perfOf(m)
      if (p.ttft != null) ttfts.push(p.ttft)
      if (p.tps != null) tpss.push(p.tps)
    }
    const avgTtft = ttfts.length > 0 ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null
    const avgTps = tpss.length > 0 ? tpss.reduce((a, b) => a + b, 0) / tpss.length : null

    return { totalInp, totalOut, totalCacheRead, totalCacheWrite, totalCost, reqCount, lastInp, lastOut, lastCacheRead, lastCacheWrite, lastCost, lastHit, totalHit, lastMiss, missCount, windowSize, lastTtft: lastPerf.ttft, lastTps: lastPerf.tps, lastLatency: lastPerf.latency, avgTtft, avgTps }
  })

  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return `${n}`
  }

  const fmtCost = (n: number) => {
    const c = n * 100
    if (c >= 100) return `${c.toFixed(0)}¢`
    if (c >= 1) return `${c.toFixed(1)}¢`
    return `${c.toFixed(2)}¢`
  }

  const fmtMs = (ms: number | null) => {
    if (ms == null) return "—"
    if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${ms.toFixed(0)}ms`
  }

  const fmtTps = (tps: number | null) => {
    if (tps == null) return "—"
    if (tps >= 100) return `${tps.toFixed(0)} tok/s`
    return `${tps.toFixed(1)} tok/s`
  }

  return (
    <box>
      <text>
        <span style={{ fg: theme().textMuted }}>last:  ↑</span>
        <span style={{ fg: theme().text }}>{fmt(tokenData().lastInp)}</span>
        <span style={{ fg: theme().textMuted }}> ↓</span>
        <span style={{ fg: theme().text }}>{fmt(tokenData().lastOut)}</span>
        {tokenData().lastCacheRead > 0 ? (
          <>
            <span style={{ fg: theme().textMuted }}> cache </span>
            <span style={{ fg: theme().text }}>{fmt(tokenData().lastCacheRead)} ({tokenData().lastHit.toFixed(0)}%)</span>
          </>
        ) : tokenData().reqCount <= 1 ? (
          <>
            <span style={{ fg: theme().textMuted }}> cache: cold</span>
          </>
        ) : (
          <>
            <span style={{ fg: theme().warning }}> cache: MISS</span>
          </>
        )}
        {tokenData().lastCacheWrite > 0 ? (
          <>
            <span style={{ fg: theme().textMuted }}> cache write </span>
            <span style={{ fg: theme().text }}>{fmt(tokenData().lastCacheWrite)}</span>
          </>
        ) : null}
        {tokenData().lastCost > 0 ? (
          <>
            <span style={{ fg: theme().textMuted }}> </span>
            <span style={{ fg: theme().accent }}>{fmtCost(tokenData().lastCost)}</span>
          </>
        ) : null}
        <span style={{ fg: theme().textMuted }}> ⇅</span>
        <span style={{ fg: theme().text }}>{fmtMs(tokenData().lastTtft)}</span>
        <span style={{ fg: theme().textMuted }}> </span>
        <span style={{ fg: theme().text }}>{fmtTps(tokenData().lastTps)}</span>
      </text>
      <text>
        <span style={{ fg: theme().textMuted }}>total: ↑</span>
        <span style={{ fg: theme().text }}>{fmt(tokenData().totalInp)}</span>
        <span style={{ fg: theme().textMuted }}> ↓</span>
        <span style={{ fg: theme().text }}>{fmt(tokenData().totalOut)}</span>
        {tokenData().totalCacheRead > 0 ? (
          <>
            <span style={{ fg: theme().textMuted }}> cache </span>
            <span style={{ fg: theme().text }}>{fmt(tokenData().totalCacheRead)} ({tokenData().totalHit.toFixed(0)}%)</span>
          </>
        ) : (
          <>
            <span style={{ fg: theme().textMuted }}> cache 0 (0%)</span>
          </>
        )}
        {tokenData().reqCount > 1 && tokenData().missCount > 0 ? (
          <>
            <span style={{ fg: theme().warning }}> miss {tokenData().missCount}/{tokenData().windowSize}</span>
          </>
        ) : (
          <>
            <span style={{ fg: theme().textMuted }}> miss {tokenData().missCount}/{tokenData().windowSize}</span>
          </>
        )}
        {tokenData().totalCacheWrite > 0 ? (
          <>
            <span style={{ fg: theme().textMuted }}> cache write </span>
            <span style={{ fg: theme().text }}>{fmt(tokenData().totalCacheWrite)}</span>
          </>
        ) : null}
        <span style={{ fg: theme().textMuted }}> </span>
        <span style={{ fg: theme().text }}>{tokenData().reqCount} reqs</span>
        {tokenData().totalCost > 0 ? (
          <>
            <span style={{ fg: theme().textMuted }}> </span>
            <span style={{ fg: theme().accent }}>{fmtCost(tokenData().totalCost)}</span>
          </>
        ) : null}
        {tokenData().avgTtft != null || tokenData().avgTps != null ? (
          <>
            <span style={{ fg: theme().textMuted }}> ⌀⇅</span>
            <span style={{ fg: theme().text }}>{fmtMs(tokenData().avgTtft)}</span>
            <span style={{ fg: theme().textMuted }}> ⌀</span>
            <span style={{ fg: theme().text }}>{fmtTps(tokenData().avgTps)}</span>
          </>
        ) : null}
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    slots: {
      sidebar_footer(_ctx, props: { session_id: string }) {
        return <TokenFooter api={api} session_id={props.session_id} />
      },
    },
  })
}

export default { id: "token-tracker", tui } satisfies TuiPluginModule
