import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { SHORTCUT_EVENTS } from "@/lib/shortcuts";

function Harness() {
  useGlobalShortcuts();
  return <input aria-label="a text box" />;
}

/** Press `key` on `path` and return what each named shortcut event carried. */
function press(path, key, target) {
  const heard = {};
  const listeners = Object.entries(SHORTCUT_EVENTS).map(([name, type]) => {
    const listener = (event) => { (heard[name] ||= []).push(event.detail); };
    window.addEventListener(type, listener);
    return { type, listener };
  });
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>
  );
  fireEvent.keyDown(target ? view.getByLabelText(target) : document.body, { key });
  listeners.forEach(({ type, listener }) => window.removeEventListener(type, listener));
  view.unmount();
  return heard;
}

describe("Groupings board shortcuts", () => {
  it("d shows the board by date and t the board by tag", () => {
    expect(press("/Groupings", "d").groupingsView).toEqual(["date"]);
    expect(press("/Groupings", "t").groupingsView).toEqual(["tag"]);
    expect(press("/Groupings", "T").groupingsView).toEqual(["tag"]);
  });

  it("the same keys keep their calendar meaning on the Calendar page", () => {
    const d = press("/Calendar", "d");
    expect(d.calendarView).toEqual(["day"]);
    expect(d.groupingsView).toBeUndefined();
    const t = press("/Calendar", "t");
    expect(t.calendarToday).toHaveLength(1);
    expect(t.groupingsView).toBeUndefined();
  });

  it("does nothing on other pages, or while typing", () => {
    expect(press("/Today", "t").groupingsView).toBeUndefined();
    expect(press("/Groupings", "t", "a text box").groupingsView).toBeUndefined();
  });
});
