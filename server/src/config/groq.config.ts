import Groq from 'groq-sdk';

export const GROQ_CONFIG = {
  apiKey: process.env.GROQ_API_KEY || '',
  model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
};

export const groqClient = new Groq({ apiKey: GROQ_CONFIG.apiKey || 'missing' });
