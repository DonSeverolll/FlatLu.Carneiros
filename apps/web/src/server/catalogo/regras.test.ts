import { describe, expect, it } from 'vitest';
import { achatarMidias, classificarPorLegenda } from './regras';

const espacos = [
  { id: 'flat', nome: 'Flat Carneiros', palavras: ['carneiros', 'tamandaré', 'flat'] },
  { id: 'terreo', nome: 'Casa Térreo', palavras: ['térreo', 'piscina'] },
  { id: 'andar', nome: 'Casa 1º Andar', palavras: ['1º andar', 'primeiro andar', 'varanda'] }
];

describe('achatarMidias', () => {
  it('post simples vira uma linha', () => {
    const [l] = achatarMidias([
      { id: '17900000000000001', media_type: 'IMAGE', media_url: 'https://cdn/x.jpg', caption: ' Pôr do sol ', permalink: 'https://instagram.com/p/a', timestamp: '2026-10-01T12:00:00+0000' }
    ]);
    expect(l).toMatchObject({ igMediaId: '17900000000000001', albumId: null, tipo: 'IMAGE', legenda: 'Pôr do sol' });
    expect(l!.publicadoEm).toBe('2026-10-01T12:00:00.000Z');
  });

  it('carrossel vira uma linha por item, com a legenda do post', () => {
    const linhas = achatarMidias([
      {
        id: '17900000000000010',
        media_type: 'CAROUSEL_ALBUM',
        caption: 'Flat em Carneiros',
        permalink: 'https://instagram.com/p/b',
        children: {
          data: [
            { id: '17900000000000011', media_type: 'IMAGE', media_url: 'https://cdn/1.jpg' },
            { id: '17900000000000012', media_type: 'VIDEO', media_url: 'https://cdn/2.mp4', thumbnail_url: 'https://cdn/2.jpg' }
          ]
        }
      }
    ]);
    expect(linhas.map((l) => [l.igMediaId, l.albumId, l.tipo, l.legenda])).toEqual([
      ['17900000000000011', '17900000000000010', 'IMAGE', 'Flat em Carneiros'],
      ['17900000000000012', '17900000000000010', 'VIDEO', 'Flat em Carneiros']
    ]);
  });

  it('descarta item sem id válido, sem URL https ou de tipo desconhecido', () => {
    expect(
      achatarMidias([
        { id: 'abc', media_type: 'IMAGE', media_url: 'https://cdn/x.jpg' },
        { id: '17900000000000020', media_type: 'IMAGE', media_url: 'ftp://cdn/x.jpg' },
        { id: '17900000000000021', media_type: 'IMAGE' },
        { id: '17900000000000022', media_type: 'STORY', media_url: 'https://cdn/x.jpg' }
      ])
    ).toEqual([]);
  });
});

describe('classificarPorLegenda', () => {
  it('um espaço citado: sugere esse espaço', () => {
    expect(classificarPorLegenda('Fim de tarde na piscina do térreo 🌅', espacos)?.propertyId).toBe('terreo');
    expect(classificarPorLegenda('Vista da varanda do 1º andar', espacos)?.propertyId).toBe('andar');
    expect(classificarPorLegenda('Manhã em TAMANDARE', espacos)?.propertyId).toBe('flat');
  });

  it('mais de um espaço citado ou nenhum: não adivinha', () => {
    expect(classificarPorLegenda('Do flat em Carneiros à piscina da casa, escolha o seu!', espacos)).toBeNull();
    expect(classificarPorLegenda('Reserve já 😍', espacos)).toBeNull();
    expect(classificarPorLegenda(null, espacos)).toBeNull();
  });

  it('palavra inteira, não pedaço de outra', () => {
    expect(classificarPorLegenda('#flatlife em outra cidade', [{ id: 'f', nome: 'F', palavras: ['flat'] }])).toBeNull();
  });

  it('explica o motivo', () => {
    expect(classificarPorLegenda('Carneiros hoje', espacos)?.motivo).toBe('legenda cita "carneiros"');
  });
});
