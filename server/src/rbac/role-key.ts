import { pinyin } from 'pinyin-pro';

/** Generate a role key from Chinese/English name when not provided. */
export function generateRoleKey(name: string): string {
  const raw = name.trim();
  if (!raw) return `role_${Date.now().toString(36)}`;

  const ascii = raw
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_');
  if (ascii && /^[a-z]/.test(ascii)) {
    return ascii.slice(0, 64);
  }

  const py = pinyin(raw, { toneType: 'none', type: 'array' })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return (py || `role_${Date.now().toString(36)}`).slice(0, 64);
}

export const ROLE_KEY_DEALER = 'dealer';
export const ROLE_KEY_OPS = 'ops';
