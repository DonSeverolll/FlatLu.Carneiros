'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { FERRAMENTAS, type Ferramenta } from '@/lib/ferramentas';

type Dono = {
  id: string;
  full_name: string;
  username: string | null;
  email: string;
  status: string;
  is_dev: boolean;
  ferramentas: Ferramenta[];
  last_login_at: string | null;
};

/**
 * Área Dev: libera ou bloqueia cada ferramenta do painel para cada dono. Cada
 * clique salva na hora e vale no próximo pedido da pessoa (a página e a API
 * leem a liberação do banco a cada acesso).
 */
export default function DevView({ meuId }: { meuId: string }) {
  const [donos, setDonos] = useState<Dono[] | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    try {
      const r = await api<{ donos: Dono[] }>('/api/admin/dev/acessos');
      setDonos(r.donos);
    } catch (e) {
      setErro(messageFor(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(dono: Dono, ferramentas: Ferramenta[]) {
    setSalvando(dono.id);
    setErro('');
    setAviso('');
    const anterior = dono.ferramentas;
    setDonos((lista) => lista?.map((d) => (d.id === dono.id ? { ...d, ferramentas } : d)) ?? null);
    try {
      const r = await api<{ ferramentas: Ferramenta[] }>('/api/admin/dev/acessos', {
        method: 'PUT',
        body: { userId: dono.id, ferramentas }
      });
      setDonos((lista) => lista?.map((d) => (d.id === dono.id ? { ...d, ferramentas: r.ferramentas } : d)) ?? null);
      setAviso(`Acessos de ${dono.full_name} salvos.`);
    } catch (e) {
      setDonos((lista) => lista?.map((d) => (d.id === dono.id ? { ...d, ferramentas: anterior } : d)) ?? null);
      setErro(messageFor(e));
    } finally {
      setSalvando(null);
    }
  }

  function alternar(dono: Dono, chave: Ferramenta) {
    const tem = dono.ferramentas.includes(chave);
    void salvar(dono, tem ? dono.ferramentas.filter((c) => c !== chave) : [...dono.ferramentas, chave]);
  }

  const outros = donos?.filter((d) => !d.is_dev) ?? [];

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Dev</p>
          <h1>Ferramentas de cada dono.</h1>
        </div>
      </header>

      <section className="panel">
        <p className="hint">
          Marque o que cada administrador pode abrir no painel. Vale para a página e para os dados dela, e passa a
          valer no próximo clique da pessoa. Esta área e esta conta não aparecem para mais ninguém. Para alguém virar
          dono, defina a pessoa como Administrador em Usuários e libere aqui o que ela pode usar.
        </p>
        {/* Linha de status sempre presente: a mensagem aparecer não empurra a
            lista, e o próximo clique cai na caixa certa. */}
        <p aria-live="polite" className={erro ? 'field-error dev-status' : 'hint dev-status'}>
          {erro || aviso}
        </p>

        {donos === null ? (
          <p className="hint">Carregando…</p>
        ) : outros.length === 0 ? (
          <p className="hint">Nenhum outro administrador cadastrado.</p>
        ) : (
          <div className="dev-donos">
            {outros.map((d) => (
              <article className="dev-dono" key={d.id}>
                <header>
                  <div>
                    <strong>{d.full_name}</strong>
                    <small>
                      {d.username ? `@${d.username} · ` : ''}
                      {d.email}
                      {d.status !== 'ACTIVE' ? ' · suspenso' : ''}
                    </small>
                    <small>{d.last_login_at ? `Último acesso: ${dateTime(d.last_login_at)}` : 'Nunca entrou'}</small>
                  </div>
                  <div className="row-actions">
                    <span className="hint">
                      {d.ferramentas.length} de {FERRAMENTAS.length} liberadas
                    </span>
                    <button
                      className="chip"
                      disabled={salvando === d.id || d.ferramentas.length === FERRAMENTAS.length}
                      onClick={() => void salvar(d, FERRAMENTAS.map((f) => f.chave))}
                      type="button"
                    >
                      Liberar tudo
                    </button>
                    <button
                      className="chip"
                      disabled={salvando === d.id || d.ferramentas.length === 0}
                      onClick={() => void salvar(d, [])}
                      type="button"
                    >
                      Bloquear tudo
                    </button>
                  </div>
                </header>
                <ul className="dev-ferramentas">
                  {FERRAMENTAS.map((f) => {
                    const ligada = d.ferramentas.includes(f.chave);
                    return (
                      <li key={f.chave}>
                        <label className={ligada ? 'dev-ferramenta on' : 'dev-ferramenta'}>
                          <input
                            checked={ligada}
                            disabled={salvando === d.id}
                            onChange={() => alternar(d, f.chave)}
                            type="checkbox"
                          />
                          <span>
                            <strong>{f.rotulo}</strong>
                            <small>{f.hint}</small>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      {donos?.some((d) => d.is_dev && d.id === meuId) && (
        <p className="hint">Sua conta (Dev) tem acesso a todas as ferramentas e não aparece nesta lista.</p>
      )}
    </>
  );
}
