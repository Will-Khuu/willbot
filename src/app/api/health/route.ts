import { billingOverride } from '@/lib/agent'

export const dynamic = 'force-dynamic'

export function GET() {
  const billingVar = billingOverride()
  return Response.json({ apiKeySet: billingVar !== null, billingVar })
}
