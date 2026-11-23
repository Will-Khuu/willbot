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
- `npm test` checks the take-over rules, the session state machine, question answer validation, the model router, the task list, activity detail truncation, plan usage parsing, routine scheduling and ownership, attachment names and path checks, the file search filter and score, and extra folder validation.

## Run it in the background

will-bot can run as a macOS login item, so it is always at http://127.0.0.1:3000 while you are logged in and routines fire on time:

```bash
npm run background -- install     # build, start now, and start at every login
npm run background -- restart     # after pulling or changing code: rebuild and restart
npm run background -- status
npm run background -- logs        # last 50 lines of ~/Library/Logs/will-bot.log
npm run background -- uninstall   # stop it and remove the login item
```

It runs `next start` as a LaunchAgent (`~/Library/LaunchAgents/com.willbot.app.plist`) that restarts it if it crashes. For development, run `npm run dev -- -p 3001` next to it; the background server keeps running routines.

## Starter employees

The first start creates four employees.

- **Chief of Staff** coordinates the others and gives you short summaries. Its team is every other employee that is not paused. It delegates with Claude Code's Agent tool, using an employee's id as the subagent type. A teammate runs inside the Chief's session with its own job, memory, model and browser setting.
- **Research Bot** researches a topic on the web and writes a short brief with sources to its folder.
- **Builder Bot** makes small code changes in its folder. Its browser and model router are on.
- **Dr Egg** designs new employees. It asks you a few preference questions, then hires them with its `hire` tool. It talks casually, in short lowercase messages, and turns the router on for coding employees. Can hire is on.

## Per-employee settings

Set these in the right panel. The screen button in the chat header shows or hides it, and the details button opens it at the job.

- **Working folder.** The session's working directory. Type an absolute path, or use **Choose folder…**. The default is `data/workspaces/<id>`. Claude Code keeps conversations per folder, so changing it closes the session and starts a new conversation in the new folder.
- **Also has access to.** Extra folders, described under Folders and context.
- **Model.** Default uses your Claude Code model. Haiku, Sonnet and Opus pick that model. A change applies to the live session at once. With the router on, the field shows Router and is locked.
- **Pick the model per task (pstack table).** Turns on the model router, described below. Off by default, on for Builder Bot.
- **Can hire new employees.** Gives the employee a `hire` tool that adds an employee with a name, job, model, browser and router setting. You confirm each hire on a card; the new employee then shows in the roster, and the Chief's team includes it. The team still stops at 20. Off by default, on for Dr Egg. A change reopens the session.
- **Browser.** Adds the Playwright MCP server (`@playwright/mcp@0.0.84`, headless, isolated profile), writing its output to `<folder>/.playwright`. Off by default, on for Builder Bot.
- **Job and memory.** Both are part of the prompt. An edit reopens the session: at once if it is idle, else when its turn and background work end.

No turn limit is set, as in a Claude Code session.

## Folders and context

Give an employee folders and files the way you do in a Claude Code desktop session.

- **Folder picker.** **Choose folder…** and **Add folder…** open the macOS folder dialog, starting in the working folder. Cancel leaves everything as it was.
- **Extra folders.** "Also has access to" lists folders the session can use beside its working folder, as Claude Code's `--add-dir` does. Each must be an absolute path to a folder that exists, up to 20. A change reopens the session like a job edit, and the conversation continues: extra folders do not change the session's project. The Chief also gets every teammate's folders, since teammates run inside its session. A folder deleted later is skipped.
- **Attachments.** Attach files with the + button in the composer, by dropping them on the chat, or by pasting an image. Each shows as a file card above the composer while it uploads; × removes it. Up to 10 files per message, 20 MB each. A file is saved to `<working folder>/.will-bot/attachments/<yyyymmdd-hhmmss>-<name>`, with the name reduced to letters, digits, dots, dashes and underscores. The message tells Claude Code `Attached file: <path>` for each, so it can read any of them. PNG, JPEG, GIF and WebP images also go in as images, which Claude Code scales down as it does for a pasted screenshot.
- **Sent attachments.** Your message shows each file as a card with its type, name and size, and images with a thumbnail. Thumbnails come only from the employee's current attachments folder, so after a working folder change older ones no longer show.
- **@-mentions.** Type `@` in the composer to list files from the working folder and extra folders that match what follows it. Arrow keys move, Enter or Tab picks, Escape closes. A pick inserts `@<absolute path>`, quoted if it has spaces, and Claude Code reads that file into the message as it does in a terminal session. The search looks at up to 5,000 entries, nearest first, and skips `node_modules`, `.git`, `.next`, `dist`, `build` and dot-folders, except `.will-bot/attachments`. It shows the best 20 matches: a name that starts with the text, then a name that contains it, then a path that contains it, then the letters in order.

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

