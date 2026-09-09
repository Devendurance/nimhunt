import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import {
  ABANDON_EXPEDITION_PATH,
  COMPLETE_EXPEDITION_PATH,
  DAILY_HUNT_STATUS_PATH,
  FAIL_EXPEDITION_PATH,
  RESERVE_REWARD_PATH,
  START_EXPEDITION_PATH,
  WALLET_DAILY_STATUS_PATH,
} from '../../src/domain/dailyLedger.ts'
import { createSupabaseAdminClient, readServerSupabaseConfig } from './config.ts'
import { dispatchLedgerHttp, MAX_LEDGER_BODY_BYTES } from './http.ts'
import { createPostgresDailyLedger } from './postgresLedger.ts'
import type { DailyLedger } from './types.ts'

const LEDGER_PATHS = new Set([
  DAILY_HUNT_STATUS_PATH,
  WALLET_DAILY_STATUS_PATH,
  START_EXPEDITION_PATH,
  COMPLETE_EXPEDITION_PATH,
  FAIL_EXPEDITION_PATH,
  ABANDON_EXPEDITION_PATH,
  RESERVE_REWARD_PATH,
])

export function dailyLedgerPlugin(): Plugin {
  let ledger: DailyLedger | null = null

  return {
    name: 'nimhunt-daily-ledger',
    config(_, { mode }) {
      const env = loadEnv(mode, process.cwd(), '')
      const supabase = readServerSupabaseConfig({
        SUPABASE_URL: env.SUPABASE_URL ?? process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
      })
      ledger = supabase ? createPostgresDailyLedger(createSupabaseAdminClient(supabase)) : null
    },
    configureServer(server) {
      server.middlewares.use(createHandler(() => ledger))
    },
    configurePreviewServer(server) {
      server.middlewares.use(createHandler(() => ledger))
    },
  }
}

function createHandler(getLedger: () => DailyLedger | null) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = req.url?.split('?')[0] ?? ''
    if (!LEDGER_PATHS.has(path)) {
      next()
      return
    }

    try {
      const rawBody = req.method === 'GET' || req.method === 'OPTIONS' ? undefined : await readBody(req, MAX_LEDGER_BODY_BYTES)
      const response = await dispatchLedgerHttp(getLedger(), {
        method: req.method ?? 'GET',
        path,
        rawBody,
      })
      writeJson(res, response.status, response.body)
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
      writeJson(res, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'MALFORMED_REQUEST' : 'MALFORMED_REQUEST' })
    }
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        req.destroy()
        reject(new Error('REQUEST_TOO_LARGE'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  if (body === null) {
    res.end()
    return
  }
  res.end(JSON.stringify(body))
}
