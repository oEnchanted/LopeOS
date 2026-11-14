import { useEffect, useId, useMemo, useState, type RefObject } from "react";
import {
  functionRegistryByName,
  functionSuggestions,
  type FunctionCompatibility,
} from "../../../../../packages/spreadsheet-engine/src/function-registry";
import { formulaReferences } from "../../../../../packages/spreadsheet-engine/src/references";
import {
  parseRange,
  rangeAddress,
  type Range,
} from "../../../../../packages/spreadsheet-engine/src/model";
import "./formula-assist.css";
import type { SheetPreferences } from "./preferences";

export const REFERENCE_COLORS = [
  "#365dcc",
  "#b33e6d",
  "#17845a",
  "#9b5e1a",
  "#8150b5",
  "#137b9c",
];
export function referenceRanges(
  draft: string,
  activeSheetName: string,
): Range[] {
  if (!draft.startsWith("=")) return [];
  const ranges: Range[] = [];
  for (const ref of formulaReferences(draft))
    if (
      !ref.sheet ||
      ref.sheet.toLowerCase() === activeSheetName.toLowerCase()
    ) {
      try {
        ranges.push(parseRange(ref.first + (ref.last ? ":" + ref.last : "")));
      } catch {
        /* incomplete edit */
      }
    }
  const withoutStrings = draft.replace(/"(?:[^"]|"")*"/g, (match) =>
    " ".repeat(match.length),
  );
  const whole =
    /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?[1-9]\d*:\$?[1-9]\d*)/g;
  for (const m of withoutStrings.matchAll(whole)) {
    const name = m[1]?.replace(/''/g, "'") ?? m[2];
    if (name && name.toLowerCase() !== activeSheetName.toLowerCase()) continue;
    try {
      ranges.push(parseRange(m[3].replace(/\$/g, "")));
    } catch {
      /* incomplete edit */
    }
  }
  return [
    ...new Map(ranges.map((range) => [rangeAddress(range), range])).values(),
  ].slice(0, 64);
}
function callAtCaret(text: string): { name: string; argument: number } | null {
  const stack: { name: string; argument: number }[] = [];
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quote && text[i + 1] === '"') i++;
      else quote = !quote;
    }
    if (quote) continue;
    if (char === "(") {
      const name = /([A-Za-z_][\w.]*)\s*$/.exec(text.slice(0, i))?.[1] ?? "";
      stack.push({
        name: name.toUpperCase().replace(/^_XLFN\./, ""),
        argument: 0,
      });
    } else if (char === ")") stack.pop();
    else if (char === "," && stack.length) stack[stack.length - 1].argument++;
  }
  return [...stack].reverse().find((entry) => entry.name) || null;
}
function statusLabel(fn: FunctionCompatibility): string {
  return fn.status === "fixture-tested"
    ? "Examples tested"
    : fn.status === "available-unverified"
      ? "Not yet verified"
      : fn.status === "blocked"
        ? "Blocked"
        : "Unsupported";
}
export interface FormulaAssistProps {
  draft: string;
  onChoose: (draft: string) => void;
  inputRef?: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  preferences?: SheetPreferences;
  minLetters?: number;
}
export function FormulaAssist({
  draft,
  onChoose,
  inputRef,
  preferences,
  minLetters,
}: FormulaAssistProps) {
  const [caret, setCaret] = useState(draft.length),
    [selected, setSelected] = useState(0),
    [dismissed, setDismissed] = useState(false),
    listId = useId();
  useEffect(() => {
    setCaret(inputRef?.current?.selectionStart ?? draft.length);
    setSelected(0);
    setDismissed(false);
  }, [draft, inputRef]);
  const before = draft.slice(0, caret),
    quoted = (before.match(/"/g)?.length ?? 0) % 2 === 1;
  const prefix =
    draft.startsWith("=") && !quoted
      ? /(?:^=|[,(+*/^&=<>\-])\s*([A-Za-z_][\w.]*)$/.exec(before)?.[1]
      : undefined;
  const suggestions = useMemo(
    () => (preferences?.autocomplete !== false && preferences?.autocompleteFunctions !== false && prefix && prefix.length >= (minLetters ?? preferences?.autocompleteMinLetters ?? 1) ? functionSuggestions(prefix, 10) : []),
    [prefix, preferences?.autocomplete, preferences?.autocompleteFunctions, preferences?.autocompleteMinLetters, minLetters],
  );
  const call = callAtCaret(before),
    signature = preferences?.autocomplete !== false && preferences?.autocompleteFunctions !== false && call ? functionRegistryByName.get(call.name) : undefined,
    show = suggestions.length > 0 && !dismissed;
  const choose = (fn: FunctionCompatibility) => {
    if (!prefix) return;
    const start = caret - prefix.length,
      next =
        draft.slice(0, start) +
        fn.name +
        (draft[caret] === "(" ? "" : "(") +
        draft.slice(caret),
      position = start + fn.name.length + 1;
    onChoose(next);
    requestAnimationFrame(() => {
      inputRef?.current?.focus();
      inputRef?.current?.setSelectionRange(position, position);
      setCaret(position);
    });
  };
  useEffect(() => {
    const input = inputRef?.current;
    if (!input) return;
    const selection = () => setCaret(input.selectionStart ?? draft.length);
    const key = (raw: Event) => {
      const event = raw as KeyboardEvent;
      if (event.isComposing) return;
      if (
        show &&
        ["ArrowDown", "ArrowUp", "Tab", "Enter", "Escape"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "ArrowDown")
          setSelected((index) => (index + 1) % suggestions.length);
        else if (event.key === "ArrowUp")
          setSelected(
            (index) => (index - 1 + suggestions.length) % suggestions.length,
          );
        else if (event.key === "Escape") setDismissed(true);
        else choose(suggestions[selected] ?? suggestions[0]);
      }
    };
    input.addEventListener("keydown", key, true);
    input.addEventListener("keyup", selection);
    input.addEventListener("click", selection);
    input.addEventListener("select", selection);
    if (show) {
      input.setAttribute("aria-controls", listId);
      input.setAttribute("aria-activedescendant", `${listId}-${selected}`);
      input.setAttribute("aria-autocomplete", "list");
    } else {
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-activedescendant");
    }
    return () => {
      input.removeEventListener("keydown", key, true);
      input.removeEventListener("keyup", selection);
      input.removeEventListener("click", selection);
      input.removeEventListener("select", selection);
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-activedescendant");
      input.removeAttribute("aria-autocomplete");
    };
  }, [inputRef, draft, show, selected, suggestions, caret, listId]);
  if (!draft.startsWith("=") || (!show && !signature)) return null;
  return (
    <div className="sheets-formula-assist glass">
      {show && (
        <div
          id={listId}
          role="listbox"
          aria-label="Function suggestions"
          className="sheets-function-suggestions"
        >
          {suggestions.map((fn, index) => (
            <button
              id={`${listId}-${index}`}
              key={fn.name}
              type="button"
              role="option"
              aria-selected={index === selected}
              tabIndex={-1}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSelected(index)}
              onClick={() => choose(fn)}
            >
              <strong>{fn.name}</strong>
              <span>{statusLabel(fn)}</span>
            </button>
          ))}
          <small>↑ ↓ to choose · Tab to insert</small>
        </div>
      )}
      {signature && (
        <div className="sheets-function-signature" role="status">
          <strong>{signature.signature}</strong>
          <span>
            Argument {(call?.argument ?? 0) + 1} · {statusLabel(signature)}
          </span>
          {(signature.status === "unsupported" ||
            signature.status === "blocked") && <small>{signature.notes}</small>}
        </div>
      )}
    </div>
  );
}
