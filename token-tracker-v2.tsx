/**
 * @jsxImportSource @opentui/solid
 */

/**
 * Token Tracker — sidebar table (OpenCode V2)
 *
 * Port of https://github.com/eserete/opencode-token-tracker (token-tracker.tsx)
 * to the OpenCode V2 CLI plugin API, including the changes from
 * https://github.com/marius/opencode-token-tracker/commit/96ec0cf
 * (billing-side arrows, cache hit ratio, miss counting, cent costs,
 * TTFT and tok/s per request with session averages), rendered as an
 * aligned table instead of two dense status lines.
 *
 * Shows in the sidebar footer — one row per metric, in three columns:
 * the last request, the current cache epoch, and the whole session:
 *
 *                  last   epoch   session
 *   input          2.1k    39.8k     1.2M
 *   output         1.2k     0.3M     0.9M
 *   cache read      50k     800k     2.1M
 *   cache hit     42.3%    66.7%    61.7%
 *   miss/reqs         —      1/9     2/12
 *   sent total    70.0k     1.2M     3.4M
 *   ttft           2.1s     2.0s     2.0s
 *   tok/s            58       55       55
 *   cost           4.0¢    $0.09    $0.37
 *
 * Rows are grouped by meaning: the priced buckets the provider reports
 * (input, output, cache read), the cache outcome derived from them
 * (cache hit, miss/reqs), the overall sent total, then latency, with the
 * billed cost closing the table as the bottom line. `sent total` is a
 * quantity, not a price bucket — it is the sum of the input-side rows —
 * so it sits below the priced block instead of above it.
 *
 * A `cache write` row appears only when cache was written.
 *
 * The epoch column answers "what has the current warm cache cost so
 * far?": it accumulates the requests of one unbroken cache chain and
 * restarts whenever a request reuses much less of the previous prompt
 * than a warm request would (under 80%), or whenever the model changes.
 * A prompt cache belongs to one model — providers keep a cache per model,
 * and tokenizers measure the same text in different token counts — so a
 * switch starts a new chain even if the previous model's cache is still
 * warm. Switching back to a model can still read its earlier cache (the
 * prefix is unchanged up to the switch), which shows up in `last` and in
 * the session column, but the epoch column counts from the return. Expiry,
 * compaction and eviction break the chain the same way, so the column
 * follows the cache itself instead of classifying causes. Its start is
 * a persisted anchor, so the column keeps showing the current cache's
 * cost after the break scrolls out of the loaded history. A session left
 * open for days keeps its session totals while the epoch column shows
 * what was spent rebuilding the cache after each break. With no break
 * seen since the plugin started (or since a reset) it equals the session
 * column.
 *
 * Rows follow the provider's price sheet: input = prompt tokens billed at
 * the input rate (fresh, not served from cache), output = output +
 * reasoning (both billed at the output rate), cache read = prompt tokens
 * served from the provider's cache. cache write is a token count: some
 * providers bill it, others do not, and the cost row already reflects
 * whichever applies. `sent total` is the quantity total — input + cache
 * read + cache write, every billed input-side token, cached or not — so it
 * is a total, never a rate.
 *
 * miss/reqs n/m = cache misses over billed top-level requests: completed
 * assistant messages that reported usage (fresh input or cache read). A
 * miss is a request with cache.read == 0 or one that reused less than 80%
 * of the previous prompt (a rebuild); the session ratio covers every
 * request loaded since the reset baseline, the epoch ratio the requests of
 * the current chain (a subset). Counts stay exact below 1000 and compact
 * to k/M above it (3/12.4k, 1.2k/3.4k), dropping decimals as needed so the
 * pair never widens its cell. The last column has no ratio for a single
 * request, so it shows a dim dash (nothing to report) and a word only when
 * there is something: cold (first request) / YES (the last request missed)
 * / SWITCH (the model changed and the new one had no cache for this
 * session) / EXPIRED (a previously warm cache went cold after a long idle —
 * inferred, providers report no cache state). A switch that reads the
 * returning model's still-warm cache is a hit, not a miss.
 * cache hit = cache_read / (fresh input + cache_read), shown with adaptive
 * precision so 99.98% never rounds into a false 100%. input = prompt
 * tokens billed fresh instead of read from cache, the complement of cache
 * read: on a warm request only the newly appended content, on a rebuild
 * the re-sent prompt.
 *
 * Unit symbols (k, M, %, ¢, s, ms, $), the miss/reqs slash and row labels
 * render in a shade halfway between text.muted and text.base, so they stay
 * readable while the numbers pop.
 *
 * The session column mirrors the server's session aggregate — the same
 * accounting the status bar shows — so it also includes subagent usage
 * and hidden overhead (title generation, compaction). The epoch column
 * is the aggregate delta since its persisted anchor, so it stays exact
 * once a break has been seen. miss/reqs and the averages are computed
 * over the top-level requests loaded into the TUI, so in a very long
 * chat they are a lower bound (older messages are paged out).
 *
 * ttft = earliest content-part timestamp - created (V2 stamps no
 * first-token time: `time.streamed` is the end-of-stream stamp; text
 * parts carry no timing, so ttft shows "—" when no part timing exists).
 * tok/s = (output + reasoning) / (end - generation start), generation
 * start being the earliest part timestamp (fallback: created). The last
 * column is sampled once every 2 seconds on the refresh timer.
 *
 * While the newest message streams — the thinking phase included — the
 * last column goes live: output, ttft and tok/s update from the streamed
 * reasoning/text deltas (tokens estimated as chars / 4, or real partial
 * usage when the provider reports it early), while the input-side cells
 * (input, cache, miss, sent total, cost) show "…" until the provider reports
 * usage at step end. The epoch and session columns hold confirmed
 * numbers and averages over completed requests ("—" when unavailable).
 *
 * The footer refreshes every 2 seconds. Requires the sidebar to be
 * visible (Ctrl+X B).
 *
 * Reset: `/tokens-reset`, the "Reset token statistics" command in the
 * palette, or `<leader>z` (the leader is your configured leader key). A
 * reset stores a per-session baseline: the session column becomes a
 * delta from that snapshot, the epoch column restarts with it, and the
 * last/miss/input/averages rows only see messages created afterwards.
 * The baseline is persisted, so it survives a TUI restart; the server
 * session data is never modified.
 */

