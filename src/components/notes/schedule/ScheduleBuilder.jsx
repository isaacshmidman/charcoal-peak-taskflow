// @ts-nocheck
/**
 * @file A note as a schedule: the day in slots, each with a start, an end
 * and what's happening then. Shown in place of the note's text while the
 * note's Schedule switch is on (the text is kept, untouched).
 *
 * Times are changed by typing into them (TimeField). As soon as one is
 * finished the schedule adjusts around it (backend/lib/schedule.js): an
 * end moves the slots after it, a start the slots before it, or only the
 * neighbouring slot, per Advanced settings. What else moved shows in a
 * toast with Undo.
 */
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MAX_SLOT_TEXT, changeEnd, changeStart, formatClock, formatRange, removeSlot, splitSlot } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import TimeField from "./TimeField";
import { indexOf } from "./useScheduleEditor";

/** Minutes after midnight now, kept current while `on`. */
function useNowMinutes(on) {
  const read = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    if (!on) return undefined;
    setNow(read());
    const timer = setInterval(() => setNow(read()), 30_000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/**
 * @param {{
 *   schedule: import("@/lib/schedule").Schedule,
 *   editor: ReturnType<typeof import("./useScheduleEditor").useScheduleEditor>,
 *   noteHasText?: boolean,
 * }} props
 */
export default function ScheduleBuilder({ schedule, editor, noteHasText }) {
  const now = useNowMinutes(schedule.now);
  const textRefs = useRef(new Map());

  // Enter in a slot's text moves to the next slot, like a list.
  const focusText = (id) => textRefs.current.get(id)?.focus();

  return (
    <div className="px-2 pb-8 pt-1 sm:px-3" data-testid="schedule-builder">
      <ol aria-label="Schedule" className="divide-y divide-border-hairline">
        {schedule.slots.map((slot, index) => (
          <Slot
            key={slot.id}
            slot={slot}
            isNow={schedule.now && slot.start <= now && now < slot.end}
            editor={editor}
            textRef={(el) => {
              if (el) textRefs.current.set(slot.id, el);
              else textRefs.current.delete(slot.id);
            }}
            onNext={() => {
              const nextSlot = schedule.slots[index + 1];
              if (nextSlot) focusText(nextSlot.id);
            }}
          />
        ))}
      </ol>
      {noteHasText && (
        <p className="px-2 pt-4 text-xs text-slate-400 dark:text-slate-500">
          This note’s text is kept. Turn Schedule off to see it.
        </p>
      )}
    </div>
  );
}

function Slot({ slot, isNow, editor, textRef, onNext }) {
  const range = formatRange(slot);
  const commitStart = (minutes) => editor.apply((s) => changeStart(s, indexOf(s, slot.id), minutes), { editedId: slot.id });
  const commitEnd = (minutes) => editor.apply((s) => changeEnd(s, indexOf(s, slot.id), minutes), { editedId: slot.id });

  return (
    <li
      data-testid="schedule-slot"
      data-now={isNow ? "true" : undefined}
      aria-current={isNow ? "time" : undefined}
      // On a phone the times fill the width, so what's happening gets a
      // line of its own under them; wider, it all sits on one line.
      className={cn(
        "group relative flex flex-wrap items-center gap-x-2 py-1 pl-2 pr-0.5 sm:flex-nowrap sm:gap-x-3",
        isNow && "bg-slate-50 dark:bg-[#141414]"
      )}
    >
      {isNow && <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-slate-900 dark:bg-slate-100" />}
      <div className="flex shrink-0 items-center text-slate-500 dark:text-slate-400">
        <TimeField
          value={slot.start}
          label={`Start of ${range}`}
          testId="slot-start"
          validate={(m) => (m >= slot.end ? `The start has to be before the end (${formatClock(slot.end)}).` : null)}
          onCommit={commitStart}
          onProblem={editor.problem}
        />
        <span aria-hidden="true" className="px-0.5 text-slate-300 dark:text-slate-600">–</span>
        <TimeField
          end
          value={slot.end}
          label={`End of ${range}`}
          testId="slot-end"
          validate={(m) => (m <= slot.start ? `The end has to be after the start (${formatClock(slot.start)}).` : null)}
          onCommit={commitEnd}
          onProblem={editor.problem}
        />
      </div>
      <input
        ref={textRef}
        value={slot.text}
        maxLength={MAX_SLOT_TEXT}
        onChange={(event) => editor.setText(slot.id, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onNext();
          }
        }}
        aria-label={`What’s happening ${range}`}
        data-testid="slot-text"
        placeholder="Add something"
        enterKeyHint="next"
        // 16px on phones: iOS zooms into any field smaller than that. With
        // no hover on a phone, the empty line says faintly what it's for.
        className={cn(
          "order-last min-w-0 basis-full bg-transparent pb-1 pl-0.5 text-base text-slate-900 outline-none dark:text-slate-100",
          "placeholder:text-slate-300/60 focus:placeholder:text-slate-300 dark:placeholder:text-slate-600/50 dark:focus:placeholder:text-slate-600",
          "sm:order-none sm:flex-1 sm:basis-auto sm:py-1 sm:pl-0 md:text-sm",
          "sm:placeholder:text-transparent sm:group-hover:placeholder:text-slate-300 sm:focus:placeholder:text-slate-300",
          "dark:sm:placeholder:text-transparent dark:sm:group-hover:placeholder:text-slate-600 dark:sm:focus:placeholder:text-slate-600"
        )}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More for ${range}`}
            data-testid="slot-menu"
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md sm:ml-0 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 dark:text-slate-500 dark:hover:bg-[#1f1f1f] dark:hover:text-slate-200 [@media(hover:none)]:opacity-60"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={() => {
              const refused = editor.apply((s) => splitSlot(s, indexOf(s, slot.id)), { done: "Split in two.", quiet: true });
              if (refused) editor.problem(refused);
            }}
          >
            Split in two
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              const refused = editor.apply((s) => removeSlot(s, indexOf(s, slot.id)), {
                done: slot.text.trim() ? `Removed “${slot.text.trim()}”.` : "Removed the slot.",
              });
              if (refused) editor.problem(refused);
            }}
          >
            Remove slot
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
