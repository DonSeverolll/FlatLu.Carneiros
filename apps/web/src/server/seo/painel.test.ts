import { describe, expect, it } from 'vitest';
import { roboDoGoogle } from './painel';
import { paraSitemap, type PaginaDoSite } from './paginas';

describe('roboDoGoogle', () => {
  it('reconhece os robôs do Google pelo user-agent', () => {
    expect(roboDoGoogle('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe('Googlebot');
    expect(roboDoGoogle('Googlebot-Image/1.0')).toBe('Googlebot-Image');
    expect(roboDoGoogle('Mozilla/5.0 (compatible; Google-InspectionTool/1.0)')).toBe('Google-InspectionTool');
  });

  it('ignora navegadores comuns e outros robôs', () => {
    expect(roboDoGoogle('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36')).toBeNull();
    expect(roboDoGoogle('Mozilla/5.0 (compatible; bingbot/2.0)')).toBeNull();
    expect(roboDoGoogle(null)).toBeNull();
  });
});

describe('paraSitemap', () => {
  const pagina: PaginaDoSite = {
    caminho: '/espacos/flat',
    titulo: 'Flat',
    tipo: 'Espaço',
    fotos: ['https://cdn/x.jpg'],
    videos: [{ titulo: 'Flat — vídeo 1', miniatura: 'https://cdn/t.jpg', descricao: 'Tour', url: 'https://cdn/v.mp4' }],
    frequencia: 'daily',
    prioridade: 0.9
  };

  it('só informa data quando a página tem data de revisão real', () => {
    const [viva, guia] = paraSitemap([pagina, { ...pagina, fotos: [], videos: [], atualizadoEm: '2026-11-16' }]);
    expect('lastModified' in viva!).toBe(false);
    expect(guia!.lastModified).toBe('2026-11-16');
    expect('images' in guia!).toBe(false);
  });

  it('leva fotos e vídeos no formato do sitemap', () => {
    const [e] = paraSitemap([pagina]);
    expect(e!.url).toMatch(/\/espacos\/flat$/);
    expect(e!.images).toEqual(['https://cdn/x.jpg']);
    expect(e!.videos?.[0]).toMatchObject({ title: 'Flat — vídeo 1', thumbnail_loc: 'https://cdn/t.jpg', content_loc: 'https://cdn/v.mp4' });
  });
});
