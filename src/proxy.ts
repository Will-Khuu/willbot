import { NextResponse, type NextRequest } from 'next/server'
import { API_HEADERS, refuseApiRequest } from '@/lib/origin'

export function proxy(request: NextRequest) {
  const refused = refuseApiRequest(request.method, (name) => request.headers.get(name))
  const response = refused ? new NextResponse(refused, { status: 403 }) : NextResponse.next()
  for (const [name, value] of Object.entries(API_HEADERS)) response.headers.set(name, value)
  return response
}

export const config = { matcher: '/api/:path*' }
