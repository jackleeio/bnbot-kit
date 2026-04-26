/**
 * `bnbot xhs post` — one-shot XHS compose (+ optional publish).
 *
 * Input: a plan JSON (path or `-` for stdin) shaped like:
 *   {
 *     "images":      ["/abs/path/1.jpg", ...],
 *     "coverIndex":  3,                     // optional, default 0
 *     "title":       "...",
 *     "body":        "段1\n段2\n段3",       // \n splits paragraphs
 *     "emojis":      [{"paraIndex": 0, "slug": "shihua"}, ...],
 *     "tags":        ["vibecoding", ...],   // without #
 *     "publish":     false                   // default false (compose only)
 *   }
 *
 * Returns: composed state (image count, title, paragraphs, topics,
 * emojis) + `published: true|false`. Until the user runs with
 * `publish: true`, the post stays drafted in the creator tab.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { ensureServer } from '../cli'

const DEFAULT_PORT = 18900
const TIMEOUT_MS = 240_000 // uploads + SPA skeleton reload + waits
const STATS_TIMEOUT_MS = 60_000

interface PostArgs {
  /** Inline JSON string (preferred when the agent can pass argv cleanly) */
  inline?: string
  /** Path to plan.json, or '-' for stdin */
  plan?: string
  publish?: boolean
}

export async function xhsPostCommand(opts: PostArgs): Promise<void> {
  let raw: string
  if (opts.inline !== undefined) {
    raw = opts.inline
  } else {
    const planSource = opts.plan || '-'
    raw = planSource === '-' ? readFileSync(0, 'utf8') : readFileSync(planSource, 'utf8')
  }
  let plan: Record<string, unknown>
  try {
    plan = JSON.parse(raw)
  } catch (err) {
    console.error(`[bnbot xhs post] plan is not valid JSON: ${(err as Error).message}`)
    process.exit(2)
  }
  if (opts.publish !== undefined) plan.publish = opts.publish

  await ensureServer(DEFAULT_PORT)
  const start = Date.now()
  const result = await sendAction('xhs_post', plan, TIMEOUT_MS)
  const elapsed = ((Date.now() - start) / 1000).toFixed(2)
  console.log(JSON.stringify(result, null, 2))
  console.log(`⏱  ${elapsed}s`)
}

export async function xhsStatsNoteCommand(noteId: string): Promise<void> {
  await ensureServer(DEFAULT_PORT)
  const start = Date.now()
  const result = await sendAction('xhs_stats_note', { noteId }, STATS_TIMEOUT_MS)
  const elapsed = ((Date.now() - start) / 1000).toFixed(2)
  console.log(JSON.stringify(result, null, 2))
  console.log(`⏱  ${elapsed}s`)
}

export async function xhsStatsAccountCommand(): Promise<void> {
  await ensureServer(DEFAULT_PORT)
  const start = Date.now()
  const result = await sendAction('xhs_stats_account', {}, STATS_TIMEOUT_MS)
  const elapsed = ((Date.now() - start) / 1000).toFixed(2)
  console.log(JSON.stringify(result, null, 2))
  console.log(`⏱  ${elapsed}s`)
}

function sendAction(
  actionType: string,
  payload: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${DEFAULT_PORT}`)
    const requestId = randomUUID()
    let done = false

    const timer = setTimeout(() => {
      if (done) return
      done = true
      ws.close()
      reject(new Error(`${actionType} timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'cli_action', requestId, actionType, actionPayload: payload }))
    })
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.requestId !== requestId || msg.type !== 'action_result') return
        clearTimeout(timer)
        done = true
        ws.close()
        if (!msg.success) {
          reject(new Error(msg.error || `${actionType} failed`))
          return
        }
        resolve(msg.data)
      } catch (err) {
        if (done) return
        done = true
        clearTimeout(timer)
        ws.close()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    ws.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(err)
    })
    ws.on('close', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(new Error(`WS closed before ${actionType} result`))
    })
  })
}
