import { z } from 'zod'
import { error, parseBody, type IdParams } from '@/lib/http'
import { answersSchema } from '@/lib/questions'
import { answerQuestion, pendingQuestions } from '@/lib/runtime'

const Answer = z.object({ answers: z.record(z.string(), z.unknown()) })

export async function POST(req: Request, { params }: IdParams) {
  const id = (await params).id
  const body = await parseBody(req, Answer)
  if (body instanceof Response) return body
  const questions = pendingQuestions(id)
  if (!questions) return error(404, 'That question is no longer pending.')
  const parsed = answersSchema(questions).safeParse(body.answers)
  if (!parsed.success) return error(400, parsed.error.issues.map((i) => i.message).join('; '))
  answerQuestion(id, parsed.data)
  return Response.json({ ok: true })
}
