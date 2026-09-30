# Connecting AI apps to Zephyrly

AI apps — Claude, ChatGPT, Gemini, local models — can read your tasks and
notes, and change them only if you allow it. They connect through MCP
(Model Context Protocol), the standard way these apps call outside tools:

```
https://zephyrly.app/api/mcp
```

Everything about access is in **Settings → Connected apps**: what's
connected, whether each app may change things, disconnecting, and every
change an AI app made, with Undo.

## What an AI app can and can't do

It can read your agenda, search tasks and notes, read a task or note in
full (notes come as Markdown, so headings, lists, checklists and links to
tasks come across; a schedule note comes as every slot with its times),
see a task's files, and read text files (txt, md, csv and the like; never
PDFs or images). With changes allowed, it can also:

- add tasks and subtasks, and change a task's title, date, time, priority,
  tags, description, reminder, or how it repeats (the same choices as the
  task form: daily, weekdays, chosen days, weekly, every two weeks, monthly,
  quarterly or yearly, with an optional last day), or stop it repeating;
- mark tasks done (a repeating task moves on, as in the app), or skip the
  next time a repeating task comes round;
- move a task or a note to Recently Deleted;
- add notes, written in Markdown, and change them: title, tags, pinning,
  text added at the end, words swapped inside (keeping formatting and links
  to tasks), or all of the text replaced (which drops formatting and task
  links, and says how many links went);
- format text in a note as the toolbar does: bold, italic, underline,
  strikethrough, code, highlight and text colours, fonts, links, headings,
  quotes, code blocks, every list style, checklists ticked or not, and
  indents. Clearing formatting keeps links to tasks, as the toolbar does;
- make a task from text in a note, linking the text to it, as the note
  editor's Make task does;