## Routines

A routine is a saved message that will-bot sends to an employee on a schedule. Add one in the details panel with a name, what it should do, and a schedule.

- **Schedules.** Daily, Weekdays (Monday to Friday) or Weekly at a time, or every 1, 2, 3, 4, 6, 8 or 12 hours. Times are in your computer's local time and keep their clock time across daylight saving changes. "Every N hours" counts from the last run, or from when you created the routine.
- **Same as a message from you.** The chat shows "Routine · Evening summary", then the message. The router, approvals, questions and the task list behave as they do for any message. If the employee is working, the message joins the turn.
- **Only while will-bot runs.** The server checks every 30 seconds, so routines need will-bot running and the Mac awake. Run it in the background (below) so it is always up while you are logged in. A run that came due while will-bot was stopped or the Mac slept runs once as soon as will-bot is back, and the employee is told it is running late. A backlog never runs more than once.
- **One server runs routines.** A lock in `data/scheduler.lock` lets only one will-bot server run them, so a second copy (for example a dev server) cannot fire them twice.
- **Skips.** A routine does not run while you have taken over the employee, while the employee is working for the Chief, while a plan limit with a known reset time holds, or while a billing variable is set. The row says why, and the routine waits for its next time.
- **Run now** sends it at once through the same checks and leaves the schedule as it was. The switch turns a routine off without deleting it.
- **Roster.** An idle employee with a routine on shows the next one, for example "Idle · next: Evening summary 6 PM".
- **Employees make their own.** Ask an employee to automate something and it creates the routine itself with its `list_routines`, `create_routine`, `update_routine` and `delete_routine` tools, without an approval card. The chat logs each change, for example "Scheduled 'Email-to-tracker sync' · Every day at 12:00 AM", and the panel and roster update. An employee manages only its own routines; the Chief can also manage its teammates'. Subagents cannot use these tools.
- **Session schedules are redirected.** Claude Code's own `CronCreate`, `CronDelete`, `CronList` and `ScheduleWakeup` live inside one session, and will-bot closes idle sessions, so those jobs would be lost. will-bot denies them and points the employee to its routine tools instead.

## Activity details

Each activity line opens to show what the tool was given and what it returned: the shell command, the file path, the URL, or the MCP tool input. Edits and writes show removed lines with `- ` and added lines with `+ `. A failed call is marked "Error". Input and output are each cut to 4,000 characters at a line break and saved in the chat file.

## Questions and plans

- **Approvals.** When Claude Code would ask you before a tool call, the chat shows a card worded like Claude Code's own prompt, with the tool input underneath. Approve runs it once. Deny tells the employee you said no.
- **Questions.** When an employee uses AskUserQuestion, the chat shows each question with its options: buttons, or checkboxes for multi-select, plus an Other field. Send answers returns them to the session. Multi-select answers are joined with commas.
- **Plans.** When an employee leaves plan mode, the card shows the plan. Approve lets it start. Keep planning sends it back to plan more.

An unanswered card expires after 10 minutes and counts as a no. Cards live in server memory, so restarting the server expires them.

## Usage meter

The bottom of the roster shows how much of your Claude plan is used.

- **Source.** Every model call reports the plan's rate limits, from employees and from the router's classifier. There is no way to ask on demand, so the meter shows what the latest call reported. It reads "Usage shows after the first message." until then.
- **Rows.** "5-hour" and "Weekly" each show a bar, a percent and the reset time. The bar turns amber at 70% and red above 90%, with "Getting close", "Almost out" or "Limit reached" in text. "Updated 3 min ago" says how old the numbers are. The narrow roster shows one ring; its label reads the full status.
- **Limit reached.** When a call is refused, or a turn fails with Claude Code's "You've hit your 5-hour limit" error, a banner across the chat says when employees can work again, and Send is off until then. Stop and Take over still work. If the reset time is unknown, the banner shows but Send stays on.
- **Updates.** The UI asks `GET /api/usage` every 15 seconds while an employee is working, every 60 seconds otherwise, and when a turn ends.

## Where data lives

Everything is plain files under `./data`:

