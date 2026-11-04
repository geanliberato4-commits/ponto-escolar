/* ============================================================
   recepcao.js — tela de registro de ponto da recepção
   Fluxo: CPF -> identifica -> (biometria) -> confirma -> registra
   O horário gravado é SEMPRE o do servidor, nunca o do computador.
   ============================================================ */
(function () {
  const cfg = window.PONTO_CONFIG;
  const painel = document.getElementById('painel');
  const elHora = document.getElementById('hora');
  const elData = document.getElementById('data');
  const elAviso = document.getElementById('avisoRelogio');
  const KEY_FALHAS = 'ponto_falhas_pendentes';
  let offset = 0;          // diferença servidor - computador (ms)
  let timer = null;        // volta para a tela inicial
  let ocupado = false;

  document.getElementById('nomeEscola').textContent = cfg.ESCOLA;
  document.title = 'Ponto · ' + cfg.ESCOLA;
  const tags = [];
  if (DB.modo === 'demo') tags.push('<span class="tag amarelo">MODO DEMONSTRAÇÃO</span>');
  if (Bio.modo === 'simulador') tags.push('<span class="tag azul">SIMULADOR DE BIOMETRIA</span>');
  document.getElementById('modoInfo').innerHTML = tags.join(' ');

  /* ---------- relógio sincronizado com o servidor ---------- */
  function tick() {
    const agora = new Date(Date.now() + offset);
    elHora.textContent = partesLocais(agora).horaSeg;
    elData.textContent = agora.toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  }
  async function sincronizar() {
    try {
      const t0 = Date.now();
      const srv = await DB.horaServidor();
      const t1 = Date.now();
      offset = new Date(srv).getTime() - (t0 + t1) / 2;
      if (Math.abs(offset) > 60000) {
        elAviso.hidden = false;
        elAviso.textContent = `Relógio deste computador está ${Math.round(Math.abs(offset) / 1000)}s ${offset > 0 ? 'atrasado' : 'adiantado'}. O ponto usa o horário do servidor.`;
      } else elAviso.hidden = true;
      enviarFalhas();
    } catch (e) {
      registrarFalha('Sincronização do relógio: ' + (e.message || e));
      elAviso.hidden = false;
      elAviso.textContent = 'Sem conexão com o servidor. Os registros podem falhar.';
    }
  }

  /* ---------- falhas de comunicação (guardadas e enviadas depois) ---------- */
  function lerFalhas() { try { return JSON.parse(localStorage.getItem(KEY_FALHAS) || '[]'); } catch (e) { return []; } }
  function registrarFalha(det) {
    const f = lerFalhas(); f.push({ quando: new Date().toISOString(), det: String(det).slice(0, 250) });
    try { localStorage.setItem(KEY_FALHAS, JSON.stringify(f.slice(-50))); } catch (e) { /* */ }
  }
  async function enviarFalhas() {
    const f = lerFalhas();
    if (!f.length) return;
    try {
      for (const x of f) await DB.logFalha(`[${x.quando}] ${x.det}`, cfg.TERMINAL);
      localStorage.removeItem(KEY_FALHAS);
    } catch (e) { /* tenta de novo na próxima sincronização */ }
  }

  /* ---------- telas ---------- */
  function agendarReset(ms) { clearTimeout(timer); timer = setTimeout(telaCPF, ms); }

  function telaCPF() {
    clearTimeout(timer); ocupado = false;
    painel.innerHTML = `
      <h2 class="rc-tit">Registrar ponto</h2>
      <p class="rc-sub">Digite seu CPF</p>
      <input id="cpf" class="rc-cpf" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" maxlength="14">
      <div class="rc-teclado">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
        <button data-k="limpar" class="fn">Limpar</button><button data-k="0">0</button><button data-k="apagar" class="fn">⌫</button>
      </div>
      <button class="btn grande" id="btnContinuar">Continuar</button>
      <div class="rc-msg" id="msg"></div>`;
    const inp = document.getElementById('cpf');
    inp.focus();
    inp.addEventListener('input', () => { inp.value = formatarCPF(inp.value); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') continuar(); });
    painel.querySelector('.rc-teclado').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const d = soDigitos(inp.value);
      if (b.dataset.k === 'limpar') inp.value = '';
      else if (b.dataset.k === 'apagar') inp.value = formatarCPF(d.slice(0, -1));
      else inp.value = formatarCPF(d + b.dataset.k);
      inp.focus();
    });
    document.getElementById('btnContinuar').onclick = continuar;
  }

  async function continuar() {
    if (ocupado) return;
    const cpf = soDigitos(document.getElementById('cpf').value);
    const msg = document.getElementById('msg');
    if (cpf.length !== 11) { msg.textContent = 'Digite os 11 números do CPF.'; return; }
    if (!cpfValido(cpf)) { msg.textContent = 'CPF inválido. Confira os números.'; return; }
    ocupado = true; msg.textContent = 'Identificando…';
    try {
      const r = await DB.identificar(cpf, cfg.TERMINAL);
      if (!r.ok) return telaErro(r.erro);
      if (!r.proxima) return telaErro(`${r.nome}, as 4 batidas de hoje já foram registradas.`, 'info');
      telaConfirmar(cpf, r);
    } catch (e) { falhaComunicacao(e); }
  }

  function telaConfirmar(cpf, r) {
    ocupado = false;
    const usaBio = Bio.ativo() && r.digitais > 0;
    const passos = TIPOS.map((t, i) => `<li class="${i < r.qtd ? 'feito' : i === r.qtd ? 'atual' : ''}">${TIPO_CURTO[t]}</li>`).join('');
    painel.innerHTML = `
      <p class="rc-sub">Olá,</p>
      <h2 class="rc-nome">${r.nome}</h2>
      <ol class="rc-passos">${passos}</ol>
      <div class="rc-proxima">Próxima batida: <b>${TIPO_LABEL[r.proxima]}</b></div>
      ${usaBio ? '<p class="rc-sub">Confirme com sua digital</p>' : (Bio.ativo() ? '<p class="rc-nota">Você ainda não tem digital cadastrada. Registro apenas pelo CPF.</p>' : '')}
      <button class="btn grande verde" id="btnOk">${usaBio ? 'Ler digital e registrar' : 'Confirmar registro'}</button>
      <button class="btn grande sec" id="btnVoltar">Não sou eu / Cancelar</button>
      <p class="rc-nota">Se a próxima batida não estiver correta, não registre: procure a secretaria.</p>`;
    document.getElementById('btnVoltar').onclick = telaCPF;
    document.getElementById('btnOk').onclick = async () => {
      if (ocupado) return; ocupado = true;
      let metodo = 'cpf';
      if (usaBio) {
        const v = await Bio.verificar(cpf, r.nome);
        if (!v.ok) return telaErro(v.erro);
        metodo = v.metodo;
      }
      try {
        const x = await DB.registrar(cpf, r.proxima, metodo, cfg.TERMINAL);
        if (!x.ok) return telaErro(x.erro);
        telaSucesso(x);
      } catch (e) { falhaComunicacao(e); }
    };
    agendarReset(30000);
  }

  function telaSucesso(x) {
    painel.innerHTML = `
      <div class="rc-ok">✓</div>
      <h2 class="rc-tit">${TIPO_LABEL[x.tipo]} registrada</h2>
      <div class="rc-hora-reg">${partesLocais(x.momento).horaSeg}</div>
      <p class="rc-sub">${x.nome} · ${fmtData(partesLocais(x.momento).data)}</p>
      <button class="btn grande sec" id="btnNovo">Concluir</button>`;
    document.getElementById('btnNovo').onclick = telaCPF;
    agendarReset(6000);
  }

  function telaErro(msg, tipo) {
    painel.innerHTML = `
      <div class="rc-erro ${tipo === 'info' ? 'info' : ''}">${tipo === 'info' ? 'i' : '!'}</div>
      <h2 class="rc-tit">${tipo === 'info' ? 'Aviso' : 'Não registrado'}</h2>
      <p class="rc-sub">${msg}</p>
      <button class="btn grande" id="btnNovo">Voltar</button>`;
    document.getElementById('btnNovo').onclick = telaCPF;
    agendarReset(7000);
  }

  function falhaComunicacao(e) {
    registrarFalha('Registro/identificação: ' + (e && e.message || e));
    telaErro('Falha de comunicação com o servidor. O ponto NÃO foi registrado. Tente novamente; se persistir, avise a secretaria.');
  }

  setInterval(tick, 250); tick();
  sincronizar(); setInterval(sincronizar, 10 * 60 * 1000);
  telaCPF();
})();
