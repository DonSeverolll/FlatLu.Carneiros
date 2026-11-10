import { requireAdmin } from '@/server/auth';
import { badRequest } from '@/server/errors';
import { assertSameOrigin, handle, json } from '@/server/http';
import { uploadMidiaWhatsApp } from '@/server/atendimento/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 4 MB, não os 16/100 MB que o WhatsApp aceita: o corpo de uma função no
 * Vercel para em 4,5 MB. Vídeo do flat vai por URL pública (CDN, Supabase
 * Storage), que não passa por aqui.
 */
const MAX_BYTES = 4 * 1024 * 1024;

const ACEITOS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'IMAGEM',
  'image/png': 'IMAGEM',
  'image/webp': 'IMAGEM',
  'video/mp4': 'VIDEO',
  'video/3gpp': 'VIDEO'
};

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await requireAdmin();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw badRequest('INVALID_UPLOAD');
    }
    const arquivo = form.get('arquivo');
    if (!(arquivo instanceof File) || arquivo.size === 0) throw badRequest('INVALID_UPLOAD');
    if (arquivo.size > MAX_BYTES) throw badRequest('FILE_TOO_LARGE', { maxBytes: MAX_BYTES });
    const tipo = ACEITOS[arquivo.type];
    if (!tipo) throw badRequest('FILE_TYPE_NOT_ALLOWED', { aceitos: Object.keys(ACEITOS) });

    const { midiaId, simulado } = await uploadMidiaWhatsApp(arquivo);
    return json(
      {
        midiaId,
        simulado,
        tipo,
        midiaMime: arquivo.type,
        midiaNomeArquivo: arquivo.name.slice(0, 240)
      },
      201
    );
  });
}
