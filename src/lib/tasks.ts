import { z } from 'zod'

// An employee's task list, rebuilt from its TodoWrite and Task* tool calls.

const Status = z.enum(['pending', 'in_progress', 'completed'])
export type TaskStatus = z.infer<typeof Status>

// taskId is Claude Code's id for TaskCreate tasks; TodoWrite entries have none.
export const TaskEntrySchema = z.object({
  taskId: z.string().optional(),
  content: z.string(),
  status: Status,
  activeForm: z.string().optional(),
})
export type TaskEntry = z.infer<typeof TaskEntrySchema>

const TodoWriteInput = z.object({
  todos: z.array(z.object({ content: z.string(), status: Status, activeForm: z.string().optional() })),
})
const TaskCreateInput = z.object({ subject: z.string(), activeForm: z.string().optional() })
const TaskUpdateInput = z.object({
  taskId: z.string(),
  subject: z.string().optional(),
  activeForm: z.string().optional(),
  status: z.union([Status, z.literal('deleted')]).optional(),
})
const TaskCreateOutput = z.object({ task: z.object({ id: z.string(), subject: z.string() }) })
const TaskListOutput = z.object({ tasks: z.array(z.object({ id: z.string(), subject: z.string(), status: Status })) })

export type TaskCall =
  | { tool: 'TodoWrite'; todos: TaskEntry[] }
  | { tool: 'TaskCreate'; subject: string; activeForm?: string }
  | { tool: 'TaskUpdate'; taskId: string; subject?: string; activeForm?: string; status?: TaskStatus | 'deleted' }
  | { tool: 'TaskList' }

// Tools that only manage the list. Their activity lines are hidden: the task card shows them.
export const TASK_TOOLS: ReadonlySet<string> = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])

export function parseTaskCall(toolName: string, input: unknown): TaskCall | null {
  switch (toolName) {
    case 'TodoWrite': {
      const p = TodoWriteInput.safeParse(input)
      return p.success ? { tool: 'TodoWrite', todos: p.data.todos } : null
    }
    case 'TaskCreate': {
      const p = TaskCreateInput.safeParse(input)
      return p.success ? { tool: 'TaskCreate', ...p.data } : null
    }
    case 'TaskUpdate': {
      const p = TaskUpdateInput.safeParse(input)
      return p.success ? { tool: 'TaskUpdate', ...p.data } : null
    }
    case 'TaskList':
      return { tool: 'TaskList' }
    default:
      return null
  }
}

// Applied once the call succeeds. result is the tool's structured output
// (SDKUserMessage.tool_use_result), which carries TaskCreate's new id.
export function applyTaskCall(list: readonly TaskEntry[], call: TaskCall, result: unknown): TaskEntry[] {
  switch (call.tool) {
    case 'TodoWrite':
      return call.todos.map(({ content, status, activeForm }) => ({ content, status, ...(activeForm ? { activeForm } : {}) }))
    case 'TaskCreate': {
      const created = TaskCreateOutput.safeParse(result)
      const entry: TaskEntry = { content: call.subject, status: 'pending', ...(call.activeForm ? { activeForm: call.activeForm } : {}) }
      return [...list, created.success ? { taskId: created.data.task.id, ...entry } : entry]
    }
    case 'TaskUpdate': {
      const { status } = call
      if (status === 'deleted') return list.filter((t) => t.taskId !== call.taskId)
      return list.map((t) =>
        t.taskId !== call.taskId
          ? t
          : {
              ...t,
              ...(call.subject !== undefined ? { content: call.subject } : {}),
              ...(call.activeForm !== undefined ? { activeForm: call.activeForm } : {}),
              ...(status !== undefined ? { status } : {}),
            },
      )
    }
    case 'TaskList': {
      const listed = TaskListOutput.safeParse(result)
      if (!listed.success) return [...list]
      const known = new Map(list.flatMap((t) => (t.taskId ? [[t.taskId, t] as const] : [])))
      return listed.data.tasks.map((t) => ({ ...known.get(t.id), taskId: t.id, content: t.subject, status: t.status }))
    }
  }
}

export function taskCounts(list: readonly TaskEntry[]): { done: number; total: number } {
  return { done: list.filter((t) => t.status === 'completed').length, total: list.length }
}
