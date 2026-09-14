import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

import Groq from 'groq-sdk';

export const GROQ_CONFIG = {
  get apiKey() {
    return process.env.GROQ_API_KEY || '';
  },
  get model() {
    return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  },
};

let _client: Groq | null = null;
export function getGroqClient(): Groq {
  if (!_client) {
    _client = new Groq({ apiKey: GROQ_CONFIG.apiKey || 'missing' });
  }
  return _client;
}

export const groqClient = new Proxy({} as Groq, {
  get(_target, prop) {
    return (getGroqClient() as any)[prop];
  },
});
