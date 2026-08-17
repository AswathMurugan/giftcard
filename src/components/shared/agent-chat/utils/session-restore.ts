export interface SessionRestoreRequest<T> {
  load: () => Promise<T>;
  apply: (history: T) => void;
  settle: () => void;
  cancelled: () => boolean;
}

/** Run one best-effort history restore without updating an obsolete target. */
export async function runSessionRestore<T>({
  load,
  apply,
  settle,
  cancelled,
}: SessionRestoreRequest<T>): Promise<void> {
  try {
    const history = await load();
    if (!cancelled()) apply(history);
  } catch {
    // Unreachable history degrades to a fresh session.
  } finally {
    if (!cancelled()) settle();
  }
}
