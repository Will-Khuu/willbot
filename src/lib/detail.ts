// The expandable detail under an activity line: what the tool was given and
// what it returned.

export const DETAIL_MAX = 4000

export function truncate(text: string, max = DETAIL_MAX): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lineEnd = cut.lastIndexOf('\n')
  return `${lineEnd > 0 ? cut.slice(0, lineEnd) : cut}\n… (truncated)`
}

const prefixed = (prefix: string, text: string) =>
  text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n')

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key]
  return typeof v === 'string' ? v : ''
}

const lines = (...parts: string[]) => parts.filter(Boolean).join('\n')

const DETAIL: Record<string, (i: Record<string, unknown>) => string> = {
  Bash: (i) => `$ ${str(i, 'command')}`,
  Edit: (i) => lines(str(i, 'file_path'), prefixed('- ', str(i, 'old_string')), prefixed('+ ', str(i, 'new_string'))),
  Write: (i) => lines(str(i, 'file_path'), prefixed('+ ', str(i, 'content'))),
  NotebookEdit: (i) => lines(str(i, 'notebook_path'), prefixed('+ ', str(i, 'new_source'))),
  Read: (i) => str(i, 'file_path'),
  Glob: (i) => lines(str(i, 'pattern'), str(i, 'path') && `in ${str(i, 'path')}`),
  Grep: (i) => lines(str(i, 'pattern'), str(i, 'path') && `in ${str(i, 'path')}`),
  WebFetch: (i) => lines(str(i, 'url'), str(i, 'prompt')),
  WebSearch: (i) => str(i, 'query'),
  Agent: (i) => lines(str(i, 'description'), str(i, 'prompt')),
  Task: (i) => lines(str(i, 'description'), str(i, 'prompt')),
  Skill: (i) => lines(str(i, 'skill'), str(i, 'args')),
}

export function detailInput(toolName: string, input: Record<string, unknown>): string {
  const text = DETAIL[toolName]?.(input) || JSON.stringify(input, null, 2)
  return truncate(text)
}

// A tool_result's content is a string or content blocks; only text blocks are kept.
// Terminal color codes from test runners and CLIs, which read as noise in a <pre>.
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g

export function detailOutput(content: unknown): string {
  if (typeof content === 'string') return truncate(content.replace(ANSI, ''))
  if (!Array.isArray(content)) return ''
  const text = content
    .flatMap((b: unknown) =>
      typeof b === 'object' && b !== null && 'type' in b && b.type === 'text' && 'text' in b && typeof b.text === 'string'
        ? [b.text]
        : [],
    )
    .join('\n')
  return truncate(text.replace(ANSI, ''))
}

export const CARD_MAX = 8 * 1024
