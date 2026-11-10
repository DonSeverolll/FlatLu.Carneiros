import { describe, expect, it } from 'vitest';
import { canalDoToque, hostDoReferrer, temParametroDeCampanha, touchSchema } from './attributionRules';

const toque = (dados: Record<string, string>) => touchSchema.parse(dados);

describe('touchSchema', () => {
  it('descarta parâmetro dinâmico não resolvido da pré-visualização da Meta', () => {
    const t = toque({ ad_id: '{{ad.id}}', utm_campaign: '{{campaign.name}}', utm_source: 'meta' });
    expect(t.ad_id).toBeUndefined();
    expect(t.utm_campaign).toBeUndefined();
    expect(t.utm_source).toBe('meta');
  });

  it('campo inválido some sem derrubar os outros', () => {
    const t = toque({ ad_id: '120210000000001', fbclid: 'x y z', landing_path: 'http://fora' });
    expect(t.ad_id).toBe('120210000000001');
    expect(t.fbclid).toBeUndefined();
    expect(t.landing_path).toBeUndefined();
  });

  it('visita sem campanha não vira toque', () => {
    expect(temParametroDeCampanha(toque({ landing_path: '/' }))).toBe(false);
    expect(temParametroDeCampanha(toque({ fbclid: 'IwAR0abcdefgh' }))).toBe(true);
  });
});

describe('canalDoToque', () => {
  it('ID de anúncio vence a UTM', () => {
    expect(canalDoToque(toque({ ad_id: '120210000000001', utm_source: 'google' }))).toBe('META_ADS');
  });

  it('fonte Meta com meio pago é anúncio; sem meio pago, orgânico', () => {
    expect(canalDoToque(toque({ utm_source: 'instagram', utm_medium: 'paid_social' }))).toBe('META_ADS');
    expect(canalDoToque(toque({ utm_source: 'instagram', utm_medium: 'bio' }))).toBe('INSTAGRAM');
  });

  it('fbclid sozinho é Facebook orgânico (link compartilhado)', () => {
    expect(canalDoToque(toque({ fbclid: 'IwAR0abcdefgh' }))).toBe('FACEBOOK');
  });

  it('gclid é Google Ads', () => {
    expect(canalDoToque(toque({ gclid: 'Cj0KCQiAabcdef' }))).toBe('GOOGLE_ADS');
  });

  it('cai no referrer quando não há UTM', () => {
    expect(canalDoToque(toque({ utm_term: 'x' }), 'l.instagram.com')).toBe('INSTAGRAM');
    expect(canalDoToque(toque({ utm_source: 'newsletter' }))).toBe('OUTRO');
  });
});

describe('hostDoReferrer', () => {
  it('guarda só o host e ignora o próprio site', () => {
    expect(hostDoReferrer('https://l.instagram.com/?u=email%40x.com', 'aptcarneiros.com.br')).toBe('l.instagram.com');
    expect(hostDoReferrer('https://aptcarneiros.com.br/cadastro', 'aptcarneiros.com.br')).toBeNull();
    expect(hostDoReferrer('lixo', null)).toBeNull();
  });
});
