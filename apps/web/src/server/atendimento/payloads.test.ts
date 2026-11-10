import { describe, expect, it } from 'vitest';
import { eventosInstagram, eventosWhatsApp, previa, proximoStatus } from './payloads';
import { corpoWhatsAppCloud } from './gateway';
import { waIdDoTelefone } from './inbox';

const lote = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', ...value } }] }]
});

describe('eventosWhatsApp', () => {
  it('traduz texto com nome do contato e referral de anúncio', () => {
    const eventos = eventosWhatsApp(
      lote({
        contacts: [{ wa_id: '5581987654321', profile: { name: 'Maria' } }],
        messages: [
          {
            from: '5581987654321',
            id: 'wamid.ABC',
            timestamp: '1767225600',
            type: 'text',
            text: { body: 'Tem vaga no réveillon?' },
            referral: { source_type: 'ad', source_id: '120210000000001', headline: 'Flat pé na areia', ctwa_clid: 'Afd123' }
          }
        ]
      })
    );
    expect(eventos).toHaveLength(1);
    const e = eventos[0]!;
    expect(e.evento).toBe('mensagem');
    if (e.evento !== 'mensagem') return;
    expect(e.contatoNome).toBe('Maria');
    expect(e.corpo).toBe('Tem vaga no réveillon?');
    expect(e.em.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(e.referral?.adId).toBe('120210000000001');
    expect(e.referral?.ctwaClid).toBe('Afd123');
  });

  it('classifica documento PDF e guarda o id da mídia', () => {
    const [e] = eventosWhatsApp(
      lote({
        messages: [
          {
            from: '5581987654321',
            id: 'wamid.PDF',
            type: 'document',
            document: { id: 'MEDIA1', mime_type: 'application/pdf', filename: 'comprovante.pdf', caption: 'segue' }
          }
        ]
      })
    );
    expect(e).toMatchObject({ tipo: 'PDF', midiaId: 'MEDIA1', midiaNomeArquivo: 'comprovante.pdf', corpo: 'segue' });
  });

  it('traduz status, com erro quando falha', () => {
    const eventos = eventosWhatsApp(
      lote({
        statuses: [
          { id: 'wamid.1', status: 'read', timestamp: '1767225600', recipient_id: '5581' },
          { id: 'wamid.2', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message' }] },
          { id: 'wamid.3', status: 'desconhecido' }
        ]
      })
    );
    expect(eventos.map((e) => (e.evento === 'status' ? e.status : null))).toEqual(['LIDA', 'FALHOU']);
    const falha = eventos[1]!;
    expect(falha.evento === 'status' && falha.erro).toBe('131047 Re-engagement message');
  });

  it('descarta item malformado sem perder o resto do lote', () => {
    const eventos = eventosWhatsApp(
      lote({
        messages: [
          { from: 'nao-e-numero', id: 'x', type: 'text', text: { body: 'a' } },
          { from: '5581987654321', id: 'wamid.OK', type: 'text', text: { body: 'b' } },
          { from: '5581987654321', id: 'wamid.R', type: 'reaction', reaction: { emoji: '👍' } }
        ]
      })
    );
    expect(eventos.map((e) => e.idExterno)).toEqual(['wamid.OK']);
  });

  it('ignora payload de outro objeto', () => {
    expect(eventosWhatsApp({ object: 'page', entry: [] })).toEqual([]);
    expect(eventosWhatsApp(null)).toEqual([]);
  });
});

describe('eventosInstagram', () => {
  const conta = '17840000000000001';

  it('mensagem recebida, eco e leitura', () => {
    const eventos = eventosInstagram(
      {
        object: 'instagram',
        entry: [
          {
            id: conta,
            messaging: [
              {
                sender: { id: '900001' },
                recipient: { id: conta },
                timestamp: 1767225600000,
                message: { mid: 'm_1', text: 'Oi!', referral: { ad_id: '120210000000002', source: 'ADS' } }
              },
              {
                sender: { id: conta },
                recipient: { id: '900001' },
                timestamp: 1767225660000,
                message: { mid: 'm_2', text: 'Olá, tudo bem?', is_echo: true }
              },
              { sender: { id: '900001' }, recipient: { id: conta }, timestamp: 1767225700000, read: { mid: 'm_2' } }
            ]
          }
        ]
      },
      conta
    );
    expect(eventos).toHaveLength(3);
    const [entrada, eco, leitura] = eventos;
    expect(entrada).toMatchObject({ direcao: 'ENTRADA', contatoId: '900001', corpo: 'Oi!' });
    expect(entrada!.evento === 'mensagem' && entrada!.referral?.adId).toBe('120210000000002');
    expect(eco).toMatchObject({ direcao: 'SAIDA', contatoId: '900001' });
    expect(leitura).toMatchObject({ evento: 'status', status: 'LIDA', ateAqui: true, contatoId: '900001' });
  });

  it('anexo vira mídia com URL', () => {
    const [e] = eventosInstagram(
      {
        object: 'instagram',
        entry: [
          {
            id: conta,
            messaging: [
              {
                sender: { id: '900001' },
                recipient: { id: conta },
                message: { mid: 'm_3', attachments: [{ type: 'image', payload: { url: 'https://cdn.exemplo/x.jpg' } }] }
              }
            ]
          }
        ]
      },
      conta
    );
    expect(e).toMatchObject({ tipo: 'IMAGEM', midiaUrl: 'https://cdn.exemplo/x.jpg', corpo: null });
  });
});

describe('proximoStatus', () => {
  it('só avança', () => {
    expect(proximoStatus('ENVIADA', 'LIDA')).toBe('LIDA');
    expect(proximoStatus('LIDA', 'ENTREGUE')).toBe('LIDA');
    expect(proximoStatus('PENDENTE', 'ENVIADA')).toBe('ENVIADA');
  });

  it('falha não apaga entrega', () => {
    expect(proximoStatus('ENVIADA', 'FALHOU')).toBe('FALHOU');
    expect(proximoStatus('ENTREGUE', 'FALHOU')).toBe('ENTREGUE');
    expect(proximoStatus('FALHOU', 'ENTREGUE')).toBe('ENTREGUE');
  });
});

describe('corpoWhatsAppCloud', () => {
  it('texto', () => {
    expect(corpoWhatsAppCloud({ canal: 'WHATSAPP', para: '5581', tipo: 'TEXTO', corpo: 'oi' })).toMatchObject({
      type: 'text',
      text: { body: 'oi' },
      to: '5581'
    });
  });

  it('PDF por id, com nome e legenda', () => {
    expect(
      corpoWhatsAppCloud({
        canal: 'WHATSAPP',
        para: '5581',
        tipo: 'PDF',
        midiaId: 'M1',
        midiaNomeArquivo: 'contrato.pdf',
        corpo: 'Seu contrato'
      })
    ).toMatchObject({ type: 'document', document: { id: 'M1', filename: 'contrato.pdf', caption: 'Seu contrato' } });
  });

  it('vídeo por link', () => {
    expect(
      corpoWhatsAppCloud({ canal: 'WHATSAPP', para: '5581', tipo: 'VIDEO', midiaUrl: 'https://cdn/flat.mp4' })
    ).toMatchObject({ type: 'video', video: { link: 'https://cdn/flat.mp4' } });
  });

  it('modelo', () => {
    expect(
      corpoWhatsAppCloud({
        canal: 'WHATSAPP',
        para: '5581',
        tipo: 'TEMPLATE',
        template: { nome: 'boas_vindas', idioma: 'pt_BR' }
      })
    ).toMatchObject({ type: 'template', template: { name: 'boas_vindas', language: { code: 'pt_BR' } } });
  });
});

describe('waIdDoTelefone', () => {
  it('acrescenta DDI 55 a número nacional', () => {
    expect(waIdDoTelefone('(81) 98765-4321')).toBe('5581987654321');
    expect(waIdDoTelefone('+55 81 98765-4321')).toBe('5581987654321');
    expect(waIdDoTelefone('123')).toBeNull();
    expect(waIdDoTelefone(null)).toBeNull();
  });
});

describe('previa', () => {
  it('rotula mídia e encurta', () => {
    expect(previa('PDF', null)).toBe('📄 PDF');
    expect(previa('TEXTO', 'a\n  b')).toBe('a b');
    expect(previa('TEXTO', 'x'.repeat(300))).toHaveLength(200);
  });
});
