"use client";

/**
 * Accessible tab set (WAI-ARIA tabs pattern). A row of tab buttons controls a
 * single visible panel; only the active panel is rendered, so inactive panels
 * do not mount or run effects. Arrow keys move between tabs, Home/End jump to
 * the first/last tab, and only the active tab is in the tab order. The first
 * tab is selected by default unless `defaultTabId` names another.
 */

import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export default function Tabs({
  tabs,
  defaultTabId,
  ariaLabel,
}: {
  tabs: TabItem[];
  defaultTabId?: string;
  ariaLabel?: string;
}) {
  const [activeId, setActiveId] = useState<string | undefined>(
    defaultTabId ?? tabs[0]?.id,
  );
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  function focusTab(id: string): void {
    setActiveId(id);
    tabRefs.current[id]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (tabs.length === 0 || activeTab === undefined) {
      return;
    }
    const current = tabs.findIndex((tab) => tab.id === activeTab.id);
    let next = current;
    switch (event.key) {
      case "ArrowRight":
        next = (current + 1) % tabs.length;
        break;
      case "ArrowLeft":
        next = (current - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusTab(tabs[next].id);
  }

  if (activeTab === undefined) {
    return null;
  }

  return (
    <div className="tabs">
      <div className="tablist" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => {
          const selected = tab.id === activeTab.id;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              className={selected ? "tab tab--active" : "tab"}
              aria-selected={selected}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={handleKeyDown}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        className="tabpanel"
        role="tabpanel"
        id={`tabpanel-${activeTab.id}`}
        aria-labelledby={`tab-${activeTab.id}`}
        tabIndex={0}
      >
        {activeTab.content}
      </div>
    </div>
  );
}
