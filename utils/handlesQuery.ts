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
  toBase64Url(handles.map((handle) => handle.trim()).filter(Boolean).join(';'))
);

export const getHandlesFromQuery = (
  handles: string | string[] | undefined,
  compactHandles: string | string[] | undefined,
) => {
  if (typeof compactHandles === 'string') {
    try {
      const decodedHandles = fromBase64Url(compactHandles).split(';').filter(Boolean);
      if (decodedHandles.length > 0) return decodedHandles;
    } catch {
      return typeof handles === 'string' ? [handles] : handles || [];
    }
  }
  return typeof handles === 'string' ? [handles] : handles || [];
};
