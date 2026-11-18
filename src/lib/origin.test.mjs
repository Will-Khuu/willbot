import assert from 'node:assert/strict'
import { test } from 'node:test'
import { refuseApiRequest } from './origin.ts'

const req = (method, headers) => {
  const h = { host: '127.0.0.1:3000', ...headers }
  return refuseApiRequest(method, (name) => h[name] ?? null)
}

test('same-origin requests from the app pass', () => {
  assert.equal(req('GET', { 'sec-fetch-site': 'same-origin' }), null)
  assert.equal(req('POST', { 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3000' }), null)
})

test('cross-site and same-site requests are refused for every method', () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    assert.match(req(method, { 'sec-fetch-site': 'cross-site' }), /site/)
    assert.match(req(method, { 'sec-fetch-site': 'same-site' }), /site/)
  }
})

test('a typed URL may read but not change anything', () => {
  assert.equal(req('GET', { 'sec-fetch-site': 'none' }), null)
  assert.match(req('POST', { 'sec-fetch-site': 'none' }), /site/)
  assert.match(req('DELETE', { 'sec-fetch-site': 'none' }), /site/)
})

test('requests without Sec-Fetch-Site (curl, older clients) fall back to Host and Origin', () => {
  assert.equal(req('POST', {}), null)
  assert.match(req('GET', { host: 'evil.example:3000' }), /host/)
  assert.match(req('POST', { origin: 'http://127.0.0.1:4000' }), /origin/)
  assert.match(req('POST', { origin: 'null' }), /origin/)
})
