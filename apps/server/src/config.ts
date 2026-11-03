import { z } from 'zod';

/**
 * Server configuration schema enforcing loopback-only binding.
 */
const ServerConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  HOST: z
    .string()
    .default('127.0.0.1')
    .refine(
      (h) => h === '127.0.0.1' || h === 'localhost' || h === '::1',
      { message: 'PAYSIM must bind strictly to local loopback (127.0.0.1)' }
    ),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_VERSION: z.string().default('1.0.0'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export function loadConfig(env = process.env): ServerConfig {
  return ServerConfigSchema.parse(env);
}

export const config = loadConfig();
