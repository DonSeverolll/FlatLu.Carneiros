import { Pool, type PoolClient } from 'pg';
import { config } from './config';

/**
 * Em serverless cada invocação pode reusar o mesmo processo. Guardar o pool no
 * escopo global evita abrir uma conexão nova por request (e estourar o limite
 * do Postgres). `max` é baixo de propósito: a concorrência real vem da
 * quantidade de instâncias, não do tamanho do pool.
 */
const globalForPool = globalThis as unknown as { __carneirosPool?: Pool };

export function getPool(): Pool {
  if (!globalForPool.__carneirosPool) {
    globalForPool.__carneirosPool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000
    });
  }
  return globalForPool.__carneirosPool;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = []
) {
  return getPool().query<T>(sql, params as unknown[]);
}

/** Executa `handler` dentro de uma transação, com rollback garantido. */
export async function transaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Nome da constraint violada, quando o erro vem do PostgreSQL. */
export function violatedConstraint(error: unknown): string | undefined {
  return (error as { constraint?: string } | null)?.constraint;
}
