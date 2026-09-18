import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  dispatchProductHttp,
  readVercelHeaders,
  readVercelHost,
  readVercelProtocol,
  readVercelRawBody,
} from '../server/vercel/productAdapter.js'

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
    const response = await dispatchProductHttp({
      method: req.method ?? 'GET',
      path: req.url ?? '/',
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
