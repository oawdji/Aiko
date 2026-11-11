import { DEFAULT_SERVER_PORT } from '@aiko/shared';

export type ServerConfig = {
  port: number;
};

export function loadServerConfig(): ServerConfig {
  const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${String(process.env.PORT)}`);
  }
  return { port };
}