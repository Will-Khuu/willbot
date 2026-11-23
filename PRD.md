# PRD: will-bot, a team of Claude Code employees

Status: v2, describes the product as built (November 2026). The v1 plan and what changed are summarized in section 13. README.md is the operating guide; this file is the "what and why".

## 1. Summary

will-bot is a local web app for running a small team of persistent AI "employees", in the style of Grok Bot. Each employee has a name, a job, its own memory and a working folder. Underneath, each employee is a real Claude Code session with the user's own setup. will-bot is the team layer around those sessions: a roster, a chat per employee, a coordinator, schedules, approvals and a details panel.

Design principle: employees work exactly like a Claude Code session. will-bot's job is UI and usability, not a different agent.

## 2. Goals

- Run on the user's Mac, always available at http://127.0.0.1:3000 while they are logged in.
- Create and talk to named employees, each with a persistent job, memory and folder.
- Employees have the same capabilities as the user's Claude Code: plugins, skills, claude.ai connectors (Gmail, Drive, Sheets, Notion and others), CLAUDE.md files, models and permission settings.
- A Chief of Staff that delegates work to the other employees.
- Recurring work: any employee can be asked to automate a task, and it keeps running on schedule.
- The user can see and steer everything: live activity, approvals, questions, plans, task lists and usage.
- Billing stays on the user's Claude plan, never an API key.

## 3. Non-goals

- Multi-user support, accounts or hosting. The server is reachable only from the user's own browser.
- A phone layout, and a group channel where employees talk to each other.
- Guardrails beyond Claude Code's own. will-bot does not add a workspace jail or extra approval rules.
- A separate computer per employee. All employees share the user's Mac.

## 4. Authentication and cost

