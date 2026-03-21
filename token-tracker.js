/**
 * Token Tracker Plugin
 *
 * After each request (session.idle), prints a summary line with:
 * - Input / output / reasoning tokens
 * - Cache read/write tokens (if any)
 * - Response latency
 * - Per-message cost and session cumulative cost
 * - Model used
 * - Premium request count for the session
 * - Finish reason (if not "end_turn")
 *
 * When the session has child sessions (subagents), aggregates tokens
 * from all children and shows a single consolidated toast with [+N subagents].
 * Subagent sessions show their own individual toasts as normal.
 */

/** Returns data for only the LAST assistant message with tokens in a session. */
export async function collectTokensFromSession(client, sessionID) {
  const response = await client.session.messages({ path: { id: sessionID } })
  const messages = response?.data ?? response ?? []
  if (!Array.isArray(messages) || messages.length === 0) return null

  const assistantMessages = [...messages]
    .filter((m) => m.info?.role === "assistant" && m.info?.tokens)
    .reverse()

  const lastWithTokens = assistantMessages.find((m) => {
    const t = m.info.tokens
    return (
      (Number(t?.input) || 0) +
      (Number(t?.output) || 0) +
      (Number(t?.cache?.read) || 0) +
      (Number(t?.cache?.write) || 0) > 0
    )
  })

  if (!lastWithTokens) return null

  const info = lastWithTokens.info
  const tokens = info.tokens
  const created = Number(info.time?.created) || 0
  const completed = Number(info.time?.completed) || 0

  return {
    inp: Number(tokens?.input) || 0,
    out: Number(tokens?.output) || 0,
    reasoning: Number(tokens?.reasoning) || 0,
    cacheRead: Number(tokens?.cache?.read) || 0,
    cacheWrite: Number(tokens?.cache?.write) || 0,
    latencyMs: created && completed ? completed - created : 0,
    msgCost: Number(info.cost) || 0,
    model: [info.providerID, info.modelID].filter(Boolean).join("/"),
    finish: info.finish,
    msgId: info.id,
  }
}

/**
 * Returns an array of per-message token data for ALL assistant messages with
 * tokens in a session.  Used for child (subagent) sessions so that every
 * individual request made by the subagent is counted, not just the last one.
 */
export async function collectAllMessagesFromSession(client, sessionID) {
  const response = await client.session.messages({ path: { id: sessionID } })
  const messages = response?.data ?? response ?? []
  if (!Array.isArray(messages) || messages.length === 0) return []

  return messages
    .filter((m) => {
      if (m.info?.role !== "assistant" || !m.info?.tokens) return false
      const t = m.info.tokens
      return (
        (Number(t?.input) || 0) +
        (Number(t?.output) || 0) +
        (Number(t?.cache?.read) || 0) +
        (Number(t?.cache?.write) || 0) > 0
      )
    })
    .map((m) => {
      const info = m.info
      const tokens = info.tokens
      const created = Number(info.time?.created) || 0
      const completed = Number(info.time?.completed) || 0
      return {
        inp: Number(tokens?.input) || 0,
        out: Number(tokens?.output) || 0,
        reasoning: Number(tokens?.reasoning) || 0,
        cacheRead: Number(tokens?.cache?.read) || 0,
        cacheWrite: Number(tokens?.cache?.write) || 0,
        latencyMs: created && completed ? completed - created : 0,
        msgCost: Number(info.cost) || 0,
        model: [info.providerID, info.modelID].filter(Boolean).join("/"),
        finish: info.finish,
        msgId: info.id,
      }
    })
}

