import { z } from 'zod'

export const QuestionSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string() })).min(1),
  multiSelect: z.boolean().default(false),
})
export type Question = z.infer<typeof QuestionSchema>
export type Answers = Record<string, string>

const QuestionsInput = z.object({ questions: z.array(QuestionSchema).min(1) })

// AskUserQuestion's input, or null when it is not the shape the card renders.
export function parseQuestions(input: Record<string, unknown>): Question[] | null {
  const parsed = QuestionsInput.safeParse(input)
  return parsed.success ? parsed.data.questions : null
}

// Answers are keyed by question text, one non-empty string per question.
// A multi-select answer is its labels joined with ", "; "Other" is free text,
// so the value itself is not checked against the options.
export function answersSchema(questions: Question[]): z.ZodType<Answers> {
  const shape = Object.fromEntries(
    questions.map((q) => [q.question, z.string().trim().min(1, `Answer "${q.header}".`).max(2000)]),
  )
  return z.strictObject(shape) as unknown as z.ZodType<Answers>
}
