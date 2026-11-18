import { error, parseBody, type IdParams } from '@/lib/http'
import { RoutinePatchSchema } from '@/lib/routines'
import { ensureScheduler } from '@/lib/scheduler'
import { deleteRoutine, updateRoutine } from '@/lib/store'

const PatchRoutine = RoutinePatchSchema.strict()

export async function PATCH(req: Request, { params }: IdParams) {
  ensureScheduler()
  const { id } = await params
  const body = await parseBody(req, PatchRoutine)
  if (body instanceof Response) return body
  const updated = updateRoutine(id, body)
  return updated ? Response.json(updated) : error(404, 'No such routine.')
}

export async function DELETE(_req: Request, { params }: IdParams) {
  const { id } = await params
  return deleteRoutine(id) ? new Response(null, { status: 204 }) : error(404, 'No such routine.')
}
