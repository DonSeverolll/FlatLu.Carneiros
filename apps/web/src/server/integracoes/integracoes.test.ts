import { describe, expect, it } from 'vitest';
import { chaveDeCifra, cifrar, decifrar, finalDoSegredo } from './cripto';
import { CATALOGO, CHAVES } from './catalogo';
import { dentroDoHorario, montarMensagens, montarSistema, pedeHumano } from '../agente/regras';

const chave = chaveDeCifra('uma-chave-de-teste-com-mais-de-32-caracteres');

describe('cifra das integrações', () => {
  it('ida e volta', () => {
    const pacote = cifrar('{"accessToken":"EAAG-segredo"}', 'WHATSAPP', chave);
    expect(pacote.startsWith('v1.')).toBe(true);
    expect(pacote).not.toContain('segredo');
    expect(decifrar(pacote, 'WHATSAPP', chave)).toBe('{"accessToken":"EAAG-segredo"}');
  });

  it('cada cifra usa IV novo', () => {
    expect(cifrar('x', 'WHATSAPP', chave)).not.toBe(cifrar('x', 'WHATSAPP', chave));
  });

  it('segredo copiado para outra integração não abre', () => {
    const pacote = cifrar('token', 'WHATSAPP', chave);
    expect(() => decifrar(pacote, 'INSTAGRAM', chave)).toThrow();
  });

  it('chave errada ou pacote adulterado não abre', () => {
    const pacote = cifrar('token', 'WHATSAPP', chave);
    expect(() => decifrar(pacote, 'WHATSAPP', chaveDeCifra('outra-chave-de-teste-com-mais-de-32-caracteres'))).toThrow();
    const [v, iv, tag, dado] = pacote.split('.');
    const adulterado = [v, iv, tag, `${dado!.slice(0, -2)}AA`].join('.');
    expect(() => decifrar(adulterado, 'WHATSAPP', chave)).toThrow();
  });

  it('recusa chave curta', () => {
    expect(() => chaveDeCifra('curta')).toThrow(/INTEGRATIONS_ENCRYPTION_KEY/);
  });

  it('mostra só o fim do segredo', () => {
    expect(finalDoSegredo('EAAGabcdefgh1234')).toBe('…1234');
    expect(finalDoSegredo('curto')).toBe('…');
  });
});

describe('catálogo', () => {
  it('toda integração tem campos com nome único e segredos com variável de ambiente', () => {
    expect(CATALOGO.map((c) => c.chave).sort()).toEqual([...CHAVES].sort());
    for (const item of CATALOGO) {
      const nomes = item.campos.map((c) => c.nome);
      expect(new Set(nomes).size).toBe(nomes.length);
      for (const campo of item.campos.filter((c) => c.tipo === 'segredo')) expect(campo.env).toBeTruthy();
    }
  });

  it('padrões dos campos são regex válidas e aceitam o próprio padrão', () => {
    for (const campo of CATALOGO.flatMap((c) => c.campos)) {
      if (!campo.padraoRegex) continue;
      const re = new RegExp(campo.padraoRegex);
      if (campo.padrao) expect(re.test(campo.padrao)).toBe(true);
    }
  });
});

describe('regras do agente', () => {
  // 2026-11-10 15:00 UTC = 12:00 em Recife (UTC-3).
  const meioDia = new Date('2026-11-10T15:00:00Z');
  const madrugada = new Date('2026-11-10T06:00:00Z'); // 03:00 em Recife

  it('horário de atendimento no fuso de Recife', () => {
    expect(dentroDoHorario(meioDia, '09:00', '18:00')).toBe(true);
    expect(dentroDoHorario(madrugada, '09:00', '18:00')).toBe(false);
  });

  it('faixa que cruza a meia-noite', () => {
    expect(dentroDoHorario(madrugada, '22:00', '06:00')).toBe(true);
    expect(dentroDoHorario(meioDia, '22:00', '06:00')).toBe(false);
  });

  it('palavra de transferência sem diferenciar acento nem caixa', () => {
    const palavras = ['reclamação', 'reembolso', 'cancelar'];
    expect(pedeHumano('Quero fazer uma RECLAMACAO', palavras)).toBe('reclamação');
    expect(pedeHumano('preciso cancelar minha reserva', palavras)).toBe('cancelar');
    expect(pedeHumano('tem vaga em janeiro?', palavras)).toBeNull();
    // Não casa no meio de outra palavra.
    expect(pedeHumano('descancelar', ['cancelar'])).toBeNull();
  });

  it('junta mensagens seguidas e apara o histórico nas pontas', () => {
    const mensagens = montarMensagens([
      { direcao: 'SAIDA', tipo: 'TEMPLATE', corpo: 'Modelo: boas_vindas' },
      { direcao: 'ENTRADA', tipo: 'TEXTO', corpo: 'Oi' },
      { direcao: 'ENTRADA', tipo: 'TEXTO', corpo: 'tem vaga sábado?' },
      { direcao: 'ENTRADA', tipo: 'IMAGEM', corpo: null },
      { direcao: 'SAIDA', tipo: 'TEXTO', corpo: 'Tem sim!' },
      { direcao: 'ENTRADA', tipo: 'TEXTO', corpo: 'quanto fica?' },
      { direcao: 'SAIDA', tipo: 'TEXTO', corpo: '' }
    ]);
    expect(mensagens).toEqual([
      { role: 'user', content: 'Oi\ntem vaga sábado?\n[o cliente enviou uma foto]' },
      { role: 'assistant', content: 'Tem sim!' },
      { role: 'user', content: 'quanto fica?' }
    ]);
  });

  it('termina sempre numa fala do cliente', () => {
    const mensagens = montarMensagens([
      { direcao: 'ENTRADA', tipo: 'TEXTO', corpo: 'Oi' },
      { direcao: 'SAIDA', tipo: 'TEXTO', corpo: 'Olá!' }
    ]);
    expect(mensagens).toEqual([{ role: 'user', content: 'Oi' }]);
  });

  it('sistema inclui os espaços com o código usado pela ferramenta', () => {
    const texto = montarSistema('Seja gentil.', {
      espacos: [
        {
          slug: 'flat-praia-de-carneiros', nome: 'Flat Carneiros', local: 'Tamandaré', capacidade: 7,
          checkIn: '09:00', checkInAte: '16:00', checkOut: '16:00', minNoites: 1, usoDiurno: true, descricao: null
        }
      ],
      site: 'https://exemplo.com'
    });
    expect(texto).toContain('Seja gentil.');
    expect(texto).toContain('"flat-praia-de-carneiros"');
    expect(texto).toContain('até 7 hóspedes');
    expect(texto).toContain('https://exemplo.com');
  });
});
