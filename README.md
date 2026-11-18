# will-bot

A chat UI for a small team of Claude Code employees on your Mac. Each employee is a persistent, named Claude Code session with a job, a memory and a working folder. A Chief of Staff hands work to the others.

Employees run as real Claude Code sessions. They get Claude Code's own system prompt, your settings, plugins, skills, claude.ai connectors, CLAUDE.md files and permission mode, as `claude` would in that folder. will-bot adds the employee's name, job and memory to the end of the prompt, and a chat UI on top.

## Setup

will-bot uses your Claude plan login, not an API key.

1. Log in once with the Claude CLI. Run `claude`, then type `/login` and finish the browser sign-in. The Agent SDK reuses this login.
2. Make sure `ANTHROPIC_API_KEY` is not set in the shell that starts the app. If it is set, the app shows a warning and refuses to run employees.
3. Install and start:

   ```sh
   npm install
   npm run dev
   ```

4. Open http://127.0.0.1:3000.

Other scripts:

- `npm run typecheck` runs `tsc --noEmit`.
- `npm run build` builds for production. `npm start` serves the build on 127.0.0.1.
- `npm test` checks the take-over rules, the session state machine, question answer validation, the model router, the task list, and activity detail truncation.

## Starter employees

The first start creates three employees.

- **Chief of Staff** coordinates the others and gives you short summaries. Its team is every other employee that is not paused. It delegates with Claude Code's Agent tool, using an employee's id as the subagent type. A teammate runs inside the Chief's session with its own job, memory, model and browser setting.
- **Research Bot** researches a topic on the web and writes a short brief with sources to its folder.
- **Builder Bot** makes small code changes in its folder. Its browser and model router are on.

## Per-employee settings

Set these in the details panel.

- **Working folder.** The session's working directory. It must be an absolute path to a folder that exists. The default is `data/workspaces/<id>`. Claude Code keeps conversations per folder, so changing it closes the session and starts a new conversation in the new folder.
- **Model.** Default uses your Claude Code model. Haiku, Sonnet and Opus pick that model. A change applies to the live session at once. With the router on, the field shows Router and is locked.
- **Pick the model per task (pstack table).** Turns on the model router, described below. Off by default, on for Builder Bot.
- **Browser.** Adds the Playwright MCP server (`@playwright/mcp@0.0.84`, headless, isolated profile), writing its output to `<folder>/.playwright`. Off by default, on for Builder Bot.
- **Job and memory.** Both are part of the prompt. An edit reopens the session: at once if it is idle, else when its turn and background work end.

No turn limit is set, as in a Claude Code session.

## Live sessions

Each employee has one long-lived Claude Code session, not one process per message.

- The first message opens it, resuming the saved conversation. Before that message goes in, will-bot waits up to 12 seconds for your claude.ai connectors to connect.
- Later messages join the same session, even while it is working, the way Claude Code takes messages mid-turn. The exceptions are a paused employee and one working for the Chief.
- `POST /api/chat` returns at once. Replies stream on `GET /api/chats/<id>/stream`. Every item is saved to the chat file before it is sent, so a reload shows everything.
- **Stop** interrupts the current turn and keeps the session. **Take over** interrupts, closes the session and pauses the employee. **Hand back** unpauses it. **Delete** closes the session.
- A session closes after 15 minutes idle with no background tasks. The next message reopens it.
- Background agents and shell commands run as they do in Claude Code. Their start and finish show up in the chat.
- Status is **working** while a turn or a background task runs, **needs your answer** while an approval or question waits, **paused** after Take over, and **idle** otherwise.

## Model router

A router employee picks its model for each message from your pstack role table, so one file drives both Claude Code and will-bot.

- **Classifier.** Before a message reaches the session, one small Haiku call sorts it into a task kind: trivial, investigation, feature, refactoring, bug-fix, perf-issue or judgment. It sees the message and the last two chat messages, and runs with no tools, settings or saved session. So routing costs one small Haiku call per message for router employees. The employee shows as working while it routes.
- **Role table.** Each kind maps to a role line in `~/.claude/pstack-models.md`: feature and refactoring to `feature, refactoring`, bug-fix and perf-issue to their own lines, investigation to `how explorer`, judgment to `judgment and prose`. Trivial always runs on Haiku. The first model in the line picks Opus, Sonnet or Haiku. Fable runs on Opus, since Fable needs credits, and the route line says so. A missing file or line falls back to the installed pstack plugin's `models.json`, then to Opus. The file is read on every message, so edits apply at once.
- **Sticky.** A harder kind upgrades the model at once. An easier kind downgrades only when the message starts a new task: the last message is over 30 minutes old, or there is none.
- **Failure.** If the classifier fails or takes over 8 seconds, the model stays as it was and the route line says "Router unavailable". Stop and Take over cancel routing, and the message is not sent.
- **Manual pick.** The composer's model menu picks Haiku, Sonnet or Opus for one message, for any employee. It skips the classifier and resets to Auto after sending. Auto means the router for a router employee and the configured model for anyone else.

