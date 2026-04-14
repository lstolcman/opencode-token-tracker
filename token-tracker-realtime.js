/**
 * Token Tracker Plugin - Real-time Toast Updates
 *
 * Versão alternativa que atualiza o toast em tempo real
 * durante a execução do agente.
 */

export const TokenTrackerPlugin = async ({ client }) => {
  /** Track which message IDs have already been counted */
  const seenMessages = new Set()
  /** Timer reference for cleanup */
  let updateTimer = null
  /** Current session being tracked */
  let currentSessionID = null
  /** Last toast ID for updates */
  let lastToastId = null

  // Format numbers: 1200 -> "1.2k"
  const fmt = (n) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return `${n}`
  }

  // Format cost: 0.0032 -> "$0.0032"
  const fmtCost = (n) => {
    if (n >= 1) return `$${n.toFixed(2)}`
    if (n >= 0.01) return `$${n.toFixed(3)}`
    return `$${n.toFixed(4)}`
  }

  // Collect token data from all messages
  async function collectTokenData(sessionID) {
    try {
      const response = await client.session.messages({ path: { id: sessionID } })
      const messages = response?.data ?? response ?? []
      
      if (!Array.isArray(messages)) return null

      const assistantMsgs = messages.filter((m) => {
        if (m.info?.role !== "assistant" || !m.info?.tokens) return false
        const t = m.info.tokens
        return (
          (Number(t?.input) || 0) +
          (Number(t?.output) || 0) +
          (Number(t?.reasoning) || 0) +
          (Number(t?.cache?.read) || 0) +
          (Number(t?.cache?.write) || 0) > 0
        )
      })

      const totalInp = assistantMsgs.reduce((sum, m) => sum + (Number(m.info.tokens?.input) || 0), 0)
      const totalOut = assistantMsgs.reduce((sum, m) => sum + (Number(m.info.tokens?.output) || 0), 0)
      const totalReasoning = assistantMsgs.reduce((sum, m) => sum + (Number(m.info.tokens?.reasoning) || 0), 0)
      const totalCacheRead = assistantMsgs.reduce((sum, m) => sum + (Number(m.info.tokens?.cache?.read) || 0), 0)
      const totalCacheWrite = assistantMsgs.reduce((sum, m) => sum + (Number(m.info.tokens?.cache?.write) || 0), 0)
      const totalCost = assistantMsgs.reduce((sum, m) => sum + (Number(m.info.cost) || 0), 0)
      const reqCount = assistantMsgs.filter(m => (Number(m.info.tokens?.input) || 0) > 0).length

      const totalTokens = totalInp + totalOut + totalReasoning + totalCacheRead + totalCacheWrite

      // Track seen messages
      assistantMsgs.forEach(m => seenMessages.add(m.info.id))

      return {
        totalTokens,
        totalCost,
        reqCount,
      }
    } catch (_err) {
      return null
    }
  }

  // Show/update toast with current token data
  async function updateToast(sessionID) {
    const data = await collectTokenData(sessionID)
    if (!data) return

    const message = `⏳ ${fmt(data.totalTokens)} tokens · ${data.reqCount} reqs${data.totalCost > 0 ? ' · ' + fmtCost(data.totalCost) : ''}`

    try {
      // Show toast with short duration (1s) for real-time updates
      await client.tui.showToast({
        body: { message, variant: "info", duration: 1000 },
      })
    } catch (_err) {
      // Silently ignore
    }
  }

  // Start tracking a session
  function startTracking(sessionID) {
    if (updateTimer) {
      clearInterval(updateTimer)
    }
    
    currentSessionID = sessionID
    seenMessages.clear()
    
    // Update immediately and then every 2 seconds
    updateToast(sessionID)
    updateTimer = setInterval(() => {
      if (currentSessionID) {
        updateToast(currentSessionID)
      }
    }, 2000)
  }

  // Stop tracking
  function stopTracking() {
    if (updateTimer) {
      clearInterval(updateTimer)
      updateTimer = null
    }
    currentSessionID = null
  }

  return {
    event: async ({ event }) => {
      // Start tracking when session becomes busy
      if (event.type === "session.status") {
        const sessionID = event.properties?.sessionID
        const status = event.properties?.status
        
        if (sessionID && status?.type === "busy") {
          startTracking(sessionID)
        }
        
        if (sessionID && status?.type === "idle" && currentSessionID === sessionID) {
          stopTracking()
        }
      }

      // Also track session.idle for final update
      if (event.type === "session.idle") {
        const sessionID = event.properties?.sessionID
        if (sessionID) {
          stopTracking()
          // Final update
          await updateToast(sessionID)
        }
      }
    },
  }
}

export default TokenTrackerPlugin
