# will-bot

A local bot manager built on the Claude Agent SDK. You run a small team of bots on your Mac. Each bot has a name, a job, its own memory, and its own workspace folder. A Chief of Staff bot hands work to the others. Bots ask you before risky actions.

## Setup

will-bot uses your Claude plan login, not an API key.

1. Log in once with the Claude CLI. Run `claude`, then type `/login` and finish the browser sign-in. The Agent SDK reuses this login.
2. Make sure `ANTHROPIC_API_KEY` is not set in the shell that starts the app. If it is set, the app shows a warning and refuses to run bots.
3. Install and start:

   ```sh
   npm install
   npm run dev
   ```

4. Open http://127.0.0.1:3000.

Other scripts:

- `npm run typecheck` runs `tsc --noEmit`.
- `npm run build` builds for production. `npm start` serves the build on 127.0.0.1.
- `npm run test:policy` checks the file and tool safety rules.

## Starter bots

The first start creates three bots.

- **Chief of Staff** coordinates the other bots and gives you short summaries. It can read its own folder and delegate to any other bot that is not paused. It runs on Sonnet with at most 12 turns per message.
- **Research Bot** researches a topic with web search and web fetch, then writes a short brief with sources to its workspace. It runs on Haiku with at most 8 turns.
- **Builder Bot** makes small code changes inside its workspace folder. It can run shell commands, but only after you approve each one. It runs on Haiku with at most 8 turns.

Bots you create get file tools and web tools, but no shell.

## Where data lives

Everything is plain files under `./data`:

- `data/bots.json` holds the bot list.
- `data/chats/<id>.json` holds each transcript and the SDK session id used to resume it.
- `data/memory/<id>.md` holds each bot's memory, one `- YYYY-MM-DD: note` line per entry. You can edit it in the details panel, and bots add to it with their `remember` tool.
- `data/workspaces/<id>/` is each bot's working folder.

## Safety model

- **Workspace jail.** Every file tool call goes through a PreToolUse hook before it runs. Paths must resolve, after following symlinks, to a location inside that bot's own workspace. Paths with `..`, absolute paths outside the folder, symlinks that point out, and broken symlinks are refused. Allowed paths are rewritten to their absolute real path, so the tool touches exactly the file that was checked.
- **No secrets.** Any file whose name starts with `.env` is refused, including through a symlink.
- **Own tools only.** Each bot can use only the tools on its own list. The Chief's session has every team tool available so its subagents can work, and the hook refuses any tool a given bot does not have. Only the bot that owns the run can use `remember`.
- **Team-only delegation.** The Chief can delegate only to bots on its team, by bot id. Built-in agents and forks are refused. A delegated bot runs in the foreground on its own model, and any model, effort, isolation, or mode override is stripped. A tool call from a subagent that is not a team bot is refused.
- **Approvals.** Shell commands and any tool not on the allow list pause the run and show an approval card. This applies even to commands the SDK would normally treat as safe, such as `ls`. Approve lets it run once. Not yet denies it and tells the bot not to retry. An unanswered card expires after 10 minutes and counts as a denial.
- **No inherited permissions.** The SDK runs with `settingSources: []`, so allow rules in your own `~/.claude` settings never auto-approve anything for a bot.
- **Plan billing only.** Bots refuse to run while `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, or `CLAUDE_CODE_USE_FOUNDRY` is set, and the banner names the variable. The app only checks whether these are set and never reads their values.
- **Minimal environment.** The SDK gets only `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TERM`, and `CLAUDE_CONFIG_DIR` from the server's environment. Other variables, including secrets, never reach a bot.
- **No local web fetches.** WebFetch accepts only http and https URLs. It refuses `localhost`, `.localhost` and `.local` names, and IP addresses for this computer or a private network, including link-local and IPv4-mapped IPv6 forms.
- **Localhost only.** The server binds to 127.0.0.1. API requests with a foreign `Host` or `Origin` header are rejected, which blocks DNS rebinding and cross-site posts. Write requests must be `application/json`.
- **Take over.** Take over aborts the bot's run within a second or two and keeps its session. If the bot is working for the Chief, the Chief's run stops too. Stop and Delete do the same. A paused bot cannot be messaged or delegated to until you hand control back, and every tool call rechecks this, so a bot paused or deleted mid-run gets no further tools.

## Known limits

- One run per bot at a time. A second message to a busy bot is refused until the first run ends. This includes a bot working for the Chief.
- Delegated bots run inside the Chief's session. They cannot use `remember`, and their shell commands run from the Chief's folder. File tools still go through each bot's own workspace check.
- Grep across a bot's own workspace can match the contents of a `.env` file that the bot itself created there with an approved shell command.
- WebFetch checks the URL text only. A public hostname whose DNS points at a private address is not caught.
- Approvals live in server memory. Restarting the server expires any pending card.
- If a saved SDK session disappears from `~/.claude`, resuming fails. Delete that bot's `data/chats/<id>.json` to start fresh.
- Deleting a bot removes its chat and memory but leaves its workspace folder on disk.
- No group channel, routines, or "teach a task" yet.