Each route shows as one muted line under your message, for example "Opus · feature: add a settings page" or "Kept Opus · trivial: mid-task, no downgrade".

## Task list

When an employee keeps a todo list with Claude Code's TodoWrite or TaskCreate and TaskUpdate tools, the list shows above the composer with a done count, for example "Tasks 3/7". Each task is marked done, in progress or pending. Only the employee's own list shows, not its subagents'. The list hides when it is empty, or when every task is done and the employee is idle. The chat file keeps the latest list for each Claude Code session. The tool calls themselves no longer show as activity lines.

## Activity details

Each activity line opens to show what the tool was given and what it returned: the shell command, the file path, the URL, or the MCP tool input. Edits and writes show removed lines with `- ` and added lines with `+ `. A failed call is marked "Error". Input and output are each cut to 4,000 characters at a line break and saved in the chat file.

## Questions and plans

- **Approvals.** When Claude Code would ask you before a tool call, the chat shows a card worded like Claude Code's own prompt, with the tool input underneath. Approve runs it once. Deny tells the employee you said no.
- **Questions.** When an employee uses AskUserQuestion, the chat shows each question with its options: buttons, or checkboxes for multi-select, plus an Other field. Send answers returns them to the session. Multi-select answers are joined with commas.
- **Plans.** When an employee leaves plan mode, the card shows the plan. Approve lets it start. Keep planning sends it back to plan more.

An unanswered card expires after 10 minutes and counts as a no. Cards live in server memory, so restarting the server expires them.

## Where data lives

Everything is plain files under `./data`:

- `data/bots.json` holds the employee list and settings. Files from older versions still load; settings they lack get their defaults.
- `data/chats/<id>.json` holds each transcript and the Claude Code session id used to resume it.
- `data/memory/<id>.md` holds each employee's memory, one `- YYYY-MM-DD: note` line per entry. You can edit it in the details panel, and employees add to it with their `remember` tool.
- `data/workspaces/<id>/` is each employee's default working folder.

## Safety

Employees run with your Claude Code permissions and settings, exactly like a Claude Code session. Will-bot adds no extra restrictions beyond take-over and the billing guard.

- **Permission mode.** If your settings name a `permissions.defaultMode`, sessions use it. If they do not, sessions run in auto mode, as your desktop sessions do. Whenever Claude Code wants a human, the chat shows the card.
- **Take over.** A PreToolUse hook denies every tool call from a paused or deleted employee, including one working inside the Chief's session. It also denies the Chief's delegation to a paused or deleted employee. Only the employee you are talking to can use `remember`; the Chief's teammates cannot write to its memory.
- **Plan billing only.** Employees refuse to run while `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, or `CLAUDE_CODE_USE_FOUNDRY` is set, and the banner names the variable. The app only checks whether these are set and never reads their values.
- **Environment.** Sessions get the server's environment, as your terminal would give it to `claude`, minus the billing variables and the ones Next and npm set for the server itself (`NODE_ENV`, `NODE_OPTIONS`, `PORT`, `INIT_CWD`, `npm_*`, `NEXT_*`, `__NEXT_*`, `TURBOPACK*`). So SSH agent, proxy and tool variables reach employees, and so does any secret in the shell that starts the server.
- **Localhost only.** The server binds to 127.0.0.1. API requests with a foreign `Host` or `Origin` header are rejected, which blocks DNS rebinding and cross-site posts. Write requests must be `application/json`.

## Known limits

- Teammates run inside the Chief's session. They cannot use `remember`, and their shell commands start from the Chief's folder.
- Stopping or taking over a teammate that is working for the Chief also stops the Chief's turn.
- Sessions load your plugins, and their startup hooks add text to every session's prompt, which costs plan usage.
- Your user settings load, so an `env` block in `~/.claude/settings.json` reaches every employee. Keep API keys out of it.
- Connected tools in the details panel come from a check that starts your Claude setup without a prompt. It takes a few seconds and is cached for 10 minutes.
- If a saved Claude Code session disappears from `~/.claude`, resuming fails. Delete that employee's `data/chats/<id>.json` to start fresh.
- Deleting an employee removes its chat and memory but leaves its working folder on disk.
- No group channel, routines, or "teach a task" yet.
