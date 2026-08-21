import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  JWT_SECRET: z.string().min(32),
  WEB_ORIGIN: z.string().url(),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16)
});

export const config = schema.parse(process.env);