- `data/bots.json` holds the employee list and settings. Files from older versions still load; settings they lack get their defaults.
- `data/chats/<id>.json` holds each transcript and the Claude Code session id used to resume it.
- `data/memory/<id>.md` holds each employee's memory, one `- YYYY-MM-DD: note` line per entry. You can edit it in the details panel, and employees add to it with their `remember` tool.
- `data/workspaces/<id>/` is each employee's default working folder.
- `data/usage.json` holds the last plan usage, so a restart still shows it.
- `data/routines.json` holds every routine with its schedule, next run and last outcome.
- `<working folder>/.will-bot/attachments/` holds the files you attach. will-bot never deletes them.

## Safety

Employees run with your Claude Code permissions and settings, exactly like a Claude Code session. Will-bot adds no extra restrictions beyond take-over, the billing guard and the rules for its own tools.

- **Permission mode.** If your settings name a `permissions.defaultMode`, sessions use it. If they do not, sessions run in auto mode, as your desktop sessions do. Whenever Claude Code wants a human, the chat shows the card.
- **Take over.** A PreToolUse hook denies every tool call from a paused or deleted employee, including one working inside the Chief's session. It also denies the Chief's delegation to a paused or deleted employee.
- **Will-bot's own tools.** Only the employee you are talking to can use `remember` and `hire`. No subagent can, whether a teammate or a generic one, because a subagent may be acting on what it read. `hire` checks the Can hire switch on every call, so turning it off takes effect at once.
- **Hire confirmation.** Every hire shows a card with the name, job, model, browser and router, in every permission mode. The employee is created only when you approve. Other employees' names and jobs reach a prompt only as quoted data, never as instructions.
- **Plan files.** A plan card reads the plan file only from Claude Code's `plans` folder (`~/.claude/plans`, or under `CLAUDE_CONFIG_DIR`), after resolving links, and only under 200 KB. Otherwise it shows the plan text or the tool input. Every card's text is cut to 8 KB.
- **Plan billing only.** Employees refuse to run while `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, or `CLAUDE_CODE_USE_FOUNDRY` is set, or while an `apiKeyHelper` is configured. The check covers the server's environment and the `env` block of your Claude Code settings: user settings, plus the project and local settings of the employee's folder. The banner checks your home folder's settings and names what it found. The app only checks whether these are set and never reads their values.
- **Environment.** Sessions get the server's environment, as your terminal would give it to `claude`, minus the billing variables and the ones Next and npm set for the server itself (`NODE_ENV`, `NODE_OPTIONS`, `PORT`, `INIT_CWD`, `npm_*`, `NEXT_*`, `__NEXT_*`, `TURBOPACK*`). So SSH agent, proxy and tool variables reach employees, and so does any secret in the shell that starts the server.
- **Localhost only.** The server binds to 127.0.0.1. API requests with a foreign `Host` or `Origin` header are rejected, which blocks DNS rebinding and cross-site posts. So is any API request a browser marks `Sec-Fetch-Site: cross-site` or `same-site`, and any write it marks `none`. API responses carry `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`. Write requests must be `application/json`; attachments upload as base64 in JSON for that reason, and the body limit is raised to 28 MB to fit a 20 MB file.
- **Names.** An employee name is 1 to 40 characters, cannot start with `-`, and cannot hold control characters. The folder picker passes the name to `osascript` behind a fixed first argument, so it is always text, never script. One picker opens at a time.
- **File modes.** will-bot writes its data files with mode 0600 and creates its data folders with mode 0700. Files and folders made before this keep their old modes.

## Known limits

- Teammates run inside the Chief's session. They cannot use `remember`, and their shell commands start from the Chief's folder.
- Stopping or taking over a teammate that is working for the Chief also stops the Chief's turn.
- Sessions load your plugins, and their startup hooks add text to every session's prompt, which costs plan usage.
- Your user settings load, so an `env` block in `~/.claude/settings.json` reaches every employee. A billing variable there stops every employee.
- Connected tools in the details panel come from a check that starts your Claude setup without a prompt. It takes a few seconds and is cached for 10 minutes.
- If a saved Claude Code session disappears from `~/.claude`, will-bot starts a new conversation, says so in the chat, and sends your message there.
- Stop with a message still queued behind the turn closes the session so that message never runs. The next message resumes the conversation.
- Deleting an employee removes its chat, memory and routines but leaves its working folder on disk.
- Routines run only while the will-bot server runs. Nothing wakes the computer for them.
- The folder picker is a macOS dialog on the computer running the server.
- No group channel or "teach a task" yet.
