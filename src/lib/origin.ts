const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

type Get = (name: string) => string | null

// Binding to 127.0.0.1 is not enough: a web page can reach it through DNS
// rebinding (foreign Host header), a cross-site form post (foreign Origin), or
// a no-cors fetch that sends no Origin at all (caught by Sec-Fetch-Site).
// Returns why the request is refused, or null.
export function refuseApiRequest(method: string, header: Get): string | null {
  const host = header('host') ?? ''
  if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, ''))) return 'Forbidden host'
  const site = header('sec-fetch-site')
  if (site === 'cross-site' || site === 'same-site') return 'Forbidden site'
  // "none" is the user typing the URL or opening a bookmark: fine to read, never to change.
  if (site === 'none' && method !== 'GET') return 'Forbidden site'
  const origin = header('origin')
  if (origin && origin !== 'null') {
    let originHost = ''
    try {
      originHost = new URL(origin).host
    } catch {}
    // Host includes the port, so another local server's page cannot post here.
    if (originHost !== host) return 'Forbidden origin'
  } else if (origin === 'null' && method !== 'GET') {
    return 'Forbidden origin'
  }
  return null
}

export const API_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const
