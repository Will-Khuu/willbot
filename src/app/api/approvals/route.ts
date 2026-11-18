import { pendingApprovals } from '@/lib/runtime'

export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(pendingApprovals())
}
