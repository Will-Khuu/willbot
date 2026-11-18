import { billingOverride } from '@/lib/env'

export const dynamic = 'force-dynamic'

export function GET() {
  const billingVar = billingOverride()
  return Response.json({ apiKeySet: billingVar !== null, billingVar })
}