import { Plugin } from "@opencode/plugin/tui"
import { RGBA } from "@opentui/core"
import { createMemo, createSignal, onCleanup } from "solid-js"

type TokenUsage = {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

type MsgPart = {
  type?: string
  time?: { created?: number; completed?: number }
}

type AssistantMsg = {
  type?: string
  role?: string
  time?: { created?: number; streamed?: number; completed?: number }
  content?: MsgPart[]
  // The model that served the request. Prompt caches are namespaced by
  // model, so this is what makes a cache chain model-specific.
  model?: { id?: string; providerID?: string }
  tokens?: TokenUsage
  cost?: number
  finish?: string
  error?: unknown
}

// A reset snapshot. Totals before this point are subtracted from the
// session aggregate, and messages older than `at` are ignored, so the
// table counts from the reset instead of from the start of the session.
type Baseline = {
  at: number
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

// Providers expose no cache state, so a lapse is inferred: the previous
// request read from cache, the last one read almost none of it, and the
// two were further apart than any prompt cache is kept warm (5–10
// minutes for the hosted providers, longer for some). The usage numbers
// stay exact either way; only the "expired" label depends on this window.
const CACHE_LAPSE_MS = 10 * 60 * 1000

// Share of the previous prompt a request must reuse to count as warm.
// A warm request re-reads essentially the whole previous prompt from
// cache, while a rebuilt one re-sends most of it, so the ratio separates
// them cleanly. `cache.read == 0` alone is not enough: a provider that
// keeps a small shared prefix (the system prompt) still reports a few
// thousand cached tokens when the conversation part of the cache is
// gone, which is exactly what a model switch, a compaction or an evicted
// prefix looks like. The ratio only compares requests served by the same
// model: tokenizers differ, and a prompt cache is per model, so a ratio
// measured across a model switch says nothing (see isModelSwitch).
const CACHE_BREAK_RATIO = 0.8

const isIncomplete = (m: AssistantMsg | undefined) =>
  Boolean(m && m.time?.completed === undefined && !m.finish && !m.error)

const LABEL_W = 12
const COL_W = 7
// Two spaces between value columns: the widest cells ("EXPIRED",
// "99.98%") keep a visible gutter instead of touching the previous
// column.
const GAP_W = 2
// Header labels are spaced by an equal gap rather than by column width.
// Right-aligning the block keeps "last" and "session" over their column
// edges and puts "epoch" one cell left; with the old per-column padding
// the 7-char "session" label left a single space before it while "last"
// had three, which read as "epochsession".
const HEADER_GAP = 3
const TABLE_W = LABEL_W + COL_W * 3 + GAP_W * 2
const HEADER = ["last", "epoch", "session"].join(" ".repeat(HEADER_GAP))
const HEADER_PAD = " ".repeat(TABLE_W - HEADER.length)

// Request counts for the miss/reqs ratio: exact below 1000, then 1.2k /
// 12k / 1.2M. Above 1000 the pair is compacted until it fits COL_W; the
// fallback (both counts four characters, e.g. 999k/999k) can fill the whole
// epoch/session cell (COL_W + GAP_W) but never widens it, so the table stays
// aligned. The numerator (misses) keeps precision longest.
const fmtCount = (n: number, decimals: boolean) => {
  if (n < 1000) return `${n}`
  if (n >= 999_500) {
    const m = n / 1_000_000
    return decimals && m < 10 ? `${m.toFixed(1).replace(/\.0$/, "")}M` : `${m.toFixed(0)}M`
  }
  const k = n / 1000
  return decimals && k < 100 ? `${k.toFixed(1).replace(/\.0$/, "")}k` : `${k.toFixed(0)}k`
}

const fmtRatio = (n: number, m: number) => {
  const pairs: Array<[boolean, boolean]> = [
    [true, true],
    [false, true],
    [true, false],
    [false, false],
  ]
  for (const [dn, dm] of pairs) {
    const s = `${fmtCount(n, dn)}/${fmtCount(m, dm)}`
    if (s.length <= COL_W) return s
  }
  return `${fmtCount(n, false)}/${fmtCount(m, false)}`
}

function TokenFooter(props: {
  context: any
  sessionID: string
  baselines: Record<string, Baseline>
  epochs: Record<string, Baseline>
  setEpoch: (sessionID: string, snapshot: Baseline | undefined) => void
}) {
  const context = props.context
  const theme = () => context.theme ?? {}
  const baseline = () => props.baselines[props.sessionID]
  const epochAnchor = () => props.epochs[props.sessionID]

  // Theme tokens are passed to `fg` as-is (they may be strings or color
  // objects); resolve the first defined candidate.
  const color = (...candidates: any[]) => {
    for (const c of candidates) if (c !== undefined && c !== null) return c
    return undefined
  }
  const muted = () => color(theme().text?.muted, theme().textMuted)
  const base = () => color(theme().text?.base, theme().text)
  const accent = () => color(theme().accent, theme().text?.action?.primary?.base, base())
  const warning = () => color(theme().warning, theme().text?.error, theme().danger, muted())

  // Shade halfway between text.muted and text.base: walk the theme's own
  // hue scale to the midpoint of the two steps (scales are monotonic per
  // mode, so the midpoint is the visual halfway in any theme); fall back
  // to blending the RGBA channels, then to muted itself.
  const soft = createMemo<any>(() => {
    const t = theme() as any
    const muted = t?.text?.muted
    const base = t?.text?.base
    try {
      const from = t?.source?.(muted)
      const to = t?.source?.(base)
      if (from && to && from.hue === to.hue && t.hue?.[from.hue]) {
        const mid = Math.round((Number(from.step) + Number(to.step)) / 2)
        const blended = t.hue[from.hue][mid as number]
        if (blended) return blended
      }
    } catch {}
    try {
      const channels = (c: any) =>
        typeof c?.r === "number" && typeof c?.g === "number" && typeof c?.b === "number"
          ? [c.r, c.g, c.b, typeof c.a === "number" ? c.a : 1]
          : undefined
      const a = channels(muted)
      const b = channels(base)
      if (a && b) {
        const mixed = a.map((v, i) => (i === 3 ? a[3] : v + (b[i] - v) * 0.5))
        return RGBA.fromInts(mixed[0] as number, mixed[1] as number, mixed[2] as number, mixed[3] as number)
      }
    } catch {}
    return muted
  })

  // Earliest content-part timestamp: the closest first-token signal V2
  // exposes. Null when no part carries timing (e.g. text-only messages).
  const firstTokenOf = (m: AssistantMsg): number | null => {
    let firstStart: number | null = null
    for (const p of m.content ?? []) {
      const start = p?.time?.created
      if (start != null && (firstStart == null || start < firstStart)) firstStart = start
    }
    return firstStart
  }

  // Throughput of one assistant message. `time.streamed` is NOT used: it
  // is the end-of-stream stamp, not the first token. ttft = firstToken -
  // created ("—" without part timing). tok/s = (output + reasoning) /
  // (end - generation start), generation start being the first token when
  // known, else `created`; for an in-progress message the end is `now`,
  // which makes the rate live.
  const perfOf = (m: AssistantMsg | undefined, now?: number) => {
    const created = m?.time?.created
    if (!created) return { ttft: null as number | null, tps: null as number | null }
    const firstToken = firstTokenOf(m)
    const ttft = firstToken != null ? Math.max(0, firstToken - created) : null
    const genStart = firstToken ?? created
    const completed = m.time?.completed
    const out = (m.tokens?.output || 0) + (m.tokens?.reasoning || 0)
    const end = completed ?? now
    if (end == null) return { ttft, tps: null as number | null }
    const genMs = end - genStart
    const tps = genMs > 0 && out > 0 ? (out / genMs) * 1000 : null
    return { ttft, tps }
  }

  // Sums over a list of requests. The message-side fallback, the epoch
  // column and the averages all count through here, so they agree.
  const sumsOf = (ms: AssistantMsg[]) => {
    const input = ms.reduce((s, m) => s + (m.tokens?.input || 0), 0)
    const cacheRead = ms.reduce((s, m) => s + (m.tokens?.cache?.read || 0), 0)
    const cacheWrite = ms.reduce((s, m) => s + (m.tokens?.cache?.write || 0), 0)
    const output = ms.reduce((s, m) => s + (m.tokens?.output || 0), 0)
    const reasoning = ms.reduce((s, m) => s + (m.tokens?.reasoning || 0), 0)
    const cost = ms.reduce((s, m) => s + (m.cost || 0), 0)
    return {
      input,
      cacheRead,
      cacheWrite,
      output,
      reasoning,
      out: output + reasoning,
      cost,
      reqs: ms.length,
    }
  }

  // Warm or rebuilt: how much of the previous prompt this request reused.
  // A warm request re-reads essentially all of it; a break re-sends most
  // of it. Shared by the epoch column, the miss count and the lapse label
  // so all three agree on what a cache break is within one model.
  const isWarmAfter = (prev: AssistantMsg | undefined, cur: AssistantMsg) => {
    const prevPrompt = (prev?.tokens?.input || 0) + (prev?.tokens?.cache?.read || 0)
    if (prevPrompt <= 0) return false
    return (cur.tokens?.cache?.read || 0) >= prevPrompt * CACHE_BREAK_RATIO
  }
  // Requests are keyed by the model that served them: providers keep a
  // cache per model, and different tokenizers measure the same prompt in
  // different token counts. An empty key (an older row without model
  // metadata) never counts as a switch, so the ratio fallback still works.
  const modelKey = (m: AssistantMsg | undefined) =>
    m?.model ? `${m.model.providerID ?? ""}/${m.model.id ?? ""}` : ""
  const isModelSwitch = (prev: AssistantMsg | undefined, cur: AssistantMsg) => {
    const before = modelKey(prev)
    const after = modelKey(cur)
    return before !== "" && after !== "" && before !== after
  }
  // A break is only meaningful when there was a warm chain to break: a
  // provider that reports no cache read at all never breaks, it simply
  // never caches. A model switch is never a ratio break: the cache for
  // the new model is a different cache, so the previous prompt's size is
  // the wrong denominator. A cold switch is still a miss through
  // cache.read == 0.
  const isBreakAfter = (prev: AssistantMsg | undefined, cur: AssistantMsg) =>
    (prev?.tokens?.cache?.read || 0) > 0 &&
    !isModelSwitch(prev, cur) &&
    !isWarmAfter(prev, cur)
  // A request starts a new cache chain when the model changes (a new cache
  // namespace, even when the previous model's cache is still warm) or when
  // it rebuilt the same model's warm chain. The epoch column restarts on
  // either boundary.
  const startsChain = (prev: AssistantMsg | undefined, cur: AssistantMsg) =>
    isModelSwitch(prev, cur) || isBreakAfter(prev, cur)

  // Two anchors describe the same cache state. The aggregate and the
  // message list update independently, so a freshly reconstructed anchor
  // is only final once both agree; comparing keeps the store write-free
  // after that point.
  const sameBaseline = (a: Baseline, b: Baseline) =>
    a.at === b.at &&
    Math.abs(a.cost - b.cost) < 1e-9 &&
    a.input === b.input &&
    a.output === b.output &&
    a.reasoning === b.reasoning &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite

  // Averages over requests with timing data (completed requests only: an
  // in-progress message has no end time, so perfOf yields null).
  const avgPerf = (ms: AssistantMsg[]) => {
    const ttfts: number[] = []
    const tpss: number[] = []
    for (const m of ms) {
      const p = perfOf(m)
      if (p.ttft != null) ttfts.push(p.ttft)
      if (p.tps != null) tpss.push(p.tps)
    }
    return {
      ttft: ttfts.length > 0 ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null,
      tps: tpss.length > 0 ? tpss.reduce((a, b) => a + b, 0) / tpss.length : null,
    }
  }
  // Live tracking of the in-flight response: streamed text and reasoning
  // deltas accumulate characters so the table can move during the
  // thinking phase, before the provider reports usage (tokens estimated
  // as chars / 4). Reset whenever a new assistant message starts.
  let liveState: { id: string; startedAt: number; chars: number } | undefined
  const trackDelta = (event: any) => {
    try {
      const data = event?.data
      if (!data || data.sessionID !== props.sessionID) return
      const len = (data.delta ?? "").length
      const id = data.assistantMessageID
      if (!len || !id) return
      if (!liveState || liveState.id !== id) {
        liveState = { id, startedAt: event.created ?? Date.now(), chars: len }
        return
      }
      liveState = { ...liveState, chars: liveState.chars + len }
    } catch {}
  }
  const deltaUnsubscribers = [
    context.data.on("session.text.delta", trackDelta),
    context.data.on("session.reasoning.delta", trackDelta),
  ]
  onCleanup(() => deltaUnsubscribers.forEach((off) => off?.()))

  // The footer recomputes on this 2 s timer (plus reactively when session
  // data changes). The last-column ttft/tok-s pair is deliberately
  // refreshed only by the timer, so tok/s updates exactly once every 2 s:
  // live while the newest message streams (thinking included), final once
  // it completes.
  const [tick, setTick] = createSignal(0)
  const [lastPerf, setLastPerf] = createSignal<{ ttft: number | null; tps: number | null }>({
    ttft: null,
    tps: null,
  })

  // Completed top-level requests since the reset baseline, oldest first.
  // The epoch tracker and the table both need this list; the TUI only
  // holds the newest messages, so it never sees the whole transcript.
  const requestsOf = () => {
    const base = baseline()
    return ((context.data.session.message.list(props.sessionID) ?? []) as AssistantMsg[])
      .filter((m) => m.type === "assistant" || m.role === "assistant")
      .filter(
        (m) =>
          (m.tokens?.input || 0) + (m.tokens?.cache?.read || 0) > 0 &&
          m.time?.completed !== undefined &&
          (!base || (m.time?.created ?? 0) > base.at),
      )
      .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
  }

  // Move the epoch anchor to the newest chain boundary: a rebuilt cache or
  // a model switch (a new cache namespace). The anchor is a snapshot of the
  // session aggregate taken just before the request that started the chain,
  // so the epoch column is the aggregate delta since then: exact,
  // independent of how much history the transcript holds, and persisted like
  // the reset baseline. It is reconstructed as aggregate minus the requests
  // of the new epoch. The aggregate and the message list update
  // asynchronously, so a snapshot that would go negative is skipped and
  // retried, and one for the same break is refreshed until both sources
  // agree — otherwise a stale aggregate would freeze the epoch at the whole
  // session.
  const syncEpoch = () => {
    const msgs = requestsOf()
    let start = -1
    for (let i = 1; i < msgs.length; i++) {
      if (startsChain(msgs[i - 1], msgs[i])) start = i
    }
    if (start < 0) return
    const at = msgs[start]?.time?.created ?? 0
    if (!at) return
    const existing = epochAnchor()
    if (existing && existing.at > at) return
    const session = context.data.session.get(props.sessionID) as
      | { cost?: number; tokens?: TokenUsage }
      | undefined
    const agg = session?.tokens
    if (!agg || typeof session?.cost !== "number") return
    const spent = sumsOf(msgs.slice(start))
    const snapshot: Baseline = {
      at,
      cost: session.cost - spent.cost,
      input: (agg.input || 0) - spent.input,
      output: (agg.output || 0) - spent.output,
      reasoning: (agg.reasoning || 0) - spent.reasoning,
      cacheRead: (agg.cache?.read || 0) - spent.cacheRead,
      cacheWrite: (agg.cache?.write || 0) - spent.cacheWrite,
    }
    const covered =
      snapshot.cost >= -1e-9 &&
      snapshot.input >= 0 &&
      snapshot.output >= 0 &&
      snapshot.reasoning >= 0 &&
      snapshot.cacheRead >= 0 &&
      snapshot.cacheWrite >= 0
    if (!covered) return
    if (existing && sameBaseline(existing, snapshot)) return
    props.setEpoch(props.sessionID, snapshot)
  }

  const refresh = () => {
    try {
      setTick((t) => t + 1)
      syncEpoch()
      const base = baseline()
      const msgs = (context.data.session.message.list(props.sessionID) ??
        []) as AssistantMsg[]
      const newest = msgs
        .filter((m) => m.type === "assistant" || m.role === "assistant")
        // After a reset the previous requests no longer own the last
        // column: with no message in the new window it reads "—".
        .filter((m) => !base || (m.time?.created ?? 0) > base.at)
        .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
        .at(-1)
      if (isIncomplete(newest)) {
        // Streaming (thinking included): prefer real partial usage when
        // the provider reports it early, else estimate from deltas.
        const now = Date.now()
        const realOut = (newest!.tokens?.output || 0) + (newest!.tokens?.reasoning || 0)
        const firstToken = firstTokenOf(newest!)
        const streamStart =
          firstToken ?? (liveState && liveState.id === newest!.id ? liveState.startedAt : null)
        const ttft =
          streamStart != null && newest!.time?.created
            ? Math.max(0, streamStart - newest!.time.created)
            : null
        const estimated =
          liveState && liveState.id === newest!.id ? Math.round(liveState.chars / 4) : 0
        const out = realOut > 0 ? realOut : estimated
        const tps =
          streamStart != null && out > 0 && now > streamStart
            ? (out / (now - streamStart)) * 1000
            : null
        setLastPerf({ ttft, tps })
        return
      }
      liveState = undefined
      setLastPerf(perfOf(newest, Date.now()))
    } catch {
      // Never let a sampling error kill the timer.
    }
  }

  const timer = setInterval(refresh, 2000)
  onCleanup(() => clearInterval(timer))
  // Prime immediately so the row is not "—" for the first 2 s.
  refresh()

  const stats = createMemo(() => {
    tick()

    // Server-side session aggregate — the same accounting the status bar
    // shows. It rolls up subagent sessions and hidden overhead (title
    // generation, compaction) that per-message sums miss, so prefer it;
    // message sums stay as fallback.
    const session = context.data.session.get(props.sessionID) as
      | { cost?: number; tokens?: TokenUsage }
      | undefined
    const agg = session?.tokens

    const msgs = (context.data.session.message.list(props.sessionID) ??
      []) as AssistantMsg[]
    const allAssistant = msgs
      .filter((m) => m.type === "assistant" || m.role === "assistant")
      .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
    // Reset baseline: messages older than the snapshot belong to the
    // previous window and are ignored (the aggregate totals are reduced
    // by the snapshot below instead).
    const base = baseline()
    const windowMsgs = base
      ? allAssistant.filter((m) => (m.time?.created ?? 0) > base.at)
      : allAssistant
    const assistantMsgs = windowMsgs.filter((m) => m.tokens)
    const sortedMsgs = assistantMsgs

    // Live phase: the newest assistant message may still be streaming
    // (thinking included). Provider usage lands at step end, so mid-
    // flight received tokens are estimated from the streamed deltas.
    const newestAll = windowMsgs.at(-1)
    const generating = isIncomplete(newestAll)
    const live =
      generating && liveState && newestAll && liveState.id === newestAll.id ? liveState : undefined
    const partialOut = newestAll
      ? (newestAll.tokens?.output || 0) + (newestAll.tokens?.reasoning || 0)
      : 0
    const liveOut = generating
      ? partialOut > 0
        ? partialOut
        : live
          ? Math.round(live.chars / 4)
          : null
      : null

    // Message sums over top-level requests — the fallback when the
    // aggregate is not (yet) available.
    const msgSums = sumsOf(sortedMsgs)
    const rawTotalInp = msgSums.input
    const msgOut = msgSums.out
    const msgCacheRead = msgSums.cacheRead
    const msgCacheWrite = msgSums.cacheWrite
    const msgCost = msgSums.cost

    // Billing-side totals: input = fresh input, output = output +
    // reasoning, sent total = input + cache read + cache write, so headline
    // numbers cover ALL tokens. A reset subtracts its snapshot, so the
    // session column counts from the reset instead of the whole session.
    const since = (current: number, was: number | undefined) =>
      Math.max(0, current - (was ?? 0))
    const totalCacheRead =
      agg?.cache?.read != null ? since(agg.cache.read, base?.cacheRead) : msgCacheRead
    const totalCacheWrite =
      agg?.cache?.write != null ? since(agg.cache.write, base?.cacheWrite) : msgCacheWrite
    const freshTotal = agg?.input != null ? since(agg.input, base?.input) : rawTotalInp
    const totalInp = freshTotal + totalCacheRead + totalCacheWrite
    const totalOut = agg
      ? since(
          (agg.output || 0) + (agg.reasoning || 0),
          base ? (base.output || 0) + (base.reasoning || 0) : 0,
        )
      : msgOut
    const totalCost =
      typeof session?.cost === "number" ? since(session.cost, base?.cost) : msgCost

    // A request is any billed assistant message: fresh input or cache
    // read. Providers may report fresh input 0 when the whole prompt hit
    // cache — such a request still counts.
    const allReqMsgs = allAssistant.filter(
      (m) =>
        (m.tokens?.input || 0) + (m.tokens?.cache?.read || 0) > 0 &&
        m.time?.completed !== undefined,
    )
    // A request is a miss when it reused nothing at all, or when it broke
    // a warm chain by reusing much less of the previous prompt than a
    // warm request would (see CACHE_BREAK_RATIO). The first one in view
    // has no predecessor here, so it only counts when it read nothing.
    const missFlags = allReqMsgs.map((m, i) => {
      if ((m.tokens?.cache?.read || 0) === 0) return true
      return i > 0 && isBreakAfter(allReqMsgs[i - 1], m)
    })
    // The epoch anchor records a rebuild even when the loaded window
    // starts with it and there is no predecessor to compare against. Mark
    // that request explicitly so the session ratio counts the same break
    // as the epoch ratio. A model switch also anchors a new chain, but it
    // is only a miss when the new model served no cache at all: a switch
    // back to a model whose cache is still warm is a hit, not a rebuild.
    const anchor = epochAnchor()
    const anchorIdx = anchor
      ? allReqMsgs.findIndex((m) => (m.time?.created ?? 0) === anchor.at)
      : -1
    const anchorReq = anchorIdx >= 0 ? allReqMsgs[anchorIdx] : undefined
    const anchorPrev = anchorIdx > 0 ? allReqMsgs[anchorIdx - 1] : undefined
    const anchorMiss =
      !anchorReq ||
      !isModelSwitch(anchorPrev, anchorReq) ||
      (anchorReq.tokens?.cache?.read || 0) === 0
    if (anchorIdx >= 0 && anchorMiss) missFlags[anchorIdx] = true
    // A reset hides the requests before its snapshot but not their cache
    // state, so the flags stay anchored on the full list.
    const reqStart = base ? allReqMsgs.findIndex((m) => (m.time?.created ?? 0) > base.at) : 0
    const reqMsgs = reqStart < 0 ? [] : allReqMsgs.slice(reqStart)
    const reqCount = reqMsgs.length

    // Last request only (last assistant message with input tokens)
    const lastMsg = reqMsgs[reqCount - 1]
    const rawLastInp = lastMsg?.tokens?.input || 0
    const lastCacheRead = lastMsg?.tokens?.cache?.read || 0
    const lastCacheWrite = lastMsg?.tokens?.cache?.write || 0
    const lastInp = rawLastInp + lastCacheRead + lastCacheWrite
    const lastOut = (lastMsg?.tokens?.output || 0) + (lastMsg?.tokens?.reasoning || 0)
    const lastCost = lastMsg?.cost || 0
    const lastBreak = reqCount > 0 ? missFlags[reqStart + reqCount - 1] : false

    // Cache lapse (expired/evicted): the previous request read from cache,
    // the last one rebuilt it, and they were further apart than a prompt
    // cache stays warm. The previous request may predate a reset — the
    // cache is provider state and does not reset with the table. Providers
    // report no cache state, so this is an inference, not a provider fact.
    const lastIdx = reqCount > 0 ? reqStart + reqCount - 1 : -1
    const prevMsg = lastIdx > 0 ? allReqMsgs[lastIdx - 1] : undefined
    // The last request started a new cache namespace: a cold result here is
    // a model switch, not an expired or evicted cache.
    const lastSwitch = lastMsg ? isModelSwitch(prevMsg, lastMsg) : false
    const prevEnd = prevMsg?.time?.completed ?? prevMsg?.time?.streamed ?? 0
    const lastEnd = lastMsg?.time?.completed ?? lastMsg?.time?.streamed ?? 0
    const idleMs = lastEnd > prevEnd ? lastEnd - prevEnd : 0
    const lapsed =
      lastBreak && (prevMsg?.tokens?.cache?.read || 0) > 0 && idleMs > CACHE_LAPSE_MS

    // Cache hit ratio: cache read / (fresh input + cache read)
    const lastDenom = rawLastInp + lastCacheRead
    const lastHit = lastDenom > 0 ? (lastCacheRead / lastDenom) * 100 : 0
    const totalDenom = freshTotal + totalCacheRead
    const totalHit = totalDenom > 0 ? (totalCacheRead / totalDenom) * 100 : 0

    // Cache misses over every request loaded since the reset baseline, so
    // the session ratio always covers the epoch ratio (the epoch is a
    // subset of the session). A fixed recent window could drop the epoch's
    // own rebuild while the epoch column still counted it.
    const missWindow = missFlags.slice(reqStart < 0 ? missFlags.length : reqStart)
    const missCount = missWindow.filter(Boolean).length

    // Epoch: the current warm cache chain. Its anchor is set by the epoch
    // tracker at the newest break, so this column is the aggregate delta
    // since the cache was last rebuilt — the tokens and cost that rebuild
    // took included. Requests older than the anchor belong to the previous
    // chain; once the break scrolls out of the loaded window every visible
    // request belongs to the epoch, and the delta still covers the ones
    // that are gone (only the counts become a lower bound). Without an
    // anchor the cache has not broken in view, and the epoch column equals
    // the session column.
    const anchorActive = !!anchor && (!base || anchor.at >= base.at)
    const epochMsgs = anchorActive
      ? allReqMsgs.filter((m) => (m.time?.created ?? 0) >= anchor!.at)
      : []
    const epochSums = anchorActive ? sumsOf(epochMsgs) : null
    const epochAvg = anchorActive ? avgPerf(epochMsgs) : null
    // The first request of an epoch is the one that rebuilt the cache, so
    // it is a miss even though its predecessor is outside this list. Once
    // the break has scrolled out, the first visible request is a warm one
    // in the middle of the epoch and is counted normally.
    const epochMisses = epochMsgs.filter(
      (m, i) =>
        (m.tokens?.cache?.read || 0) === 0 ||
        (i === 0 && m.time?.created === anchor?.at && anchorMiss) ||
        (i > 0 && isBreakAfter(epochMsgs[i - 1], m)),
    ).length
    const sessionAvg = avgPerf(reqMsgs)
    const avgTtft = sessionAvg.ttft
    const avgTps = sessionAvg.tps
    const epochFresh = epochSums
      ? agg?.input != null
        ? since(agg.input, anchor!.input)
        : epochSums.input
      : 0
    const epochRead = epochSums
      ? agg?.cache?.read != null
        ? since(agg.cache.read, anchor!.cacheRead)
        : epochSums.cacheRead
      : 0
    const epochWrite = epochSums
      ? agg?.cache?.write != null
        ? since(agg.cache.write, anchor!.cacheWrite)
        : epochSums.cacheWrite
      : 0
    const epochOut = epochSums
      ? agg
        ? since(
            (agg.output || 0) + (agg.reasoning || 0),
            (anchor!.output || 0) + (anchor!.reasoning || 0),
          )
        : epochSums.out
      : 0
    const epochCost = epochSums
      ? typeof session?.cost === "number"
        ? since(session.cost, anchor!.cost)
        : epochSums.cost
      : 0
    const epochDenom = epochFresh + epochRead
    // Same shape as the session column, so the rows render identically.
    const epochCol = epochSums
      ? {
          inp: epochFresh + epochRead + epochWrite,
          out: epochOut,
          read: epochRead,
          write: epochWrite,
          cost: epochCost,
          hit: epochDenom > 0 ? (epochRead / epochDenom) * 100 : 0,
          fresh: epochFresh,
          miss: fmtRatio(epochMisses, epochSums.reqs),
          ttft: epochAvg?.ttft ?? null,
          tps: epochAvg?.tps ?? null,
        }
      : {
          inp: totalInp,
          out: totalOut,
          read: totalCacheRead,
          write: totalCacheWrite,
          cost: totalCost,
          hit: totalHit,
          fresh: freshTotal,
          miss: fmtRatio(missCount, reqCount),
          ttft: avgTtft,
          tps: avgTps,
        }

    return {
      totalInp,
      totalOut,
      totalCacheRead,
      totalCacheWrite,
      totalCost,
      freshTotal,
      reqCount,
      miss: fmtRatio(missCount, reqCount),
      pending: generating,
      liveOut,
      lastInp,
      lastFresh: rawLastInp,
      lastOut,
      lastCacheRead,
      lastCacheWrite,
      lastCost,
      lastHit,
      totalHit,
      lastBreak,
      lastSwitch,
      lapsed,
      avgTtft,
      avgTps,
      epochCol,
    }
  })

  // Scale suffixes: k (thousands) and M (millions) only — capital M so
  // millions never read as milli. Larger values keep counting in M
  // (1.2B tokens shows as 1200.0M).
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return `${n}`
  }

  const fmtCost = (n: number) => {
    const c = n * 100
    if (c >= 100) return `${c.toFixed(0)}¢`
    if (c >= 1) return `${c.toFixed(1)}¢`
    return `${c.toFixed(2)}¢`
  }

  // Session and epoch cost in dollars, with at most three numeric
  // characters so the cell never outgrows its width and a zero total does
  // not grow a tail of zeros: $0.00, $12.0, $123, $1.2k, $12k, $1.2M.
  // The thresholds sit just below the rounding boundary, so a value that
  // would round into the next form (99.99 -> $100, 999.9 -> $1.0k)
  // switches instead of printing a fourth digit.
  const fmtCostTotal = (n: number) => {
    if (n >= 999_500) {
      const m = n / 1_000_000
      return m >= 10 ? `$${m.toFixed(0)}M` : `$${m.toFixed(1)}M`
    }
    if (n >= 999.5) {
      const k = n / 1000
      return k >= 10 ? `$${k.toFixed(0)}k` : `$${k.toFixed(1)}k`
    }
    if (n >= 99.95) return `$${n.toFixed(0)}`
    if (n >= 9.995) return `$${n.toFixed(1)}`
    return `$${n.toFixed(2)}`
  }

  const fmtMs = (ms: number | null) => {
    if (ms == null) return "—"
    if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${ms.toFixed(0)}ms`
  }

  // Percentage with adaptive precision: integer rounding would display a
  // false "100%" for real ratios like 99.98% (tiny fresh input, huge
  // cache read — normal in agentic loops).
  const fmtPct = (pct: number) => {
    if (pct >= 100) return "100%"
    // A true 100% is fresh input 0; anything below stays below 100 even
    // after rounding, so a near-full hit never displays as a full one.
    if (pct >= 99.995) return "99.99%"
    if (pct >= 99.95) return `${pct.toFixed(2)}%`
    if (pct >= 99) return `${pct.toFixed(1)}%`
    return `${pct.toFixed(0)}%`
  }

  // Bare number for the table's tok/s row (the label is the row name).
  const fmtTpsNum = (tps: number | null) => {
    if (tps == null) return "—"
    if (tps >= 100) return tps.toFixed(0)
    return tps.toFixed(1)
  }

  // Split a formatted value into digit runs and the unit text between them,
  // so units render one shade darker than the digits ("70.0k" -> "70.0" +
  // "k", "1.2k/3.4k" -> "1.2" + "k/" + "3.4" + "k"). A value with no digits
  // at all ("—", "cold") has nothing to shade and keeps the cell's tone.
  const valueRuns = (s: string) => {
    const runs: Array<{ text: string; num: boolean }> = []
    const re = /[0-9][0-9.,]*/g
    let last = 0
    for (let m = re.exec(s); m; m = re.exec(s)) {
      if (m.index > last) runs.push({ text: s.slice(last, m.index), num: false })
      runs.push({ text: m[0], num: true })
      last = m.index + m[0].length
    }
    if (last < s.length) runs.push({ text: s.slice(last), num: false })
    return runs
  }

  const rows = createMemo(() => {
    const s = stats()
    const e = s.epochCol
    const lp = lastPerf()
    // An undefined last cell means the value cannot be known yet —
    // rendered as "…" while the request is still in flight.
    const mk = (
      label: string,
      last: string | undefined,
      epoch: string,
      session: string,
      kind = "base",
      lastTone?: "soft",
    ) => ({
      label,
      last: last ?? "…",
      epoch,
      session,
      kind,
      lastTone,
    })

    // Last-column miss verdict: a dim dash, because the row has no ratio
    // for a single request. A word appears only when there is something
    // to report. A model switch is the certain cause when it was also the
    // break: unlike expiry, it is not inferred from an idle gap.
    const missVerdict = s.pending
      ? undefined
      : s.lastBreak && s.lastSwitch
        ? "SWITCH"
        : s.lapsed
          ? "EXPIRED"
          : s.reqCount <= 1
            ? "cold"
            : s.lastBreak
              ? "YES"
              : "—"

    // Rows are grouped by meaning: the priced buckets the provider
    // reports (input, output, cache read, then cache write when it was
    // written), the cache outcome derived from them (cache hit,
    // miss/reqs), the overall sent total, then latency. sent total =
    // input + cache read + cache write, so it is a quantity total rather
    // than a price bucket and stays out of the priced block. cost closes
    // the table as the bottom line those rows add up to.
    const list = [
      mk(
        "input",
        s.pending ? undefined : fmt(s.lastFresh),
        fmt(e.fresh),
        fmt(s.freshTotal),
      ),
      mk(
        "output",
        s.pending ? (s.liveOut != null ? fmt(s.liveOut) : undefined) : fmt(s.lastOut),
        fmt(e.out),
        fmt(s.totalOut),
      ),
      mk(
        "cache read",
        s.pending ? undefined : fmt(s.lastCacheRead),
        fmt(e.read),
        fmt(s.totalCacheRead),
      ),
    ]
    if (s.totalCacheWrite > 0 || s.lastCacheWrite > 0) {
      list.push(
        mk(
          "cache write",
          s.pending ? undefined : fmt(s.lastCacheWrite),
          fmt(e.write),
          fmt(s.totalCacheWrite),
        ),
      )
    }
    list.push(
      mk(
        "cache hit",
        s.pending ? undefined : fmtPct(s.lastHit),
        fmtPct(e.hit),
        fmtPct(s.totalHit),
      ),
      mk(
        "miss/reqs",
        missVerdict,
        e.miss,
        s.miss,
        !s.pending && s.lastBreak && s.reqCount > 1 ? "warning" : "base",
        missVerdict === "—" ? "soft" : undefined,
      ),
      mk("sent total", s.pending ? undefined : fmt(s.lastInp), fmt(e.inp), fmt(s.totalInp)),
      mk("ttft", fmtMs(lp.ttft), fmtMs(e.ttft), fmtMs(s.avgTtft)),
      mk("tok/s", fmtTpsNum(lp.tps), fmtTpsNum(e.tps), fmtTpsNum(s.avgTps)),
      // The billed cost closes the table: it is the outcome of every row
      // above it, so it reads as the bottom line rather than as one more
      // bucket between them.
      mk(
        "cost",
        s.pending ? undefined : fmtCost(s.lastCost),
        fmtCostTotal(e.cost),
        fmtCostTotal(s.totalCost),
        "accent",
      ),
    )
    return list
  })

  return (
    <box>
      <text>
        <span style={{ fg: soft() }}>{HEADER_PAD + HEADER}</span>
      </text>
      {rows().map((r) => {
        const valueColor =
          r.kind === "warning" ? warning() : r.kind === "accent" ? accent() : base()
        const cell = (raw: string, width: number, tone = valueColor) => {
          // A missing value renders as the unavailable dash: one absent
          // field must not take the whole footer out of the sidebar.
          const value = typeof raw === "string" ? raw : "—"
          const pad = " ".repeat(Math.max(0, width - value.length))
          const runs = valueRuns(value)
          const shaded = runs.some((run) => run.num)
          return (
            <>
              {pad}
              {shaded ? (
                runs.map((run) => <span style={{ fg: run.num ? tone : soft() }}>{run.text}</span>)
              ) : (
                <span style={{ fg: tone }}>{value}</span>
              )}
            </>
          )
        }
        return (
          <text>
            <span style={{ fg: soft() }}>{r.label.padEnd(LABEL_W)}</span>
            {cell(r.last, COL_W, r.lastTone === "soft" ? soft() : valueColor)}
            {cell(r.epoch, COL_W + GAP_W)}
            {cell(r.session, COL_W + GAP_W)}
          </text>
        )
      })}
    </box>
  )
}

export default Plugin.define({
  id: "token-tracker",
  setup(context) {
    // Reset baselines, one per session, persisted across restarts so a
    // reset survives a TUI relaunch (the session aggregate itself keeps
    // growing on the server — the baseline is a display window, not a
    // data deletion).
    const [baselines, updateBaselines] = context.storage.store<Record<string, Baseline>>(
      "baselines",
      { initial: {} },
    )

    // Epoch anchors, one per session: the session aggregate as it stood
    // just before the cache was last rebuilt. Persisted for the same
    // reason as the reset baseline — the cache is provider state that
    // outlives the TUI, so the epoch must survive a relaunch too.
    const [epochs, updateEpochs] = context.storage.store<Record<string, Baseline>>("epochs", {
      initial: {},
    })
    const setEpoch = (sessionID: string, snapshot: Baseline | undefined) => {
      void updateEpochs((draft) => {
        if (snapshot) draft[sessionID] = snapshot
        else delete draft[sessionID]
      })
    }

    const reset = (sessionID: string) => {
      const session = context.data.session.get(sessionID) as
        | { cost?: number; tokens?: TokenUsage }
        | undefined
      const msgs = (context.data.session.message.list(sessionID) ?? []) as AssistantMsg[]
      const assistant = msgs
        .filter((m) => m.type === "assistant" || m.role === "assistant")
        .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
      // A mid-flight step would land half in the old window and half in
      // the new one; wait for it instead.
      if (isIncomplete(assistant.at(-1))) {
        context.ui.toast.show({
          message: "Wait for the current response to finish, then reset",
          variant: "warning",
        })
        return
      }
      const agg = session?.tokens
      const billed = assistant.filter((m) => m.tokens)
      const sum = (pick: (m: AssistantMsg) => number) =>
        billed.reduce((total, m) => total + pick(m), 0)
      // Anchor the window on the server's own timestamp of the newest
      // message rather than the local clock, so a TUI connected to a
      // remote server with clock skew still splits the windows correctly.
      const anchor = assistant.at(-1)?.time?.created ?? 0
      const snapshot: Baseline = {
        at: anchor,
        cost: typeof session?.cost === "number" ? session.cost : sum((m) => m.cost || 0),
        input: agg?.input ?? sum((m) => m.tokens?.input || 0),
        output: agg?.output ?? sum((m) => m.tokens?.output || 0),
        reasoning: agg?.reasoning ?? sum((m) => m.tokens?.reasoning || 0),
        cacheRead: agg?.cache?.read ?? sum((m) => m.tokens?.cache?.read || 0),
        cacheWrite: agg?.cache?.write ?? sum((m) => m.tokens?.cache?.write || 0),
      }
      void updateBaselines((draft) => {
        draft[sessionID] = snapshot
      })
      // A reset starts a new working window, so the epoch restarts with
      // it: until the cache breaks again the two columns agree.
      setEpoch(sessionID, undefined)
      context.ui.toast.show({
        message: "Token statistics reset — the table now counts from here",
        variant: "success",
      })
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "token-tracker.reset",
          title: "Reset token statistics",
          description: "Start the sidebar token table from the current session totals",
          group: "Token tracker",
          palette: true,
          slash: { name: "tokens-reset" },
          bind: "<leader>z",
          run() {
            const route = context.ui.router.current()
            if (route.type !== "session") {
              context.ui.toast.show({ message: "Open a session first", variant: "warning" })
              return
            }
            reset(route.sessionID)
          },
        },
      ],
    }))

    return context.ui.slot({
      append: "sidebar.footer",
      render: (props: { sessionID?: string }) =>
        props?.sessionID ? (
          <TokenFooter
            context={context}
            sessionID={props.sessionID}
            baselines={baselines}
            epochs={epochs}
            setEpoch={setEpoch}
          />
        ) : null,
    })
  },
})
