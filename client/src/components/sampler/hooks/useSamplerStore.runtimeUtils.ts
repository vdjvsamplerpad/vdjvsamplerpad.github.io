export const yieldToMainThread = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

export const getNowMs = (): number =>
  (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const generateOperationId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

