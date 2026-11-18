import { execFile } from 'node:child_process'

// osascript reads options from argv until the first non-option, so a fixed
// first argument keeps a name like "-e…" from being run as script lines.
// osascript runs in the background; activating it brings the dialog to the
// front. The timeout covers a user who takes longer than AppleScript's
// default two minutes.
const SCRIPT = [
  'on run argv',
  'activate',
  'with timeout of 3600 seconds',
  'if (count of argv) > 2 then',
  'return POSIX path of (choose folder with prompt ("Choose a folder for " & item 2 of argv) default location (POSIX file (item 3 of argv)))',
  'end if',
  'return POSIX path of (choose folder with prompt ("Choose a folder for " & item 2 of argv))',
  'end timeout',
  'end run',
]

export function pickerArgs(name: string, start: string | null): string[] {
  return [...SCRIPT.flatMap((line) => ['-e', line]), 'willbot', name, ...(start ? [start] : [])]
}

export type Picked = { path: string } | { cancelled: true }

let open = false

// One dialog at a time; null when one is already open.
export function pickFolder(name: string, start: string | null): Promise<Picked> | null {
  if (open) return null
  open = true
  return new Promise<Picked>((resolve, reject) => {
    execFile('osascript', pickerArgs(name, start), (err, stdout, stderr) => {
      if (err) {
        if (/-128\b/.test(stderr)) resolve({ cancelled: true })
        else reject(new Error(stderr.trim() || err.message))
        return
      }
      const chosen = stdout.trim()
      resolve({ path: chosen.length > 1 ? chosen.replace(/\/$/, '') : chosen })
    })
  }).finally(() => {
    open = false
  })
}
