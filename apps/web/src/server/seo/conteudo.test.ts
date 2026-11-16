import { describe, expect, it } from 'vitest';
import { descricaoDoEspaco, perguntasFrequentes, tituloDoEspaco, type EspacoSeo } from './conteudo';
import { enderecoDe, jsonLdEspaco, jsonLdPerguntas } from './jsonld';

const flat: EspacoSeo = {
  slug: 'flat-praia-de-carneiros',
  name: 'Flat Praia de Carneiros',
  shortName: 'Flat Carneiros',
  description: 'Flat a poucos passos do mar',
  locationName: 'Praia de Carneiros, Tamandaré — PE',
  locationUrl: 'https://maps.app.goo.gl/x',
  maxGuests: 7,
  minNights: 1,
  checkInTime: '14:00:00',
  checkInUntil: '22:00:00',
  checkOutTime: '11:00:00',
  depositPercentage: '50.00',
  rates: { fromCents: 30000 }
};
const casa: EspacoSeo = {
  ...flat,
  slug: 'casa-sao-jose-terreo',
  shortName: 'Casa Térreo',
  locationName: 'São José da Coroa Grande — PE',
  maxGuests: 10,
  rates: { fromCents: null }
};

describe('títulos e descrições', () => {
  it('título leva o tipo, "para alugar" e o lugar com a preposição certa', () => {
    expect(tituloDoEspaco(flat)).toBe('Flat Carneiros para alugar na Praia de Carneiros, Tamandaré — PE');
    expect(tituloDoEspaco(casa)).toBe('Casa Térreo para alugar em São José da Coroa Grande — PE');
  });

  it('descrição só cita preço quando ele existe', () => {
    expect(descricaoDoEspaco(flat)).toMatch(/^Flat a poucos passos do mar\. Até 7 pessoas, diárias a partir de R\$\s?300,00\./);
    expect(descricaoDoEspaco(casa)).not.toMatch(/R\$/);
  });
});

describe('perguntas frequentes', () => {
  it('saem dos dados reais, sem inventar preço', () => {
    const p = perguntasFrequentes([flat, casa]);
    const preco = p.find((x) => x.pergunta === 'Quanto custa a diária?')!;
    expect(preco.resposta).toContain('Flat Carneiros');
    expect(preco.resposta).not.toContain('Casa Térreo');
    expect(p.find((x) => x.pergunta.startsWith('Qual o horário'))!.resposta).toBe(
      'Check-in a partir das 14:00 até as 22:00; check-out até as 11:00.'
    );
    expect(p.find((x) => x.pergunta === 'Como faço a reserva?')!.resposta).toContain('sinal de 50%');
  });

  it('sem espaços não há perguntas nem JSON-LD', () => {
    expect(perguntasFrequentes([])).toEqual([]);
    expect(jsonLdPerguntas([])).toBeNull();
  });
});

describe('dados estruturados', () => {
  it('endereço separa praia, cidade e UF', () => {
    expect(enderecoDe('Praia de Carneiros, Tamandaré — PE')).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Praia de Carneiros',
      addressLocality: 'Tamandaré',
      addressRegion: 'PE',
      addressCountry: 'BR'
    });
    expect(enderecoDe(null)).toBeNull();
  });

  it('oferta só aparece com preço publicado', () => {
    const comPreco = jsonLdEspaco(flat) as Record<string, unknown>;
    expect(comPreco['@type']).toBe('LodgingBusiness');
    expect((comPreco.makesOffer as { priceSpecification: { price: string } }).priceSpecification.price).toBe('300.00');
    expect('makesOffer' in jsonLdEspaco(casa)).toBe(false);
  });
});
