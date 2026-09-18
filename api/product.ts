import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  dispatchProductHttp,
  readVercelHeaders,
  readVercelHost,
  readVercelProtocol,
  readVercelRawBody,
  resolveRewriteDispatchPath,
} from '../server/vercel/productAdapter.js'

/**
 * Stable single Vercel Function for all product API routes.
 *
 * Vercel's `api/[...nimhunt].ts` catch-all did not reliably match nested
 * multi-segment paths (e.g. `/api/expeditions/start-challenge`) in this
 * Vite/Vercel configuration, while single-segment paths
 * (e.g. `/api/daily-hunt-status`) did route. This stable single-segment
 * filename (`api/product.ts` -> `/api/product`) is unambiguous, and explicit
 * `vercel.json` rewrites map every owned product path to it with the original
 * public path captured in `?__nimhunt_route=...` (incoming query merged).
 * Wildcard rewrites are deliberately NOT used: a `:path*` capture variable
 * must never survive into the dispatched query string, because ACTIVE
 * requires exactly `?runId=...` and Treasure Bank / Monthly Stats require
 * zero query keys — any extra capture-like key breaks them with 400.
 *
 * `api/internal/payout-cycle.ts` remains a separate physical function and has
 * NO rewrite entry, so it can never route into the product adapter.
 */
export default async function productApiHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const headers = readVercelHeaders(req.headers as Record<string, string | string[] | undefined>)
  const socketEncrypted = 'encrypted' in req.socket && Boolean((req.socket as { readonly encrypted?: boolean }).encrypted)
  const host = readVercelHost(headers, req.headers.host)
  const protocol = readVercelProtocol(headers, socketEncrypted)

  let rawBody: string | undefined
  try {
    rawBody = await readVercelRawBody(req as IncomingMessage & { readonly body?: unknown })
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
    writeJson(res, tooLarge ? 413 : 400, { ok: false, error: 'MALFORMED_REQUEST' })
    return
  }

  try {
    const internalPath = req.url ?? '/api/product'
    const dispatchPath = resolveRewriteDispatchPath(internalPath)
    const response = await dispatchProductHttp({
      method: req.method ?? 'GET',
      path: dispatchPath,
      headers,
      host,
      protocol,
      rawBody,
    }, process.env)
    writeJson(res, response.status, response.body, response.headers)
  } catch {
    writeJson(res, 400, { ok: false, error: 'MALFORMED_REQUEST' })
  }
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  res.statusCode = status
  const merged: Record<string, string> = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  }
  for (const [name, value] of Object.entries(merged)) res.setHeader(name, value)
  if (body === null || body === undefined) {
    res.end()
    return
  }
  res.end(JSON.stringify(body))
}
