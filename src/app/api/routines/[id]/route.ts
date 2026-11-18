import { z } from 'zod'
import { error, parseBody, type IdParams } from '@/lib/http'
import { RoutineInputSchema, upcoming } from '@/lib/routines'
import { ensureScheduler } from '@/lib/scheduler'
import { readRoutines, saveRoutines } from '@/lib/store'

const PatchRoutine = RoutineInputSchema.partial().extend({ enabled: z.boolean().optional() }).strict()

export async function PATCH(req: Request, { params }: IdParams) {
  ensureScheduler()
  const { id } = await params
  const body = await parseBody(req, PatchRoutine)
  if (body instanceof Response) return body
  const routines = readRoutines()
  const routine = routines.find((r) => r.id === id)
  if (!routine) return error(404, 'No such routine.')
  const merged = { ...routine, ...body }
  const updated = { ...merged, nextRunAt: upcoming(merged, new Date()) }
  saveRoutines(routines.map((r) => (r.id === id ? updated : r)))
  return Response.json(updated)
}

export async function DELETE(_req: Request, { params }: IdParams) {
  const { id } = await params
  const routines = readRoutines()
  if (!routines.some((r) => r.id === id)) return error(404, 'No such routine.')
  saveRoutines(routines.filter((r) => r.id !== id))
  return new Response(null, { status: 204 })
}
