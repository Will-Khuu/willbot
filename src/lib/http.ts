import type { z } from 'zod'
import { getBot, isBotId } from './store'
import type { Bot } from './types'

export function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | Response> {
  const mediaType = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (mediaType !== 'application/json') return error(415, 'Expected application/json.')
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return error(400, 'Invalid JSON.')
  }
  const parsed = schema.safeParse(raw)
  return parsed.success ? parsed.data : error(400, parsed.error.issues.map((i) => i.message).join('; '))
}

export function findBot(id: string): Bot | Response {
  const bot = isBotId(id) ? getBot(id) : null
  return bot ?? error(404, 'No such bot.')
}

export type IdParams = { params: Promise<{ id: string }> }
