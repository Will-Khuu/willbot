import { error, type IdParams } from '@/lib/http'
import { ensureScheduler, runNow } from '@/lib/scheduler'

export async function POST(_req: Request, { params }: IdParams) {
  ensureScheduler()
  const routine = runNow((await params).id)
  return routine ? Response.json(routine) : error(404, 'No such routine.')
}