- build and change schedules (a note's Schedule switch): make a note a
  schedule, or add one as a schedule already filled in; put what's
  happening at given times; empty slots; change a slot's start or end with
  the same knock-on effect as in the app; set the gap, slot length, when
  the day starts and ends, and what changing a time does to the other
  slots; pin or unpin settings so every new schedule starts with them (as
  the pins in Advanced settings do); switch it off again (the schedule is
  kept). A slot with something
  in it is never dropped or pushed out of the day to make room: that
  change is refused, and nothing in that call is made;
- add a schedule to the calendar on a day you name, as the Add to
  calendar button does: each slot with something in it becomes a task at
  its times; ones already on that day are left out;
- add, rename, recolour, reorder or delete priorities, and add, remove or
  rename saved tags (a rename changes every task and note that has it);
- save text as a file attached to a task (.txt, .md or .csv, up to 1 MB).

Whatever the AI app is told, Zephyrly itself never lets it:

- change anything from a connected Google or Apple calendar — that would
  move or rewrite the real event;
- delete anything for good (a task it deletes goes to Recently Deleted
  with its files, and it can't delete a subtask or a file, because those
  deletes are permanent);
- see another person's tasks;
- make more than 100 changes an hour, or 120 requests a minute.

Every change is logged. Undo in Settings reverses it unless what it
changed was edited again since (files attached to a task it added count),
in which case it says so and leaves your edit alone. Making a task from a
note logs two entries, the task and the link in the note; undo both to put
things back as they were. Deleted tasks and notes are restored from Recently Deleted.

Anything new Zephyrly learns to do gets an AI tool too, with the same
rules.

## Apps that sign in

These open a Zephyrly page asking you to approve them. The page says which
site you'll return to — if it isn't the app you were using, don't allow it.
"Also let it change tasks" is off unless you tick it.

Menu names below are as of September 2026 and move around.

- **Claude** (claude.ai, and the iPhone app once added on the web):
  Settings → Connectors → Add custom connector. Name it Zephyrly, URL
  `https://zephyrly.app/api/mcp`, then Connect. The free plan allows one
  custom connector.
- **ChatGPT** (web; Plus, Pro or Business): Settings → Apps & Connectors →
  Advanced → turn on Developer mode, then create a connector with the URL
  above and OAuth authentication.
- **Gemini** (the app, inside Spark tasks, if your account has Spark):
  Connected apps → add a custom MCP server with the URL above.

## Apps that take a token

For apps you set up yourself: **Settings → Connected apps → Connect an app
with a token**. Name it, tick "Allow changes to tasks" only if you want
that, and create it. The token is shown once, with a ready-to-paste setup
line for Claude Code, Claude Desktop, Cursor, LM Studio, Gemini CLI and
Open WebUI. Each token is its own connection: revoke one without affecting
the others.

## Siri

Siri can't use MCP, and only reaches native apps directly, but it runs
Shortcuts, and a shortcut can call Zephyrly. Make a token (allow changes if
you want Siri to add tasks), then open the **Siri** tab under the new token:
it walks through building two shortcuts in the Shortcuts app, with every
address and header ready to copy.

- **What's due in Zephyrly** reads today's agenda aloud: "Today you have 3
  things: Call grandma, Pay rent at 9 AM and the dentist at 2 PM. Also 1
  overdue: Essay outline."
- **Add to Zephyrly** asks for the task and the day, then adds it: "Added
  Pick up dry cleaning for tomorrow."

Both call the plain HTTP version of the tools (`/api/v1/tools/<name>`) and
read the answer's `spoken` sentence. Siri reasoning over your tasks itself
(Apple Intelligence) would need a native iOS app with App Intents.

## Scripts and other tools

The same tools over plain HTTP, with a token:

```
curl -X POST https://zephyrly.app/api/v1/tools/get_agenda \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{}'
```

Every call answers `{ ok, text, spoken, data }`. A refusal is `ok: false`
with the reason in `text`. `GET /api/v1/tools` lists what the token may use,
and `https://zephyrly.app/api/v1/openapi.json` describes it all in OpenAPI
3.1, for GPT Actions, Gemini function calling and similar.

---

## Running the server

- **`TASKFLOW_PUBLIC_APP_URL` must be the exact public address**
  (`https://zephyrly.app`). It is the sign-in issuer and the MCP address
  AI apps are given; if it doesn't match what they connect to, signing in
  fails.
- **Public HTTPS** comes from the `cloudflared` service in
  `docker-compose.yml`. claude.ai, ChatGPT and Gemini connect from their
  own servers, so it must be reachable from the internet with a publicly
  trusted certificate (Gemini refuses self-signed ones). Local apps with a
  token can also use the home network address.
- **After deploying**, check discovery answers JSON (before this feature it
  returned the app's HTML):

  ```
  curl https://zephyrly.app/.well-known/oauth-authorization-server
  ```

- **Cloudflare's AI-bot blocking stops Claude.** When claude.ai says it
  can't connect, check this first. Cloudflare's "Block AI bots" (under AI
  Crawl Control) answers any request that identifies as Anthropic's
  `Claude-User` with a 403 "Sorry, you have been blocked" page, so Claude
  never reaches Zephyrly (found 2026-09-29). OpenAI's `GPTBot` and
  `ClaudeBot` are blocked too; `ChatGPT-User` gets through. To check,
  pretend to be Claude:

  ```
  curl -s -o /dev/null -w "%{http_code}\n" -A "Claude-User/1.0" https://zephyrly.app/.well-known/oauth-authorization-server
  ```

  `403` means Cloudflare is still blocking; `200` means Claude gets
  through. The fix is in the Cloudflare dashboard for zephyrly.app: in
  **AI Crawl Control**, set **Claude-User** (and any other assistant you
  use) to Allow. If your plan only has the on/off switch, turn off
  **Block AI bots** under Security → Settings. Zephyrly has nothing a
  crawler could train on behind sign-in anyway.
- New tables and routes: deploying this needs a **backend restart**
  (`docker compose up -d --build`).

### How it fits together

| Path | What | Credentials |
|---|---|---|
| `POST /api/mcp` | MCP, Streamable HTTP, stateless JSON. Protocol 2025-11-25, 2025-06-18, 2025-03-26 | AI token (personal or OAuth access) |
| `/.well-known/oauth-protected-resource` | Which server signs apps in (RFC 9728) | none |
| `/.well-known/oauth-authorization-server` | Sign-in endpoints (RFC 8414) | none |
| `POST /api/oauth/register` | Apps register themselves (RFC 7591) | none |
| `GET /api/oauth/authorize` | Starts sign-in, opens `/connect/<id>` | none |
| `POST /api/oauth/token` | Code or refresh token → tokens | PKCE |
| `POST /api/oauth/revoke` | Disconnects the app | the token |
| `POST /api/v1/tools/<name>` | The tools over plain HTTP (Siri, scripts) | AI token |
| `GET /api/v1/openapi.json` | OpenAPI 3.1, generated from the tools | none |
| `/api/apps/:appId/ai/*` | Settings: connections, tokens, activity, Undo, consent | signed-in session |

AI tokens only work on `/api/mcp` and `/api/v1`; a signed-in session doesn't work there.
Code lives in `backend/ai/` (tools, grants, OAuth, MCP) and
`backend/routes/ai.js`.

### When something goes wrong

- **401 `ai_token_required`**: the token is wrong, revoked, or an access
  token older than an hour (sign-in apps refresh on their own).
- **403 `forbidden_origin`**: the request came from a web page. Only
  Zephyrly's own pages may call `/api/mcp` from a browser.
- **429**: the rate limits above; `Retry-After` says when to try again.
- **"This sign-in link can't be used"**: the app isn't registered here or
  asked to return somewhere it never registered. Remove and re-add the
  connector in the AI app.
