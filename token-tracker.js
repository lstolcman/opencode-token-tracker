/**
 * Token Tracker Plugin
 *
 * After each request (session.idle), prints a summary line with:
 * - Input / output / reasoning tokens
 * - Cache read/write tokens (if any)
 * - Response latency
 * - Cost for the current request only (not accumulated across requests)
 * - Model used
 * - Premium request count for the current request
 * - Finish reason (if not "end_turn")
 *
 * When the session has child sessions (subagents), aggregates tokens
 * from all NEW children and shows a single consolidated toast with [+N subagents].
 *
 * Deduplication is handled naturally: each message ID is tracked in a
 * per-session set and only counted once. No state is cleared between
 * requests — the seen-set ensures only truly new messages are shown.
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
  /** Track which child session IDs have already been processed per parent session */
  const processedChildren = new Map()
  /** Track which message IDs have already been counted per session */
  const seenMessages = new Map()

  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = event.properties?.sessionID
      if (!sessionID) return

      try {
        if (!seenMessages.has(sessionID)) seenMessages.set(sessionID, new Set())
        if (!processedChildren.has(sessionID)) processedChildren.set(sessionID, new Set())
        const seen = seenMessages.get(sessionID)
        const seenChildIds = processedChildren.get(sessionID)

        // Collect ALL messages from the main session
        const mainMessages = await collectAllMessagesFromSession(client, sessionID)

        // Check for child sessions (subagents)
        const childrenResponse = await client.session.children({ path: { id: sessionID } })
        const children = childrenResponse?.data ?? childrenResponse ?? []
        const hasChildren = Array.isArray(children) && children.length > 0

        // Collect messages from NEW child sessions only
        let newChildCount = 0
        let childMessages = []
        if (hasChildren) {
          const newChildren = children.filter((child) => {
            const childId = child.id ?? child.info?.id ?? child
            return !seenChildIds.has(childId)
          })
          newChildCount = newChildren.length

          for (const child of newChildren) {
            seenChildIds.add(child.id ?? child.info?.id ?? child)
          }

          const childMessageLists = await Promise.all(
            newChildren.map((child) =>
              collectAllMessagesFromSession(client, child.id ?? child.info?.id ?? child).catch(() => [])
            )
          )
          childMessages = childMessageLists.flat()
        }

        // Filter to only NEW messages (not previously seen)
        const allMessages = [...mainMessages, ...childMessages]
        const newMessages = allMessages.filter((d) => !seen.has(d.msgId))
        if (newMessages.length === 0) return

        // Mark as seen
        for (const d of newMessages) seen.add(d.msgId)

        // Aggregate token data from new messages only
        const totalInp = newMessages.reduce((s, d) => s + d.inp, 0)
        const totalOut = newMessages.reduce((s, d) => s + d.out, 0)
        const totalReasoning = newMessages.reduce((s, d) => s + d.reasoning, 0)
        const totalCacheRead = newMessages.reduce((s, d) => s + d.cacheRead, 0)
        const totalCacheWrite = newMessages.reduce((s, d) => s + d.cacheWrite, 0)
        const totalLatency = newMessages.reduce((s, d) => s + d.latencyMs, 0)
        const totalCost = newMessages.reduce((s, d) => s + d.msgCost, 0)
        const premiumCount = newMessages.filter((d) => d.inp > 0).length

        // Display metadata from the latest main session message
        const lastMainMsg = mainMessages.length > 0 ? mainMessages[mainMessages.length - 1] : null
        const model = lastMainMsg?.model || newMessages[newMessages.length - 1]?.model || ""
        const finish = lastMainMsg?.finish

        const parts = [`in: ${fmt(totalInp)}`, `out: ${fmt(totalOut)}`]
        if (totalReasoning > 0) parts.push(`think: ${fmt(totalReasoning)}`)
        if (totalCacheRead > 0) parts.push(`cache↓: ${fmt(totalCacheRead)}`)
        if (totalCacheWrite > 0) parts.push(`cache↑: ${fmt(totalCacheWrite)}`)
        if (totalLatency > 0) parts.push(`t: ${(totalLatency / 1000).toFixed(1)}s`)
        if (totalCost > 0) parts.push(`$${totalCost.toFixed(4)}`)
        if (model) parts.push(model)
        parts.push(`reqs: ${premiumCount}`)
        if (finish && finish !== "end_turn" && finish !== "tool_calls") {
          parts.push(`finish: ${finish}`)
        }
        if (newChildCount > 0) parts.push(`[+${newChildCount} subagents]`)

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
