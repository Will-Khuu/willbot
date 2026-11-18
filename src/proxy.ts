import { NextResponse, type NextRequest } from 'next/server'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

// Binding to 127.0.0.1 is not enough: a web page can reach it through DNS
// rebinding (foreign Host header) or a cross-site form post (foreign Origin).
export function proxy(request: NextRequest) {
  const hostname = (request.headers.get('host') ?? '').replace(/:\d+$/, '')
  if (!LOCAL_HOSTS.has(hostname)) return new NextResponse('Forbidden host', { status: 403 })
  const origin = request.headers.get('origin')
  if (origin && origin !== 'null') {
    let originHost = ''
    try {
      originHost = new URL(origin).host
    } catch {}
    // Host includes the port, so another local server's page cannot post here.
    if (originHost !== request.headers.get('host')) return new NextResponse('Forbidden origin', { status: 403 })
  } else if (origin === 'null' && request.method !== 'GET') {
    return new NextResponse('Forbidden origin', { status: 403 })
  }
  return NextResponse.next()
}

export const config = { matcher: '/api/:path*' }
