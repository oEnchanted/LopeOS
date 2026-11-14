import { useState, type ReactNode } from "react";
import { Dialog, Button } from "../../../../../packages/ui/src";
export type FormField = {
  name: string;
  label: string;
  type?: "text" | "number" | "select" | "textarea" | "checkbox" | "color";
  value?: string;
  options?: { value: string; label: string }[];
  hint?: string;
  min?: number;
  max?: number;
};
export type DialogSpec = {
  id: number;
  title: string;
  description?: string;
  fields?: FormField[];
  content?: ReactNode;
  submit?: string;
  onSubmit?: (values: Record<string, string>) => void | Promise<void>;
};
export function SheetDialog({
  spec,
  onClose,
}: {
  spec: DialogSpec;
  onClose(): void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        (spec.fields ?? []).map((f) => [f.name, f.value ?? ""]),
      ),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title={spec.title} onClose={onClose}>
      <form
        className="sheets-dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await spec.onSubmit?.(values);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        {spec.description && <p>{spec.description}</p>}
        {spec.content}
        {spec.fields?.map((f) => (
          <label
            className={f.type === "checkbox" ? "checkbox" : ""}
            key={f.name}
          >
            <span>{f.label}</span>
            {f.type === "select" ? (
              <select
                aria-label={f.label}
                value={values[f.name]}
                onChange={(e) =>
                  setValues({ ...values, [f.name]: e.target.value })
                }
              >
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                aria-label={f.label}
                rows={5}
                value={values[f.name]}
                onChange={(e) =>
                  setValues({ ...values, [f.name]: e.target.value })
                }
              />
            ) : (
              <input
                type={f.type ?? "text"}
                aria-label={f.label}
                value={values[f.name]}
                checked={
                  f.type === "checkbox" ? values[f.name] === "true" : undefined
                }
                min={f.min}
                max={f.max}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [f.name]:
                      f.type === "checkbox"
                        ? String(e.target.checked)
                        : e.target.value,
                  })
                }
              />
            )}{" "}
            {f.hint && <small>{f.hint}</small>}
          </label>
        ))}
        {error && (
          <p role="alert" className="sheets-error">
            {error}
          </p>
        )}
        <footer>
          <Button type="button" disabled={busy} onClick={onClose}>
            {spec.onSubmit ? "Cancel" : "Close"}
          </Button>
          {spec.onSubmit && (
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Working…" : (spec.submit ?? "OK")}
            </Button>
          )}
        </footer>
      </form>
    </Dialog>
  );
}
