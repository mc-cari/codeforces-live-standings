const encodeBase64 = (value: string) => (
  typeof window === 'undefined' ? Buffer.from(value, 'utf8').toString('base64') : btoa(value)
);

const decodeBase64 = (value: string) => (
  typeof window === 'undefined' ? Buffer.from(value, 'base64').toString('utf8') : atob(value)
);

const toBase64Url = (value: string) => encodeBase64(value)
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return decodeBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
};

export const encodeHandles = (handles: string[]) => (
  toBase64Url(normalizeHandles(handles).join(';'))
);

export const getHandlesFromQuery = (
  handles: string | string[] | undefined,
  compactHandles: string | string[] | undefined,
) => {
  if (typeof compactHandles === 'string') {
    try {
      const decodedHandles = fromBase64Url(compactHandles).split(';').filter(Boolean);
      if (decodedHandles.length > 0) return normalizeHandles(decodedHandles);
    } catch {
      return normalizeHandles(typeof handles === 'string' ? [handles] : handles || []);
    }
  }
  return normalizeHandles(typeof handles === 'string' ? [handles] : handles || []);
};
export const normalizeHandles = (
  handles: string[],
  existingHandles: string[] = [],
): string[] => {
  const knownHandles = new Set(existingHandles.map((handle) => handle.toLocaleLowerCase()));
  return handles.reduce<string[]>((normalized, handle) => {
    const value = handle.trim();
    const identity = value.toLocaleLowerCase();
    if (value && !knownHandles.has(identity)) {
      knownHandles.add(identity);
      normalized.push(value);
    }
    return normalized;
  }, []);
};
