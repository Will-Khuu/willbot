import { z } from 'zod'
import { error, parseBody, type IdParams } from '@/lib/http'
import { decideApproval } from '@/lib/runtime'

const Decide = z.object({ decision: z.enum(['allow', 'deny']) })

export async function POST(req: Request, { params }: IdParams) {
  const body = await parseBody(req, Decide)
  if (body instanceof Response) return body
  const ok = decideApproval((await params).id, body.decision === 'allow')
  return ok ? Response.json({ ok: true }) : error(404, 'That approval is no longer pending.')
}
