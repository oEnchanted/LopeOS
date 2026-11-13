import { useId, type ReactNode } from 'react';
export function SettingsPage({ title, description, icon, children }: { title: string; description?: string; icon?: ReactNode; children: ReactNode }) {
  return <section className="settings-page"><div className="settings-page-heading">{icon && <span className="settings-page-icon">{icon}</span>}<div><h1>{title}</h1>{description && <p>{description}</p>}</div></div>{children}</section>;
}
export function SettingsGroup({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return <section className="settings-group">{title && <h2>{title}</h2>}<div className="settings-group-body">{children}</div>{description && <p className="settings-group-note">{description}</p>}</section>;
}
export function SettingsRow({ id, label, description, children, vertical = false }: { id?: string; label: string; description?: ReactNode; children?: ReactNode; vertical?: boolean }) {
  return <div id={id ? 'setting-' + id : undefined} className={'settings-row' + (vertical ? ' settings-row--vertical' : '')} tabIndex={-1}><div className="settings-row-copy"><span className="settings-row-label">{label}</span>{description && <p>{description}</p>}</div><div className="settings-row-control">{children}</div></div>;
}
export function SettingSwitch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button type="button" className="setting-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span/><i aria-hidden="true">{checked ? '✓' : '−'}</i></button>;
}
export function SettingSlider({ label, value, min, max, step = 1, unit = '%', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  const id = useId();
  return <div className="setting-slider"><input id={id} aria-label={label} type="range" style={{'--range-progress':((value-min)/(max-min)*100)+'%'} as React.CSSProperties} min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}/><output htmlFor={id}>{value}{unit}</output></div>;
}
export function ChoicePreview({ label, ariaLabel, selected, onClick, children }: { label: string; ariaLabel?: string; selected: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={'choice-preview' + (selected ? ' is-selected' : '')} type="button" aria-label={ariaLabel||label} aria-pressed={selected} onClick={onClick}><span className="choice-preview-image">{children}</span><span className="choice-preview-label">{label}<i aria-hidden="true">{selected ? '✓' : ''}</i></span></button>;
}
export function PermissionRow({ label, status, description, children }: { label: string; status: string; description: string; children?: ReactNode }) {
  return <SettingsRow label={label} description={description}><span className={'permission-state permission-state--' + status}>{status}</span>{children}</SettingsRow>;
}
