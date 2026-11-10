import { afterAll, describe, expect, it } from 'vitest';
import { addDaysIso, todayIso } from '../dates';
import { getPool, query } from '../db';
import { consultarDisponibilidade } from './agente';

/**
 * Ferramenta de disponibilidade do agente contra um banco de verdade.
 *
 * Só roda com E2E_DATABASE_URL apontando para um banco DESCARTÁVEL com as
 * migrações aplicadas e tarifas publicadas (o teste cria e apaga um bloqueio):
 *
 *   E2E_DATABASE_URL=postgresql://... DATABASE_URL=$E2E_DATABASE_URL DATABASE_SSL=false \
 *     npx vitest run src/server/agente/disponibilidade.db.test.ts
 */
const ativo = Boolean(process.env.E2E_DATABASE_URL);

describe.skipIf(!ativo)('consultar_disponibilidade (banco real)', () => {
  const espaco = 'flat-praia-de-carneiros';
  const entrada = addDaysIso(todayIso(), 40);
  const saida = addDaysIso(entrada, 2);

  afterAll(async () => {
    await query(
      `DELETE FROM inventory_blocks WHERE source = 'MAINTENANCE' AND reservation_id IS NULL
          AND blocked_nights = daterange($1::date, $2::date)`,
      [entrada, saida]
    ).catch(() => undefined);
    await getPool().end();
  });

  it('livre: devolve total e sinal calculados pelo motor de tarifas', async () => {
    const r = (await consultarDisponibilidade({ espaco, entrada, saida, hospedes: 2 })) as Record<string, unknown>;
    expect(r.disponivel).toBe(true);
    expect(r.noites).toBe(2);
    expect(Number(r.total)).toBeGreaterThan(0);
    expect(Number(r.sinal)).toBeLessThanOrEqual(Number(r.total));
  });

  it('ocupado por bloqueio: não está disponível', async () => {
    const { rows } = await query<{ id: string }>(`SELECT id FROM properties WHERE slug = $1`, [espaco]);
    await query(
      `INSERT INTO inventory_blocks (property_id, source, blocked_nights)
       VALUES ($1, 'MAINTENANCE', daterange($2::date, $3::date))`,
      [rows[0]!.id, entrada, saida]
    );
    const r = (await consultarDisponibilidade({ espaco, entrada, saida, hospedes: 2 })) as Record<string, unknown>;
    expect(r.disponivel).toBe(false);
  });

  it('recusa o que não faz sentido sem consultar tarifa', async () => {
    expect(await consultarDisponibilidade({ espaco: 'nao-existe', entrada, saida, hospedes: 2 })).toHaveProperty('erro');
    expect(await consultarDisponibilidade({ espaco, entrada: '2020-01-01', saida: '2020-01-02', hospedes: 2 })).toMatchObject({ disponivel: false });
    expect(await consultarDisponibilidade({ espaco, entrada, saida, hospedes: 99 })).toMatchObject({ disponivel: false });
    expect(await consultarDisponibilidade({ espaco, entrada: '30/12', saida, hospedes: 2 })).toHaveProperty('erro');
  });
});
