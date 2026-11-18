import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { z } from 'zod'
import { error, findBot, parseBody } from '@/lib/http'

export const dynamic = 'force-dynamic'

const Pick = z.object({ botId: z.string() }).strict()

// The name and start folder arrive as argv, so nothing is spliced into the
// script. osascript runs in the background; activating it brings the dialog
// to the front. The timeout covers a user who takes longer than AppleScript's
// default two minutes.
const SCRIPT = [
  'on run argv',
  'activate',
  'with timeout of 3600 seconds',
  'if (count of argv) > 1 then',
  'return POSIX path of (choose folder with prompt ("Choose a folder for " & item 1 of argv) default location (POSIX file (item 2 of argv)))',
  'end if',
  'return POSIX path of (choose folder with prompt ("Choose a folder for " & item 1 of argv))',
  'end timeout',
  'end run',
]

function pick(name: string, start: string | null): Promise<{ path: string } | { cancelled: true }> {
  const args = SCRIPT.flatMap((line) => ['-e', line])
  return new Promise((resolve, reject) => {
    execFile('osascript', [...args, name, ...(start ? [start] : [])], (err, stdout, stderr) => {
      if (err) {
        if (/-128\b/.test(stderr)) resolve({ cancelled: true })
        else reject(new Error(stderr.trim() || err.message))
        return
      }
      const chosen = stdout.trim()
      resolve({ path: chosen.length > 1 ? chosen.replace(/\/$/, '') : chosen })
    })
  })
}

export async function POST(req: Request) {
  const body = await parseBody(req, Pick)
  if (body instanceof Response) return body
  const bot = findBot(body.botId)
  if (bot instanceof Response) return bot
  const start = fs.statSync(bot.folder, { throwIfNoEntry: false })?.isDirectory() ? bot.folder : null
  try {
    return Response.json(await pick(bot.name, start))
  } catch (e) {
    return error(500, `The folder picker failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
