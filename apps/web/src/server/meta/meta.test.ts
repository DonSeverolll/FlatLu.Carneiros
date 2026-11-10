import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appSecretProof, assinaturaValida } from './graph';
import { leadsDaMeta, normalizarInsight } from './insights';

describe('assinaturaValida', () => {
  const segredo = 'segredo-do-app-meta-123';
  const corpo = '{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[]}]}';
  const assinatura = `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`;

  it('aceita a assinatura do corpo cru', () => {
    expect(assinaturaValida(corpo, assinatura, segredo)).toBe(true);
  });

  it('recusa corpo re-serializado, segredo errado ou cabeçalho ausente', () => {
    const reserializado = JSON.stringify(JSON.parse(corpo), null, 1);
    expect(assinaturaValida(reserializado, assinatura, segredo)).toBe(false);
    expect(assinaturaValida(corpo, assinatura, 'outro-segredo-qualquer')).toBe(false);
    expect(assinaturaValida(corpo, null, segredo)).toBe(false);
    expect(assinaturaValida(corpo, 'sha1=abc', segredo)).toBe(false);
  });
});

describe('appSecretProof', () => {
  it('é o HMAC-SHA256 do token', () => {
    expect(appSecretProof('TOKEN', 'SEGREDO')).toBe(createHmac('sha256', 'SEGREDO').update('TOKEN').digest('hex'));
  });
});

describe('insights', () => {
  it('não soma o agregado "lead" com os subtipos', () => {
    expect(
      leadsDaMeta([
        { action_type: 'lead', value: '4' },
        { action_type: 'offsite_conversion.fb_pixel_lead', value: '3' },
        { action_type: 'onsite_conversion.lead_grouped', value: '1' }
      ])
    ).toBe(4);
    expect(leadsDaMeta([{ action_type: 'offsite_conversion.fb_pixel_lead', value: '3' }])).toBe(3);
    expect(leadsDaMeta(undefined)).toBe(0);
  });

  it('normaliza a linha diária e recusa linha sem anúncio', () => {
    expect(
      normalizarInsight({
        ad_id: '120210000000001',
        date_start: '2026-11-01',
        spend: '12.345',
        clicks: '10',
        inline_link_clicks: '7',
        actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '2' }]
      })
    ).toMatchObject({ spend: 12.35, clicks: 10, linkClicks: 7, conversas: 2, leads: 0 });
    expect(normalizarInsight({ date_start: '2026-11-01' })).toBeNull();
  });
});
