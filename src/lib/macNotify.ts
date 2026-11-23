import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

// The installed will-bot window, as macOS names it.
const APP_NAME = 'will-bot'
const BODY_MAX = 180
// Built by scripts/notifier/build.sh. Its banners carry will-bot's name and icon and open will-bot when clicked.
const HELPER = path.join(process.cwd(), '.notifier', 'will-bot.app')

async function frontmostApp(): Promise<string | null> {
  try {
    const { stdout: asn } = await run('lsappinfo', ['front'])
    const { stdout } = await run('lsappinfo', ['info', '-only', 'name', asn.trim()])
    return /"([^"]*)"\s*$/.exec(stdout.trim())?.[1] ?? null
  } catch {
    return null
  }
}

// A macOS banner from the server, so it shows with no browser window open.
// Skipped while the will-bot window is in front: you are already looking.
// Without the helper it falls back to AppleScript, whose banners a click cannot route.
export async function notifyMac(title: string, body: string): Promise<void> {
  if (process.platform !== 'darwin') return
  if ((await frontmostApp()) === APP_NAME) return
  const text = body.length > BODY_MAX ? `${body.slice(0, BODY_MAX - 1)}…` : body
  try {
    if (fs.existsSync(HELPER)) {
      await run('open', ['-g', '-n', '-a', HELPER, '--args', title, text])
      return
    }
    await run('osascript', [
      '-e', 'on run argv',
      '-e', 'display notification (item 2 of argv) with title (item 1 of argv)',
      '-e', 'end run',
      title,
      text,
    ])
  } catch {}
}
