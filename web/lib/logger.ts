/** Dev-gated logger. No console.* calls anywhere else. */
const dev = process.env.NODE_ENV !== 'production';

export const logger = {
  log: (...args: unknown[]) => {
    if (dev) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (dev) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    console.error(...args);
  },
};
