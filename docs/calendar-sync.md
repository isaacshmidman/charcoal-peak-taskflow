# Connected calendars: the rules

How Zephyrly keeps tasks and a Google or iCloud calendar in step, and the
rules that stop the two damaging each other. Each rule below replaced a
way things used to go wrong (November 2026); the tests that hold them are
in `backend/calendar-reliability.test.js`.

Two directions:

- **In** (`backend/sync/`): once a minute, each connected calendar is asked
  what changed, and tasks are created, changed or removed to match.
- **Out** (`backend/push/`): when a task changes here, the change is sent
  to the calendar the task is shown on.

## What a calendar may do to a task

A calendar event knows a title, a time, a description and a repeat rule.
It does not know whether a task is done, and it is not where a task made
in Zephyrly came from.

| Rule | Where | What used to happen |
|---|---|---|
| A change at the calendar never touches "done" | `inboundUpdateFor` in `sync/shared.js` | Every incoming change carried "not done", so moving a finished task's event in Google un-ticked the task. |
| A task made here stays a task made here | same | The incoming change stamped the calendar's name on it. The task became a calendar event: gone from Today and All Tasks, no longer editable. |
| The description is only replaced when the calendar's words differ | same | The formatted description was overwritten by the plain copy the calendar had been sent. |
| A repeat rule Zephyrly can't express doesn't replace a task's own | same | The task's repeat became "custom", which means nothing without the calendar's rule. |
| A change made here that hasn't gone out yet wins | `pushIsWaiting` | A sync arriving between an edit and its delivery wrote the calendar's older copy over the edit. |
| An event deleted at the calendar sends a Zephyrly-made task to Recently Deleted | `removeTaskForCalendarDelete` | The task, its subtasks and its files were removed for good. Deleting a calendar entry, or moving it to another calendar, destroyed the task. A subtask stays where it is; an event that came from the calendar is simply removed. |

## What must not get lost on the way out

| Rule | Where | What used to happen |
|---|---|---|
| Every change is written down before it is sent, and kept until it arrives | `push/outbox.js`, table `push_outbox` | The queue lived in memory and each change was tried once. A calendar that was unreachable, or a restart, lost the change for good. |
| A change that fails is tried again: after 1 min, 5, 15, 1 h, 3, 6, 12, 24 | `RETRY_DELAYS_MS` | Nothing retried it. A change the calendar refuses as wrong (400/413/422) is dropped at once: trying again can't help. |
| A retry sends the task as it is now | `duePushes` | n/a |
| A second try at creating an event looks for the first one | `findEventForTask` in `providers/google-calendar.js` | n/a: with retries, a first try whose answer was lost would have made a twin. iCloud needs nothing: its events live at an address made from the task's id. |
| A delete cancels an edit still waiting to go | `enqueueTaskPush` | Edit then delete within a third of a second: the delete went first, then the edit re-created the event for a task that no longer existed. |
| An edit made just after sync touched the task still goes out | (the hold was removed) | Sync put a 30-second "don't send" hold on every task it touched, to stop an echo that couldn't happen (sync writes to the store directly and never reaches the push hook). All the hold did was drop real edits. |
| An update says what no longer applies | `asChangeToExistingEvent` in `push/google.js` | Google applies an update field by field. Giving an all-day task a time left the old all-day start beside the new one, and Google refused the event; a task that stopped repeating kept repeating there; a removed priority kept its colour. |

## Staying in step over time

- **The whole window is read once a day** (`sync/window.js`). The first read
  of a calendar takes 30 days back and 90 ahead; after that sync only hears
  about changes. An event that was already further than 90 days ahead on
  the day the calendar was connected was therefore never seen, even on the
  day it happened, unless somebody edited it.
- **No call can hang** (`lib/net.js`): 30 seconds, then it fails as
  "couldn't be reached". Sync runs accounts one after another and changes
  go out through one queue, so one silent server used to hold up everyone.
  A provider that can't be reached is never mistaken for a refused sign-in.
- **A sync that reached no calendar says so.** Every round used to be
  recorded as a success whatever the calendars answered.
- **Settings shows problems in plain words** (`src/lib/integrationNotices.js`),
  including how many changes are still waiting to reach the calendar. The
  provider's own error text stays in the log.

## Known limits

- One occurrence of a repeating event changed or cancelled at the calendar
  is not reflected here: a series is one task.
- Editing, in Zephyrly, an event that came from the calendar rewrites it
  with what Zephyrly knows. Guests, alerts and a location set at an iCloud
  event are not kept; at Google they are (updates are field by field), but
  a repeating event's skipped dates are not.
- Changes made here while a connection needs reconnecting are not sent
  when it is reconnected.
- Google only: an OAuth app left in "Testing" in Google Cloud has its
  sign-ins expire after seven days, so the connection asks to be
  reconnected every week. That is a setting in Google Cloud Console
  (OAuth consent screen → Publishing status), not something the code can
  change.

## Checking it for real

The unit tests stand in for Google and iCloud with a fake `fetch`. Nothing
here has been run against the real services from the development machine:
that needs a real Google or iCloud sign-in. To check on the server after a
deploy, connect a calendar, then: give an all-day task a time (the event
should gain the time); tick a task, then move its event in the calendar
(the task should move and stay ticked, and stay in All Tasks); delete a
task's event in the calendar (the task should be in Recently Deleted).
