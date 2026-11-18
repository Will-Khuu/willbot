import { z } from 'zod'

// A name reaches osascript argv and every employee's prompt, so it must not
// read as an option or carry line breaks.
export const BotNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(40, 'Names are at most 40 characters.')
  .refine((n) => !n.startsWith('-'), 'A name cannot start with "-".')
  .refine((n) => !/\p{Cc}/u.test(n), 'A name cannot contain control characters.')
