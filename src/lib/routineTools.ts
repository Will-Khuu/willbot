import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { CREATE_ROUTINE, DELETE_ROUTINE, LIST_ROUTINES, UPDATE_ROUTINE } from './guard'
import { EVERY_HOURS, mayManage, RoutineInputSchema, runWords, SCHEDULE_EXAMPLES, ScheduleSchema, scheduleWords, type Routine } from './routines'
import { publish } from './runtime'
import { createRoutine, deleteRoutine, getBot, readRoutines, updateRoutine } from './store'
import type { Bot, BotId } from './types'

const SCHEDULE_HELP = [
  "When it runs, in this computer's local time with 24-hour HH:MM. One of these shapes:",
  SCHEDULE_EXAMPLES.map((s) => `${JSON.stringify(s)} means ${scheduleWords(s)}`).join('; ') + '.',
  `Weekly day 0 is Sunday through 6 Saturday. Every takes hours ${EVERY_HOURS.join(', ')}.`,
].join(' ')

const PROMPT_HELP =
  'The message you will receive on each run. Each run may start a fresh conversation, so write complete, standalone instructions: what to do, where, and the lessons and preferences learned in this conversation.'

function text(t: string, isError = false) {
  return { content: [{ type: 'text' as const, text: t }], ...(isError ? { isError } : {}) }
}

function view(r: Routine, now: Date) {
  return {
    id: r.id,
    employee: r.botId,
    name: r.name,
    schedule: scheduleWords(r.schedule),
    nextRun: r.nextRunAt ? runWords(new Date(r.nextRunAt), now) : null,
    enabled: r.enabled,
    prompt: r.prompt.length > 200 ? `${r.prompt.slice(0, 200)}…` : r.prompt,
  }
}

const json = (v: unknown) => JSON.stringify(v, null, 2)

// The routines panel and roster of both employees refresh on this.
function changed(ownerId: BotId, botId: BotId): void {
  for (const id of new Set([ownerId, botId])) publish(id, { type: 'routines' })
}

// team is the Chief's team; empty for everyone else, so they reach only their own.
export function routineTools(bot: Bot, team: ReadonlySet<BotId>) {
  const chief = team.size > 0
  const employee = z
    .string()
    .optional()
    .describe(chief ? "A teammate's employee id, to act for them. Omit it for your own routines." : 'Omit it; you manage only your own routines.')

  const resolve = (id: string | undefined): { botId: BotId } | { error: string } => {
    const botId = id ?? bot.id
    if (mayManage(bot.id, team, botId) && getBot(botId)) return { botId }
    return { error: chief ? `No teammate with id "${botId}". Teammates: ${[...team].join(', ')}.` : 'You can manage only your own routines.' }
  }
  const owned = (id: string): Routine | null => readRoutines().find((r) => r.id === id && mayManage(bot.id, team, r.botId)) ?? null
  const missing = (id: string) => text(`No routine with id "${id}" that you manage. Use list_routines to see the ids.`, true)

  return [
    tool(
      'list_routines',
      "List will-bot routines: scheduled messages that will-bot sends you on their own, even when no conversation is open.",
      { employee },
      async (args) => {
        const who = resolve(args.employee)
        if ('error' in who) return text(who.error, true)
        const now = new Date()
        const mine = readRoutines().filter((r) => r.botId === who.botId)
        return text(mine.length ? json(mine.map((r) => view(r, now))) : 'No routines yet.')
      },
    ),
    tool(
      'create_routine',
      'Create a will-bot routine: will-bot sends the prompt to you on the schedule, as long as will-bot is open. Routines persist and show in the user\'s panel. Use this for any recurring or scheduled work, never CronCreate or ScheduleWakeup.',
      {
        name: RoutineInputSchema.shape.name.describe('Short name the user sees, for example "Email-to-tracker sync".'),
        prompt: RoutineInputSchema.shape.prompt.describe(PROMPT_HELP),
        schedule: ScheduleSchema.describe(SCHEDULE_HELP),
        employee,
      },
      async ({ employee: id, ...input }) => {
        const who = resolve(id)
        if ('error' in who) return text(who.error, true)
        const now = new Date()
        const routine = createRoutine(who.botId, input, now)
        changed(bot.id, who.botId)
        return text(`Created. Next run: ${view(routine, now).nextRun}.\n${json(view(routine, now))}`)
      },
    ),
    tool(
      'update_routine',
      'Change one of your will-bot routines. Pass only the fields to change; enabled false pauses it and true resumes it.',
      {
        id: z.string(),
        name: RoutineInputSchema.shape.name.optional(),
        prompt: RoutineInputSchema.shape.prompt.optional().describe(PROMPT_HELP),
        schedule: ScheduleSchema.optional().describe(SCHEDULE_HELP),
        enabled: z.boolean().optional(),
      },
      async ({ id, ...patch }) => {
        const routine = owned(id)
        if (!routine) return missing(id)
        const now = new Date()
        const updated = updateRoutine(id, patch, now)
        if (!updated) return missing(id)
        changed(bot.id, updated.botId)
        return text(`Updated. Next run: ${view(updated, now).nextRun ?? 'none, it is off'}.\n${json(view(updated, now))}`)
      },
    ),
    tool('delete_routine', 'Delete one of your will-bot routines.', { id: z.string() }, async ({ id }) => {
      const routine = owned(id)
      if (!routine || !deleteRoutine(id)) return missing(id)
      changed(bot.id, routine.botId)
      return text(`Deleted "${routine.name}".`)
    }),
  ]
}

function routineName(input: Record<string, unknown>): string {
  const r = readRoutines().find((x) => x.id === input.id)
  return r ? `'${r.name}'` : 'a routine'
}

function scheduleOf(input: Record<string, unknown>): string | null {
  const parsed = ScheduleSchema.safeParse(input.schedule)
  return parsed.success ? scheduleWords(parsed.data) : null
}

// Read when the call starts, so update and delete still find the routine's name.
export const ROUTINE_ACTIVITY: Record<string, (input: Record<string, unknown>) => string> = {
  [LIST_ROUTINES]: () => 'Checked routines',
  [CREATE_ROUTINE]: (i) => {
    const when = scheduleOf(i)
    return `Scheduled '${typeof i.name === 'string' ? i.name : 'a routine'}'${when ? ` · ${when}` : ''}`
  },
  [UPDATE_ROUTINE]: (i) => {
    const verb = i.enabled === false ? 'Paused' : i.enabled === true ? 'Resumed' : 'Changed'
    const when = scheduleOf(i)
    return `${verb} ${routineName(i)}${when ? ` · ${when}` : ''}`
  },
  [DELETE_ROUTINE]: (i) => `Deleted ${routineName(i)}`,
}