- Employees use the user's Claude plan login from the `claude` CLI, through the Claude Agent SDK.
- will-bot refuses to run any employee while a variable or setting would bill the API instead of the plan. That covers `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, the Bedrock, Vertex and Foundry switches, and an `apiKeyHelper` in the Claude settings files. The UI shows a banner naming the cause.
- Plan limits are visible: a usage meter shows the 5-hour and weekly windows, from the rate-limit figures Claude Code reports on each reply. When a limit is reached, Send is disabled until the reset.
- The model router keeps simple tasks on cheaper models (section 8.5).

## 5. Tech stack

- Next.js (App Router) + TypeScript, plain CSS with design tokens, light and dark themes.
- `@anthropic-ai/claude-agent-sdk` for live Claude Code sessions. `zod` at every boundary.
- Plain files under `./data`; no database. Files are owner-only (0600).
- Optional: `@playwright/mcp` (pinned, run with npx) for employees that need a browser.
- A macOS LaunchAgent runs the production server in the background.

## 6. Core concepts

- **Employee.** `{ id, name, job, folder, extraFolders, model, router, browser, hire, paused, builtin }` in `data/bots.json`.
- **Session.** One live Claude Code session per employee, held open while in use and closed after 15 minutes idle. It uses Claude Code's own system prompt plus an employee block (name, job, memory, team), and the user's settings, plugins and connectors. Conversations resume across restarts.
- **Memory.** `data/memory/<id>.md`, one dated line per entry, editable in the UI. The employee adds to it with a `remember` tool.
- **Chat.** `data/chats/<id>.json`: messages, activity, cards and the session id.
- **Routine.** A saved message sent to an employee on a schedule, in `data/routines.json`.
- **Chief of Staff.** A built-in employee whose teammates are available to it as subagents.
- **Dr Egg.** A built-in employee that designs and hires new employees, each hire confirmed by the user.

## 7. Starter employees

1. **Chief of Staff** coordinates the others and gives short summaries.
2. **Research Bot** researches on the web and writes briefs with sources.
3. **Builder Bot** does coding work. It is the user's pstack employee, with the browser and model router on.
4. **Dr Egg** asks a few preference questions, then proposes new employees for the user to approve.

The team is capped at 20 employees.

## 8. Functional requirements

### 8.1 Roster and chat

- The sidebar lists employees with an avatar, the last message, a relative time, an unread dot and a status: working, needs your approval, paused or idle. Search filters by name, job and message.
- The chat shows the user's messages and the employee's replies as bubbles. Tool use appears as activity cards; each line expands to show its input and output (commands, edits as before/after lines, connector input).
- Messages can be sent while an employee is working; they join the running task, as in Claude Code.
- The message box wraps text and grows. Enter sends, Shift+Enter adds a new line. It also has attachments, dictation and a per-message model picker.
- Stop interrupts the current task and cancels messages still queued behind it.

### 8.2 Cards

- **Approvals.** When Claude Code's permission system wants the user, the request shows as a card (Approve / Not yet), with a 10-minute timeout.
- **Questions.** A multiple-choice question shows as a card with option buttons and an Other field.
- **Plans.** A proposed plan shows as a card to approve or send back.
- **Task list.** An employee's to-do list is pinned above the message box with live progress.

### 8.3 Context

- Attachments by button, drag-and-drop or paste. Images go to the employee as images; other files are saved to its folder and referenced. Up to 20 MB per file and 10 per message.
- `@` mentions list matching files from the employee's folders.
- Each employee has a working folder, chosen with the macOS Finder picker or typed, plus extra folders it can also access.

### 8.4 Delegation

- The Chief of Staff delegates with Claude Code's Agent tool, using an employee id as the subagent type. The delegated employee shows as "working for Chief of Staff", and its activity appears in the Chief's chat.
- The team list reaches the Chief's prompt as quoted data, not instructions.

### 8.5 Model router

- Per employee (on for Builder Bot). A small Haiku call sorts each message into a pstack task kind: trivial, investigation, feature, refactoring, bug-fix, perf-issue or judgment.
- The model comes from the user's `~/.claude/pstack-models.md` role table, falling back to pstack's defaults. Fable maps to Opus, since the account needs credits for Fable.
- The router is sticky: it moves up a tier any time, and down only when a new task starts (30 minutes since the last message). A manual pick always wins. Each decision shows as a line in the chat.

### 8.6 Routines

- Schedules: daily, weekdays, weekly, or every N hours, in local time across daylight-saving changes.
- The user manages routines in the details panel. Employees create, change and delete their own routines when asked to automate something; the Chief can manage its teammates' routines.
- Claude Code's own session schedulers (CronCreate, ScheduleWakeup) are redirected to routines, because will-bot closes idle sessions.
- A run missed while will-bot was stopped or the Mac slept runs once when will-bot is back, and the employee is told it is late. A run is skipped, with the reason shown, when the employee is paused, the plan limit is reached, it is working for the Chief, or billing would go to the API.
- Only one server process runs routines, enforced by a lock file.

### 8.7 Take over

- Take over pauses an employee within seconds, including when it is working for the Chief. The banner reads "You are driving. The bot is paused until you hand control back." The user can then edit its job, memory and settings. Hand back resumes it.

### 8.8 Details panel and Plugins

- The right panel shows the employee's "screen" (its latest browser screenshot, or its folder's recent files), routines, job, memory, settings, folders and connected tools. Share copies the chat as markdown.
- The Plugins view lists the user's plugins, connectors and skills, read-only.

### 8.9 Always on

- `npm run background -- install` installs a login item that runs will-bot in the background and restarts it if it crashes. `restart` rebuilds after code changes; `uninstall` removes it.

## 9. UI requirements

- Desktop three-column layout: sidebar, chat, right panel. A bright macOS look with a dark mode, following the user's reference screenshot. Original avatars, one color and initial per employee.
- Real buttons, 44px touch targets, 4.5:1 text contrast, labels on icon buttons, reduced motion respected.

## 10. API (summary)

- Employees: `GET/POST /api/bots`, `PATCH/DELETE /api/bots/[id]`.
- Chat: `GET /api/chats/[id]`, `GET /api/chats/[id]/stream` (SSE), `POST /api/chat`, `POST /api/chat/stop`.
- Decisions: `GET /api/approvals`, `POST /api/approvals/[id]`, `POST /api/questions/[id]`.
- Memory: `GET/PUT /api/memory/[id]`.
- Routines: `GET/POST /api/routines`, `PATCH/DELETE /api/routines/[id]`, `POST /api/routines/[id]/run`.
- Context: `POST /api/attachments`, `GET /api/attachments/file`, `GET /api/files`, `POST /api/pick-folder`.
- Info: `GET /api/health`, `/api/usage`, `/api/capabilities`, `/api/screen`, `/api/workspace`.

## 11. Safety

Employees run with the user's Claude Code permissions and settings, exactly like a Claude Code session. will-bot adds only what its own features need:

- **Take over and delete** block a paused or removed employee's tool calls immediately.
- **will-bot's own tools.** `remember`, `hire` and the routine tools are refused for subagents, so content an employee reads cannot use them through a helper agent. Every hire needs the user's approval on a card.
- **Billing guard,** as in section 4.
- **Localhost only.** The server binds to 127.0.0.1. It refuses requests with a foreign Host or Origin, and cross-site requests via Sec-Fetch-Site. Writes must be JSON.
- **Untrusted text.** Employee names cannot inject into the folder picker's AppleScript. Plan cards read only Claude Code's plans folder. Card bodies are capped at 8 KB.
- Data files are owner-only. Secrets are never logged by will-bot itself; tool output an employee produces is stored in its chat file.

Two three-model reviews (Opus, Sonnet, Haiku) checked these rules; every finding chosen for action was fixed and verified.

## 12. Acceptance criteria

- `npm install && npm run dev` starts the app with no API key set, and `npm run background -- install` keeps it running from login.
- An employee remembers what it was told across a restart.
- Asking the Chief for a research brief delegates to Research Bot, and the brief appears in its folder.
- Taking over a working employee stops it within a couple of seconds.
- Asking an employee to "do this every day at 9 AM" creates a routine that runs on schedule, or catches up after sleep.
- An employee can use the user's plugins, skills and connectors, and asks through a card when Claude Code's permissions require it.
- `npm run typecheck`, `npm test` and `npm run build` pass.
- With a billing variable or setting present, the UI shows the warning and employees do not run.

## 13. History: v1 plan versus what was built

The v1 plan (initial PRD) described sandboxed bots: a custom system prompt, a folder jail, fixed tool lists, Haiku workers with an 8-turn cap, and an approval card for every shell command. During the build the user set a new direction: employees should work exactly like their Claude Code sessions, with will-bot as the UI. The main changes:

- Bots became live Claude Code sessions with Claude Code's own prompt, settings, plugins and connectors. The custom policy layer was removed.
- Approvals follow Claude Code's permissions (auto mode by default), not a fixed will-bot list.
- Added: the model router, routines (v1 "later"), the usage meter (v1 "later"), attachments and @ mentions, folders, the task list, question and plan cards, the background service, Dr Egg, and the redesign from the user's reference screenshot.
- Still deferred: the group channel, a phone layout, and automatic text copies of Word documents.
