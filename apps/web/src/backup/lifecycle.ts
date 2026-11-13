// The shell checks unsaved-work guards and unmounts apps before local stores change.
type Prepare = () => Promise<(() => void) | null>;
let prepare: Prepare | undefined;
export function registerBackupPreparation(handler: Prepare) {
  prepare = handler;
  return () => { if (prepare === handler) prepare = undefined; };
}
export async function prepareForRestore() {
  return prepare ? prepare() : () => {};
}
