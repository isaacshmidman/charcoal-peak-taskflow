// @ts-nocheck
import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DAY, formatClock } from "@/lib/schedule";
import TimeField from "./TimeField";

/** An end time for a slot starting at `start`, the way a schedule row uses it. */
function EndOfSlot({ start = 7 * 60, initial = 8 * 60, onCommit, onProblem, refuse }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <TimeField
        end
        value={value}
        label="End"
        validate={(m) => (m <= start ? `The end has to be after the start (${formatClock(start)}).` : null)}
        onCommit={(m) => {
          onCommit?.(m);
          if (refuse) return refuse;
          setValue(m);
          return null;
        }}
        onProblem={onProblem}
      />
      <button type="button">elsewhere</button>
    </>
  );
}

const part = (name) => screen.getByLabelText(new RegExp(`^End, ${name}`));
const shown = () => `${part("hour").value}:${part("minutes").value} ${part("(AM|PM)").textContent}`;
const type = (el, keys) => {
  for (const key of keys) fireEvent.keyDown(el, { key });
};
/** Focus leaving the field for something else on the page. */
const leave = () => {
  const elsewhere = screen.getByText("elsewhere");
  act(() => elsewhere.focus());
};

describe("TimeField", () => {
  it("7:00 – 8:00 AM: click the end hour, type 07 then 30, and it becomes 7:30 AM", () => {
    const onCommit = vi.fn();
    render(<EndOfSlot onCommit={onCommit} />);
    act(() => part("hour").focus());
    type(part("hour"), ["0", "7"]);
    // On to the minutes by itself; 7:00 isn't after the start yet, and it says so.
    expect(document.activeElement).toBe(part("minutes"));
    expect(screen.getByRole("alert").textContent).toBe("The end has to be after the start (7:00 AM).");
    expect(onCommit).not.toHaveBeenCalled();
    type(part("minutes"), ["3", "0"]);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(7 * 60 + 30);
    expect(shown()).toBe("7:30 AM");
    expect(screen.queryByRole("alert")).toBeNull();
    // Leaving afterwards doesn't commit it again.
    leave();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("a first digit that can't start two finishes the part at once", () => {
    const onCommit = vi.fn();
    render(<EndOfSlot onCommit={onCommit} />);
    act(() => part("hour").focus());
    type(part("hour"), ["9"]);
    expect(document.activeElement).toBe(part("minutes"));
    type(part("minutes"), ["7"]);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(9 * 60 + 7);
  });

  it("1 then 3 isn't an hour, so it starts again at 3", () => {
    const onCommit = vi.fn();
    render(<EndOfSlot start={60} onCommit={onCommit} />);
    act(() => part("hour").focus());
    type(part("hour"), ["1"]);
    expect(part("hour").value).toBe("1");
    type(part("hour"), ["3"]);
    leave();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(3 * 60);
  });

  it("a time that isn't valid is put back when you leave, and says why", () => {
    const onCommit = vi.fn();
    const onProblem = vi.fn();
    render(<EndOfSlot onCommit={onCommit} onProblem={onProblem} />);
    act(() => part("hour").focus());
    type(part("hour"), ["6"]);
    leave();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onProblem).toHaveBeenCalledWith("The end has to be after the start (7:00 AM).");
    expect(shown()).toBe("8:00 AM");
  });

  it("Esc puts it back without changing anything", () => {
    const onCommit = vi.fn();
    render(<EndOfSlot onCommit={onCommit} />);
    act(() => part("hour").focus());
    type(part("hour"), ["1", "1"]);
    type(part("minutes"), ["Escape"]);
    leave();
    expect(onCommit).not.toHaveBeenCalled();
    expect(shown()).toBe("8:00 AM");
  });

  it("AM/PM flips with a click, and A or P", () => {
    const onCommit = vi.fn();
    render(<EndOfSlot onCommit={onCommit} />);
    fireEvent.click(part("AM"));
    expect(onCommit).toHaveBeenLastCalledWith(20 * 60);
    expect(shown()).toBe("8:00 PM");
    type(part("PM"), ["a"]);
    expect(onCommit).toHaveBeenLastCalledWith(8 * 60);
  });

  it("an end of 12:00 AM is the end of the day", () => {
    const onCommit = vi.fn();
    render(<EndOfSlot start={23 * 60} initial={23 * 60 + 30} onCommit={onCommit} />);
    act(() => part("hour").focus());
    type(part("hour"), ["1", "2"]);
    type(part("minutes"), ["0", "0"]);
    // Still PM: 12:00 PM is before 11 PM. Flip it.
    expect(onCommit).not.toHaveBeenCalled();
    type(part("PM"), ["a"]);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(DAY);
  });

  it("arrow keys step a part, and Enter commits", () => {
    const onCommit = vi.fn();
    render(<EndOfSlot onCommit={onCommit} />);
    act(() => part("minutes").focus());
    type(part("minutes"), ["ArrowUp", "ArrowUp"]);
    expect(part("minutes").value).toBe("02");
    type(part("minutes"), ["Enter"]);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(8 * 60 + 2);
  });

  it("a change the schedule refuses is put back, with the reason", () => {
    const onProblem = vi.fn();
    render(<EndOfSlot refuse="“Standup” is in the way." onProblem={onProblem} />);
    act(() => part("minutes").focus());
    type(part("minutes"), ["4", "5"]);
    expect(onProblem).toHaveBeenCalledWith("“Standup” is in the way.");
    expect(shown()).toBe("8:00 AM");
  });

  it("digits that arrive together (paste, dictation) fill the parts in order", () => {
    const onCommit = vi.fn();
    render(<EndOfSlot onCommit={onCommit} />);
    act(() => part("minutes").focus());
    fireEvent.change(part("minutes"), { target: { value: "30" } });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(8 * 60 + 30);
    act(() => part("hour").focus());
    fireEvent.change(part("hour"), { target: { value: "0945" } });
    expect(onCommit).toHaveBeenLastCalledWith(9 * 60 + 45);
  });

  it("a typed hour lands on the side of the day nearest the time already there", () => {
    const onCommit = vi.fn();
    // The day's end, at midnight: 11 means 11 PM, not 11 in the morning.
    const { unmount } = render(<EndOfSlot start={7 * 60} initial={DAY} onCommit={onCommit} />);
    act(() => part("hour").focus());
    type(part("hour"), ["1", "1"]);
    leave();
    expect(onCommit).toHaveBeenLastCalledWith(23 * 60);
    expect(shown()).toBe("11:00 PM");
    unmount();
    // 11:00 AM, then 1: 1 PM is nearer than 1 AM, and after the 7 AM start.
    render(<EndOfSlot start={7 * 60} initial={11 * 60} onCommit={onCommit} />);
    act(() => part("hour").focus());
    type(part("hour"), ["1"]);
    type(part("hour"), ["Enter"]);
    expect(onCommit).toHaveBeenLastCalledWith(13 * 60);
    expect(shown()).toBe("1:00 PM");
  });

  it("a phone keyboard that doesn't report keys still types", () => {
    const onCommit = vi.fn();
    render(<EndOfSlot onCommit={onCommit} />);
    act(() => part("minutes").focus());
    fireEvent.change(part("minutes"), { target: { value: "1" } });
    fireEvent.change(part("minutes"), { target: { value: "15" } });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(8 * 60 + 15);
  });
});
