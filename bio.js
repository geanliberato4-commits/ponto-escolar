/* ============================================================
   bio.js — módulo de biometria
   "simulador": tela de teste (NÃO é leitura real de digital)
   "zk9500"  : conversa com o programa auxiliar local (ponte) via
               WebSocket em PONTE_BIO_URL. A ponte ainda NÃO existe /
               NÃO foi testada com o leitor físico — ver LEIA-ME.md.
   LGPD: os modelos (templates) da digital ficam só no computador da
   recepção, dentro da ponte. O banco guarda apenas QUANTAS digitais
   cada funcionário tem cadastradas.
   ============================================================ */
const Bio = (function () {
  const cfg = window.PONTO_CONFIG || {};
  const modo = cfg.BIOMETRIA || 'desligado';
  const ativo = () => modo !== 'desligado';

  function telaSimulador(titulo, texto, opcoes) {
    return new Promise(res => {
      const o = document.createElement('div');
      o.className = 'sim-overlay';
      o.innerHTML = `
        <div class="sim-box">
          <div class="sim-tag">SIMULADOR DE BIOMETRIA · não é leitura real</div>
          <div class="sim-dedo"><svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M20 46c-3-5-4-10-4-15a16 16 0 0 1 32 0c0 4-1 7-2 9"/><path d="M26 50c-3-5-4-12-4-19a10 10 0 0 1 20 0c0 6-1 11-3 15"/>
            <path d="M32 54c-2-6-3-14-3-23a3 3 0 0 1 6 0c0 9-1 15-3 20"/><path d="M14 22a20 20 0 0 1 36 0"/></svg></div>
          <h3>${titulo}</h3><p>${texto}</p>
          <div class="sim-ops">${opcoes.map((op, i) => `<button class="btn ${op.cls || 'sec'}" data-i="${i}">${op.txt}</button>`).join('')}</div>
        </div>`;
      o.addEventListener('click', ev => {
        const b = ev.target.closest('button[data-i]');
        if (!b) return;
        o.remove();
        res(opcoes[+b.dataset.i].v);
      });
      document.body.appendChild(o);
    });
  }

  function ponte(msg, timeout = 20000) {
    return new Promise(res => {
      let ws, fim = false;
      const acabar = r => { if (fim) return; fim = true; clearTimeout(t); try { ws && ws.close(); } catch (e) { /* */ } res(r); };
      const t = setTimeout(() => acabar({ ok: false, erro: 'Tempo esgotado aguardando o leitor.' }), timeout);
      try { ws = new WebSocket(cfg.PONTE_BIO_URL); }
      catch (e) { return acabar({ ok: false, erro: 'Ponte biométrica indisponível.' }); }
      ws.onopen = () => ws.send(JSON.stringify(msg));
      ws.onmessage = ev => { try { acabar(JSON.parse(ev.data)); } catch (e) { acabar({ ok: false, erro: 'Resposta inválida da ponte.' }); } };
      ws.onerror = () => acabar({ ok: false, erro: 'O programa auxiliar do leitor não está rodando neste computador.' });
    });
  }

  async function verificar(cpf, nome) {
    if (modo === 'simulador') {
      const v = await telaSimulador('Posicione o dedo no leitor', `Verificando a digital de <b>${nome}</b>`, [
        { txt: '✔ Simular digital reconhecida', v: 'ok', cls: 'verde' },
        { txt: '✖ Simular digital não reconhecida', v: 'nao', cls: 'vermelho' },
        { txt: 'Simular leitor desconectado', v: 'off', cls: 'sec' }
      ]);
      if (v === 'ok') return { ok: true, metodo: 'simulador' };
      if (v === 'nao') return { ok: false, erro: 'Digital não reconhecida. Tente novamente ou procure a secretaria.' };
      return { ok: false, erro: 'Leitor biométrico desconectado. Avise a secretaria.' };
    }
    if (modo === 'zk9500') {
      const r = await ponte({ acao: 'verificar', cpf: soDigitos(cpf) });
      return r.ok ? { ok: true, metodo: 'biometria' } : { ok: false, erro: r.erro || 'Falha na leitura da digital.' };
    }
    return { ok: true, metodo: 'cpf' };
  }

  async function cadastrar(func, dedo) {
    if (modo === 'simulador') {
      const v = await telaSimulador(`Cadastro do dedo ${dedo}`, `Funcionário: <b>${func.nome}</b><br>No leitor real serão 3 leituras do mesmo dedo.`, [
        { txt: '✔ Simular 3 leituras OK', v: 'ok', cls: 'verde' },
        { txt: '✖ Simular leitura ruim', v: 'nao', cls: 'vermelho' }
      ]);
      return v === 'ok' ? { ok: true } : { ok: false, erro: 'Qualidade da leitura insuficiente. Limpe o dedo e o sensor e tente de novo.' };
    }
    if (modo === 'zk9500') return ponte({ acao: 'cadastrar', cpf: soDigitos(func.cpf), funcionario_id: func.id, dedo }, 60000);
    return { ok: false, erro: 'Biometria desligada em config.js.' };
  }

  const descricao = { desligado: 'Biometria desligada (somente CPF)', simulador: 'Simulador de biometria (teste)', zk9500: 'Leitor ZKTeco ZK9500 (ponte local)' }[modo] || modo;
  return { modo, ativo, verificar, cadastrar, descricao };
})();
