import { findBot, type IdParams } from '@/lib/http'
import { isApprovalPending } from '@/lib/runtime'
import { readChat } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: IdParams) {
  const bot = findBot((await params).id)
  if (bot instanceof Response) return bot
  const chat = readChat(bot.id)
  // A 'pending' card left over from a crashed or restarted server can no longer be answered.
  const items = chat.items.map((item) =>
    item.kind === 'approval' && item.state === 'pending' && !isApprovalPending(item.id)
      ? { ...item, state: 'expired' as const }
      : item,
  )
  return Response.json({ ...chat, items })
}
