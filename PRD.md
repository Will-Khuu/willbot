# PRD: will-bot — a local bot manager built on the Claude Agent SDK

## 1. Summary
will-bot is a local web app for creating and managing a small team of persistent AI "bots". Each bot has a name, a job, and its own memory. A Chief of Staff bot coordinates the others. Bots ask for approval before risky actions. The UI is a chat-style control panel (bot roster, chat, details panel), similar in spirit to Grok Bot.

Mockup (visual reference, interactive): https://claude.ai/artifact/JsDbN2zANLTJ26kib8k8Vu

## 2. Goals
- Run entirely on my Mac, started with `npm run dev`.
- Create, view and talk to multiple bots, each with a persistent job and memory.
- A Chief of Staff bot that delegates work to the other bots.
- Human approval before any risky action.
- Stay cheap on usage: this runs on my Claude Pro subscription (see section 4).

## 3. Non-goals (v1)
- No multi-user support, accounts, or hosting.
- No group channel, scheduled routines, or "teach a task" recording (later versions).
- No separate cloud computer per bot. All bots share this machine, each limited to its own workspace folder.

## 4. Authentication and cost (important)
- Use my Claude Pro login, NOT an API key. Log in once with `claude` then `/login`. The Agent SDK reuses that login.
- The app must NOT read or require ANTHROPIC_API_KEY. At server start, if ANTHROPIC_API_KEY is set, show a visible warning in the UI ("API key set: usage will be billed to the API, not your plan") and do not silently proceed.
- Pro limits are small. Keep usage low: default to a small, fast model for worker bots, keep prompts short, cap turns per run (maxTurns), and keep v1 to the three starter bots below.
- Verify the current rules for Agent SDK use with a Claude plan at https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan before building, since they have changed before.

## 5. Tech stack
- Next.js (App Router) + TypeScript, plain CSS (no UI framework needed).
- `@anthropic-ai/claude-agent-sdk` for the agent loop. Check its current docs for exact option names before using them.
- `zod` for validation.
- Storage: plain files under `./data` (no database).
- The folder already has a partial `npm install` from an interrupted run (package.json, node_modules). Run `npm install` to finish, then add dev dependencies (typescript, @types/node, @types/react, @types/react-dom) if missing.

## 6. Core concepts
- **Bot**: `{ id, name, job, status, tools, createdAt }` stored in `data/bots.json`.
- **Memory**: one markdown file per bot at `data/memory/<id>.md`. Loaded into the bot's system prompt every run. Bots add to it through a `remember` tool.
- **Workspace**: each bot gets its own folder `data/workspaces/<id>/`. File tools are restricted to it.
- **Chat**: the conversation with one bot, stored at `data/chats/<id>.json`, including the SDK session id so the conversation can be resumed.
- **Chief of Staff**: a built-in bot. The other bots are exposed to it as subagents so it can delegate with the SDK's subagent support.
- **Approval**: a pending request shown in the chat. The run is paused until I click Approve or Not yet.

## 7. Starter bots (seeded on first run)
1. **Chief of Staff**: coordinates the others and gives me short summaries.
2. **Research Bot**: researches a topic with the web tools and writes a short brief with sources to its workspace.
3. **Builder Bot**: makes small code changes inside its workspace folder only.
Do not seed an email bot in v1.

## 8. Functional requirements

### 8.1 Bots
- List bots in a sidebar with a name, a one-line status, and a status dot (working, idle, needs approval).
- Create a bot from a form: name and job. Edit job and delete a bot.
- Selecting a bot opens its chat.

### 8.2 Chat and running agents
- Send a message to a bot. The server runs the Agent SDK `query()` with:
  - system prompt = bot job + its memory file + a short rule list (ask before risky actions, keep replies short);
  - `cwd` = the bot's workspace folder;
  - `resume` = the saved session id, when one exists;
  - a small `maxTurns`.
- Stream the run to the browser (Server-Sent Events). Show assistant text as chat bubbles and tool use as activity cards ("Opened 3 pages", "Wrote brief.md").
- Save the transcript and session id after each run.
- A Stop button aborts the current run.

