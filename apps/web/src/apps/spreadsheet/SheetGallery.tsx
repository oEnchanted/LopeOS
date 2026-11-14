import { useState } from "react";
import { ArrowLeft, FileSpreadsheet, FolderOpen, Plus } from "lucide-react";
import { Dialog } from "../../../../../packages/ui/src";
import "./gallery.css";

type GalleryAction = () => void | boolean | Promise<void | boolean>;
export interface SheetGalleryProps {
  onBlank: GalleryAction;
  onBudget: GalleryAction;
  onOpen: GalleryAction;
  onClose(): void;
}

/** Shared Dialog supplies Escape dismissal, focus trapping and focus restoration. */
export function SheetGallery({ onBlank, onBudget, onOpen, onClose }: SheetGalleryProps) {
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  async function choose(label: string, action: GalleryAction) {
    setBusy(label);
    setError("");
    try {
      const result = await action();
      if (result !== false) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workbook could not be opened.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Dialog title="Welcome to Sheets" onClose={onClose} dismissible={!busy}>
      <div className="sheets-gallery" aria-busy={!!busy}>
        <div className="sheets-gallery-intro">
          <span className="sheets-gallery-app-symbol" aria-hidden="true"><FileSpreadsheet size={25} strokeWidth={1.6} /></span>
          <div><h3>Start with a workbook</h3><p>A clean sheet, a useful template, or a file of your own.</p></div>
        </div>
        <div className="sheets-gallery-choices">
          <button type="button" className="sheets-gallery-choice" aria-label="Blank workbook" disabled={!!busy} onClick={() => void choose("Creating workbook…", onBlank)}>
            <div className="sheets-gallery-thumbnail sheets-gallery-blank" aria-hidden="true">
              <div className="sheets-gallery-mini-toolbar"><span /><span /><span /></div>
              <div className="sheets-gallery-mini-grid">{Array.from({ length: 35 }, (_, index) => <span key={index} className={index === 0 ? "active" : undefined} />)}</div>
              <span className="sheets-gallery-plus"><Plus size={24} /></span>
            </div>
            <strong>Blank workbook</strong>
            <span>Build something from a clean sheet.</span>
          </button>
          <button type="button" className="sheets-gallery-choice" aria-label="Household budget" disabled={!!busy} onClick={() => void choose("Opening budget…", onBudget)}>
            <div className="sheets-gallery-thumbnail sheets-gallery-budget" aria-hidden="true">
              <div className="sheets-gallery-budget-title">MONTHLY BUDGET</div>
              <div className="sheets-gallery-budget-row heading"><span>Category</span><span>Planned</span></div>
              <div className="sheets-gallery-budget-row"><span>Housing</span><span>1,800</span></div>
              <div className="sheets-gallery-budget-row"><span>Groceries</span><span>500</span></div>
              <div className="sheets-gallery-budget-row"><span>Utilities</span><span>260</span></div>
              <div className="sheets-gallery-budget-row total"><span>Total</span><span>2,560</span></div>
              <div className="sheets-gallery-mini-chart"><i /><i /><i /><i /><i /></div>
            </div>
            <strong>Household budget</strong>
            <span>Plan spending and compare it with actuals.</span>
          </button>
          <button type="button" className="sheets-gallery-choice sheets-gallery-open" aria-label="Open workbook" disabled={!!busy} onClick={() => void choose("Opening workbook…", onOpen)}>
            <div className="sheets-gallery-thumbnail" aria-hidden="true"><FolderOpen size={54} strokeWidth={1.2} /></div>
            <strong>Open workbook</strong>
            <span>Pick up where you left off.</span>
          </button>
        </div>
        {error && <p className="sheets-gallery-error" role="alert">{error}</p>}
        <footer className="sheets-gallery-footer">
          <button type="button" disabled={!!busy} onClick={onClose}><ArrowLeft size={15} />Back to workbook</button>
          <span role="status">{busy ?? "Your workbooks stay local."}</span>
        </footer>
      </div>
    </Dialog>
  );
}

export default SheetGallery;