export const TokenTrackerPlugin = async ({ client }) => {
  const premiumRequestsPerSession = new Map()
  const sessionCost = new Map()
  /** Track which child session IDs have already been processed per parent session */
  const processedChildren = new Map()

  return {
    event: async ({ event }) => {
      // Reset per-question accumulators when a new prompt is submitted
      if (event.type === "session.status" && event.properties?.status?.type === "busy") {
        const sid = event.properties?.sessionID
        if (sid) {
          sessionCost.set(sid, 0)
          premiumRequestsPerSession.delete(sid)
          processedChildren.delete(sid)
          if (sessionCost._seen) {
            for (const key of [...sessionCost._seen]) {
              if (key.startsWith(`${sid}:`) || key.startsWith(`${sid}:agg:`)) {
                sessionCost._seen.delete(key)
              }
            }
          }
          // Don't clear the toast proactively — let it persist until the
          // next session.idle naturally replaces it with fresh data.
          // Previously this cleared with duration:1, which caused subagent
          // toasts to flash and disappear before the user could read them.
        }
        return
      }

      if (event.type !== "session.idle") return
      const sessionID = event.properties?.sessionID
      if (!sessionID) return

      try {
        // Check if this session has children (= main agent that spawned subagents)
        const childrenResponse = await client.session.children({ path: { id: sessionID } })
        const children = childrenResponse?.data ?? childrenResponse ?? []
        const hasChildren = Array.isArray(children) && children.length > 0

        if (!sessionCost._seen) sessionCost._seen = new Set()

        if (!hasChildren) {
          // ── No children: subagent or simple session — original behavior ──
          const data = await collectTokensFromSession(client, sessionID)
          if (!data) return

          const { inp, out, reasoning, cacheRead, cacheWrite, latencyMs, msgCost, model, finish, msgId } = data

          // Deduplicate cost accumulation by message ID
          const seenKey = `${sessionID}:${msgId}`
          const prevCost = sessionCost.get(sessionID) || 0
          let totalCost = prevCost
          if (!sessionCost._seen.has(seenKey)) {
            sessionCost._seen.add(seenKey)
            totalCost = prevCost + msgCost
            sessionCost.set(sessionID, totalCost)
          }

          // Premium request count
          const isPremium = inp > 0
          const prev = premiumRequestsPerSession.get(sessionID) || 0
          const premiumCount = isPremium ? prev + 1 : prev
          premiumRequestsPerSession.set(sessionID, premiumCount)

          const parts = [`in: ${fmt(inp)}`, `out: ${fmt(out)}`]
          if (reasoning > 0) parts.push(`think: ${fmt(reasoning)}`)
          if (cacheRead > 0) parts.push(`cache↓: ${fmt(cacheRead)}`)
          if (cacheWrite > 0) parts.push(`cache↑: ${fmt(cacheWrite)}`)
          if (latencyMs > 0) parts.push(`t: ${(latencyMs / 1000).toFixed(1)}s`)
          if (msgCost > 0) parts.push(`$${msgCost.toFixed(4)}`)
          if (totalCost > 0) parts.push(`session: $${totalCost.toFixed(4)}`)
          if (model) parts.push(model)
          parts.push(`reqs: ${premiumCount}`)
          if (finish && finish !== "end_turn" && finish !== "tool_calls") {
            parts.push(`finish: ${finish}`)
          }

          await client.tui.showToast({
            body: { message: `[tokens] ${parts.join("  |  ")}`, variant: "success", duration: 10000 },
          })
          return
        }

        // ── Has children: main agent — aggregate tokens from all sessions ──
        // Only process NEW child sessions (opened during this request),
        // not children from previous questions.
        const mainData = await collectTokensFromSession(client, sessionID)

        const seen = processedChildren.get(sessionID) || new Set()
        const newChildren = children.filter((child) => {
          const childId = child.id ?? child.info?.id ?? child
          return !seen.has(childId)
        })

        // Mark new children as processed
        for (const child of newChildren) {
          seen.add(child.id ?? child.info?.id ?? child)
        }
        processedChildren.set(sessionID, seen)

        const childMessageLists = await Promise.all(
          newChildren.map((child) =>
            collectAllMessagesFromSession(client, child.id ?? child.info?.id ?? child).catch(() => [])
          )
        )

        // Flatten: one entry per assistant message across NEW child sessions only
        const allChildMessages = childMessageLists.flat()

        // Combine main-session last message with NEW child messages only
        const allData = [...(mainData ? [mainData] : []), ...allChildMessages]
        if (allData.length === 0) return

        // Deduplicate cost and request count per unique msgId across all sessions
        let newCostDelta = 0
        let newReqsDelta = 0
        for (const d of allData) {
          const seenKey = `${sessionID}:agg:${d.msgId}`
          if (!sessionCost._seen.has(seenKey)) {
            sessionCost._seen.add(seenKey)
            newCostDelta += d.msgCost
            if (d.inp > 0) newReqsDelta += 1
          }
        }

        // Accumulate session cost
        const prevCost = sessionCost.get(sessionID) || 0
        const sessionTotal = prevCost + newCostDelta
        if (newCostDelta > 0) sessionCost.set(sessionID, sessionTotal)

        // Premium request count (deduplicated)
        const prev = premiumRequestsPerSession.get(sessionID) || 0
        const premiumCount = prev + newReqsDelta
        premiumRequestsPerSession.set(sessionID, premiumCount)

        const totalInp = allData.reduce((s, d) => s + d.inp, 0)
        const totalOut = allData.reduce((s, d) => s + d.out, 0)
        const totalReasoning = allData.reduce((s, d) => s + d.reasoning, 0)
        const totalCacheRead = allData.reduce((s, d) => s + d.cacheRead, 0)
        const totalCacheWrite = allData.reduce((s, d) => s + d.cacheWrite, 0)
        const totalLatency = allData.reduce((s, d) => s + d.latencyMs, 0)
        const totalMsgCost = allData.reduce((s, d) => s + d.msgCost, 0)

        const model = mainData?.model || allData[0]?.model || ""
        const finish = mainData?.finish

        const parts = [`in: ${fmt(totalInp)}`, `out: ${fmt(totalOut)}`]
        if (totalReasoning > 0) parts.push(`think: ${fmt(totalReasoning)}`)
        if (totalCacheRead > 0) parts.push(`cache↓: ${fmt(totalCacheRead)}`)
        if (totalCacheWrite > 0) parts.push(`cache↑: ${fmt(totalCacheWrite)}`)
        if (totalLatency > 0) parts.push(`t: ${(totalLatency / 1000).toFixed(1)}s`)
        if (totalMsgCost > 0) parts.push(`$${totalMsgCost.toFixed(4)}`)
        if (sessionTotal > 0) parts.push(`session: $${sessionTotal.toFixed(4)}`)
        if (model) parts.push(model)
        parts.push(`reqs: ${premiumCount}`)
        if (finish && finish !== "end_turn" && finish !== "tool_calls") {
          parts.push(`finish: ${finish}`)
        }
        if (newChildren.length > 0) parts.push(`[+${newChildren.length} subagents]`)

        await client.tui.showToast({
          body: { message: `[tokens] ${parts.join("  |  ")}`, variant: "success", duration: 10000 },
        })
      } catch (_err) {
        // Silently ignore errors to avoid disrupting the session
      }
    },
  }
}

function fmt(n) {
  return new Intl.NumberFormat("en-US").format(n)
}
