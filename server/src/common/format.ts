export function money(n: number | string): string {
  return Number(n).toFixed(2);
}

export function genNo(prefix: string): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}${t}${r}`;
}

export function errorMessage(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'getResponse' in err &&
    typeof (err as { getResponse: () => unknown }).getResponse === 'function'
  ) {
    const r = (err as { getResponse: () => unknown }).getResponse();
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object' && 'message' in r) {
      const m = (r as { message: unknown }).message;
      return Array.isArray(m) ? m.join('; ') : String(m);
    }
  }
  return err instanceof Error ? err.message : String(err);
}
