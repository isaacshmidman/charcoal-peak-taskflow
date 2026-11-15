# Backups, and putting one back

Everything the server holds is two things in one folder (the one
`TASKFLOW_DATA_DIR` names in `.env`): the database, `taskflow.sqlite`, and
the files people attached, `attachments/`. A backup is a copy of both as
they were at one moment.

## What happens by itself

The server makes a backup a day and keeps the last 14
(`backend/backup.js`). Each is a folder named for when it was made, in
UTC, inside the data folder:

```
<data folder>/backups/2026-11-15_03-12-40/
  taskflow.sqlite    the whole database
  attachments/…      every file that database refers to
  manifest.json      when it was made, and how many of each thing it holds
```

It looks once an hour and makes one when the newest is over a day old, so
a server that was off catches up. The log says so:

```
docker compose logs taskflow | grep backup
[zephyrly] [backup] made 2026-11-15_03-12-40: 3 people, 412 tasks, 58 notes, 37 files, 21.4 MB
[zephyrly] [backup] FAILED: …
```

`TASKFLOW_BACKUP_KEEP` changes how many are kept; `TASKFLOW_BACKUPS=false`
turns them off.

Three things make it a real copy while the app is in use:

- The database is copied with SQLite's `VACUUM INTO`: one moment of it,
  whoever is writing. **Copying `taskflow.sqlite` by hand while the server
  runs is not a backup**: the newest changes are in `taskflow.sqlite-wal`
  beside it, and a copy of one without the other can be missing days.
- A stored file is written once, under a name of its own, and never
  changed. So the backup holds a second name for the same file (a hard
  link) where the disk allows it: 14 backups of a photo take the space of
  one, and deleting the photo in the app leaves every backup's intact.
  Where the disk can't do that, the file is copied.
- A backup is written as `<name>.partial` and renamed when whole. One cut
  short by a power cut is never listed, and is cleared a day later.

## What a backup does not cover

- **The drive itself.** The backups sit on the same drive as the data.
  They undo a mistake, a bad update or a damaged database; they do not
  survive the drive dying. For that, copy the `backups` folder somewhere
  else now and then (another drive, another machine). A finished backup
  never changes, so any plain copy of the folder is good.
- **The `.env` file.** Calendar sign-ins are stored locked with
  `INTEGRATIONS_ENCRYPTION_KEY` from `.env`, and the key is deliberately
  not kept beside them. Without the same `.env`, a restored server has
  everyone's tasks, notes and files, but each calendar has to be connected
  again and everyone has to sign in again. Keep a copy of `.env` in a
  password manager.

## By hand

Run from the project folder on the server. All four only read the live
data, and are safe while the app is in use.

```
docker compose exec taskflow node backend/scripts/backup.js            # make one now
docker compose exec taskflow node backend/scripts/backup.js list       # what is kept
docker compose exec taskflow node backend/scripts/backup.js check      # look the newest over
docker compose exec taskflow node backend/scripts/backup.js rehearse   # prove the newest can be put back
```

`check` and `rehearse` take a backup's name to look at an older one. Make
one by hand before anything risky (an update that changes the database, a
move to another drive).

## The rehearsal

A backup nobody has tried to put back is a hope. `rehearse`
(`backend/backup-rehearsal.js`) copies the backup to a folder of its own,
starts the real server on the copy, on the machine only, and asks it what
the app would:

```
Rehearsed putting back /app/backend/data/backups/2026-11-15_03-12-40
  ✓ The backup is whole: 3 people, 412 tasks, 58 notes, 37 files, 21.4 MB.
  ✓ This version of the app opened the database.
  ✓ The server gave every person their tasks and notes, and a stored file where they have one.
  ✓ The server on the copy reports healthy.
  Nothing wrong.
```

- *Whole*: the database passes SQLite's own check, holds exactly what the
  manifest says, and every file it refers to is there at the right size.
- *Opened*: the app's current version brought the backup's database up to
  its current shape, which is what a restore after an update has to do.
- *Gave every person their things*: signed in as each person (on the copy
  only), the server's lists match the database, and a stored file comes
  back byte for byte.

Nothing leaves the machine while it runs (calendar sync and reminders
never start), the live data is not opened, the backup is not changed, and
the copy is removed at the end. It exits with 1, and says why, when
anything is off. Worth running after each update and before relying on a
backup.

It cannot prove that the `.env` you kept is the right one, or that the
drive will still be readable on the day.

## Putting a backup back

This replaces what the server holds with what it held when the backup was
made. Everything done since is lost from the app (events made in a
connected calendar since then come back in at the next sync). Nothing
below deletes anything: today's data is set aside, not removed.

1. Choose the backup, and rehearse it:

   ```
   docker compose exec taskflow node backend/scripts/backup.js list
   docker compose exec taskflow node backend/scripts/backup.js rehearse 2026-11-15_03-12-40
   ```

2. Stop the app. The site is down from here until step 5.

   ```
   docker compose stop taskflow
   ```

3. Set today's data aside. `DATA` is the folder `TASKFLOW_DATA_DIR` names
   in `.env`.

   ```
   DATA=/the/folder/from/.env
   mkdir "$DATA/set-aside"
   mv "$DATA"/taskflow.sqlite* "$DATA/attachments" "$DATA/set-aside/"
   ```

   The `*` matters: `taskflow.sqlite-wal` and `taskflow.sqlite-shm` must
   go too. An old `-wal` file left beside a restored database is applied
   to it when the server starts, and damages it.

4. Copy the backup into place (copy, so the backup stays as it is):

   ```
   cp -a "$DATA/backups/2026-11-15_03-12-40/taskflow.sqlite" "$DATA/"
   cp -a "$DATA/backups/2026-11-15_03-12-40/attachments" "$DATA/"
   ```

5. Start the app, and look:

   ```
   docker compose up -d taskflow
   docker compose logs --tail 20 taskflow
   ```

When it is right, `set-aside` can be removed whenever you like. If it is
not right, stop the app, move what is in `set-aside` back, and start it:
you are where you were before step 2.

On another machine it is the same from step 4: an empty data folder, the
backup's two things copied into it, the same `.env`, then
`docker compose up -d`.
