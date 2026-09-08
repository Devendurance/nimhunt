import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { DEV_VERIFY_PATH } from '../src/integrations/nimiq/verifySealTypes.ts'
import { MAX_VERIFY_BODY_BYTES, verifyTreasureSeal } from './verifyTreasureSeal.ts'

export function nimiqDevVerifyPlugin(): Plugin {
  return {
    name: 'nimiq-dev-verify',
    configureServer(server) {
      server.middlewares.use(handleDevVerify)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleDevVerify)
    },
  }
}

async function handleDevVerify(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  const path = req.url?.split('?')[0]
  if (path !== DEV_VERIFY_PATH) {
    next()
    return
  }

  if (req.method === 'OPTIONS') {
    writeJson(res, 204, null)
    return
  }

  if (req.method !== 'POST') {
    writeJson(res, 405, {
      valid: false,
      signatureValid: false,
      addressMatches: false,
      reason: 'MALFORMED_PAYLOAD',
    })
    return
  }

  try {
    const raw = await readBody(req, MAX_VERIFY_BODY_BYTES)
    const body: unknown = raw.length === 0 ? null : JSON.parse(raw)
    writeJson(res, 200, verifyTreasureSeal(body))
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
    writeJson(res, tooLarge ? 413 : 400, {
      valid: false,
      signatureValid: false,
      addressMatches: false,
      reason: 'MALFORMED_PAYLOAD',
    })
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