### 8.3 Memory
- Provide a custom in-process tool `remember(note)` (via the SDK's in-process MCP server support) that appends a dated line to the bot's memory file.
- The details panel shows the memory as an editable list. I can delete or edit entries.

### 8.4 Chief of Staff delegation
- Build the Chief's subagent definitions from the current bots (name, job, memory summary, allowed tools).
- The Chief can delegate to any bot. While a delegated bot works, show it as "working" in the roster and show its activity under the Chief's chat.

### 8.5 Approvals
- Use the SDK's `canUseTool` callback. Read-only tools (read files in workspace, web search) are auto-allowed.
- Risky actions need approval: any shell command, any write outside the bot's workspace, deleting files, any network action that changes something, and any `send`/`post` style tool.
- When approval is needed, store the pending request, show an approval card in the chat with the exact action, and wait. Approve resolves to allow, "Not yet" resolves to deny with a reason the bot can read.
- An approval has a timeout (10 minutes), after which it is denied.

### 8.6 Take over
- A "Take over" button pauses the bot (aborts the current run, keeps the session). The banner reads: "You are driving. The bot is paused until you hand control back." While taken over, I can edit its memory and job. "Hand back" resumes normal operation.

## 9. UI requirements (match the mockup)
- Three columns: roster sidebar (268px), chat (flexible), details panel (304px).
- Details panel: job, connected tools, memory, routines (empty state in v1), autonomy rule.
- Calm warm-neutral palette, Inter font, clay accent color (#b4502f) for user bubbles and the Send button.
- All buttons are real `<button>` elements with at least 44px touch targets; text meets 4.5:1 contrast; icon-only buttons have aria-labels.
- Works at laptop width; panels may collapse on narrow screens.

## 10. API routes (suggested)
- `GET /api/bots`, `POST /api/bots`, `PATCH /api/bots/[id]`, `DELETE /api/bots/[id]`
- `GET /api/chats/[id]`
- `POST /api/chat` (body: botId, message) streams SSE events
- `POST /api/chat/stop`
- `GET /api/approvals`, `POST /api/approvals/[id]` (body: allow | deny)
- `GET/PUT /api/memory/[id]`

## 11. Safety
- Bots only read and write inside their own workspace folder. Reject path escapes (`..`, absolute paths, symlinks out).
- No shell access without approval.
- Never log secrets. Never read `.env*` files from any bot.
- The server binds to localhost only.

## 12. Milestones
1. Scaffold the app, finish install, typecheck passes, seed the three bots, build the static UI from the mockup.
2. Single-bot chat: run `query()` with streaming, save transcripts and sessions, Stop button.
3. Memory file plus the `remember` tool and the editable memory list.
4. Approvals via `canUseTool` with approval cards.
5. Chief of Staff delegating to the other bots as subagents.
6. Take over, polish, and a short README.

## 13. Acceptance criteria
- `npm install && npm run dev` starts the app on localhost with no API key set.
- I can create a bot, chat with it, close the app, reopen it, and the bot remembers what I told it.
- Asking the Chief of Staff for a research brief makes it delegate to Research Bot, and a brief file appears in that bot's workspace.
- A bot trying to run a shell command shows an approval card and does nothing until I click Approve.
- Take over stops a running bot within a couple of seconds.
- `npm run typecheck` and `npm run build` pass.
- If ANTHROPIC_API_KEY is set, the UI shows the billing warning.

## 14. Later (out of scope now)
Group channel, scheduled routines, "teach a task", more tools (Gmail, Calendar, GitHub), usage meter, and a phone layout.

## 15. Instructions for Claude Code
- Read this whole file first, then propose a short plan before writing code.
- Check the current Agent SDK docs for exact option names (systemPrompt, agents, canUseTool, mcpServers, resume, maxTurns) rather than relying on memory.
- Build milestone by milestone and run `npm run typecheck` after each.
- Ask me before adding any dependency beyond those listed in section 5.
