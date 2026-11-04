/* ============================================================
   admin.js — painel administrativo da direção
   Páginas: Dashboard, Funcionários, Escalas e horários, Registros,
   Banco de horas, Ocorrências, Relatórios, Configurações
   Regras de ouro:
   - batidas originais NUNCA são editadas nem apagadas;
     correção = invalidar (com motivo) + lançar batida de ajuste
   - mudança de horário = novo registro com vigência (sem retroatividade)
   - toda ação de escrita vai para a auditoria
   ============================================================ */
(function () {
  const cfg = window.PONTO_CONFIG;
  const S = { sessao: null, funcionarios: [], escalas: [], versoes: [], alteracoes: [], ocorrencias: [], feriados: [], invalidadas: [], config: {}, filtro: {} };
  const PAGINAS = [
    ['dashboard', 'Dashboard'], ['funcionarios', 'Funcionários'], ['escalas', 'Escalas e horários'],
    ['registros', 'Registros de ponto'], ['banco', 'Banco de horas'], ['ocorrencias', 'Ocorrências'],
    ['relatorios', 'Relatórios'], ['config', 'Configurações']
  ];
  const PAG = {};
  let pagina = 'dashboard';

  /* ---------------- utilitários ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const podeEditar = () => ['admin', 'gestor'].includes(S.sessao && S.sessao.perfil);
  const ehAdmin = () => S.sessao && S.sessao.perfil === 'admin';
  const funcPorId = id => S.funcionarios.find(f => f.id == id);
  const msgErro = e => (e && e.message) || String(e);
  const classeSaldo = m => m > 0 ? 'pos' : m < 0 ? 'neg' : '';

  function toast(msg, tipo = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast ' + tipo; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 4200);
  }

  function modal(titulo, corpo, { ok = 'Salvar', onOk, largo } = {}) {
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.innerHTML = `<form class="modal ${largo ? 'largo' : ''}" novalidate>
      <div class="modal-cab"><h3>${h(titulo)}</h3><button type="button" class="x" data-fechar>×</button></div>
      <div class="modal-corpo">${corpo}</div>
      <div class="modal-rod"><button type="button" class="btn sec" data-fechar>${onOk ? 'Cancelar' : 'Fechar'}</button>${onOk ? `<button class="btn" type="submit">${ok}</button>` : ''}</div>
    </form>`;
    const fechar = () => o.remove();
    o.querySelectorAll('[data-fechar]').forEach(b => b.onclick = fechar);
    o.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target), dados = {};
      for (const [k, v] of fd.entries()) dados[k] = typeof v === 'string' ? v.trim() : v;
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      try { const r = await onOk(dados, o); if (r !== false) fechar(); }
      catch (err) { toast(msgErro(err), 'erro'); }
      btn.disabled = false;
    };
    document.body.appendChild(o);
    const pri = o.querySelector('input,select,textarea'); if (pri) pri.focus();
    return o;
  }

  // confirmação dentro do site (substitui o confirm() do navegador)
  function confirmar(msg, ok = 'Confirmar') {
    return new Promise(res => {
      const o = modal('Confirmar', `<p>${h(msg)}</p>`, { ok, onOk: async () => { res(true); } });
      o.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => res(false)));
    });
  }

  async function auditar(acao, detalhe) {
    try { await DB.inserir('auditoria', { acao, detalhe }); } catch (e) { console.warn('auditoria', e); }
  }
  async function gravar(t, row, acao) {
    const r = await DB.inserir(t, row);
    await auditar(acao, { tabela: t, id: r.id ?? r.data ?? null, dados: row });
    return r;
  }

  const opcoesFunc = (sel, todos) => (todos ? `<option value="">Todos os funcionários</option>` : '') +
    S.funcionarios.filter(f => f.ativo || f.id == sel).map(f => `<option value="${f.id}" ${f.id == sel ? 'selected' : ''}>${h(f.nome)}</option>`).join('');
  const opcoesEscala = sel => S.escalas.map(e => { const v = versaoEscala(e.id, hojeLocal(), S.versoes); return `<option value="${e.id}" ${e.id == sel ? 'selected' : ''}>${h(e.nome)} · ${v ? v.entrada.slice(0, 5) + '–' + v.saida.slice(0, 5) : ''}</option>`; }).join('');

  /* ---------------- dados ---------------- */
  async function carregarBase() {
    const [f, e, v, a, o, fe, inv, c] = await Promise.all([
      DB.listar('funcionarios', { order: 'nome' }), DB.listar('escalas', { order: 'id' }),
      DB.listar('escala_versoes', { order: 'vigencia_inicio' }), DB.listar('alteracoes', { order: 'criado_em' }),
      DB.listar('ocorrencias', { order: 'data_inicio' }), DB.listar('feriados', { order: 'data' }),
      DB.listar('batidas_invalidadas'), DB.listar('configuracoes')
    ]);
    Object.assign(S, { funcionarios: f, escalas: e, versoes: v, alteracoes: a, ocorrencias: o, feriados: fe, invalidadas: inv });
    S.config = c[0] || { id: 1, tolerancia_min: 5, tolerancia_clt: false, dias_uteis: [1, 2, 3, 4, 5] };
    S.config.dias_uteis = (S.config.dias_uteis || [1, 2, 3, 4, 5]).map(Number);
  }
  async function batidasPeriodo(ini, fim) {
    const b = await DB.listar('batidas', { gte: { data: ini }, lte: { data: fim }, order: 'momento' });
    const inv = new Map(S.invalidadas.map(i => [i.batida_id, i]));
    return b.map(x => ({ ...x, invalidada: inv.get(x.id) || null }));
  }
  function agrupar(bats) {
    const m = {};
    for (const b of bats) (m[b.funcionario_id + '|' + b.data] = m[b.funcionario_id + '|' + b.data] || []).push(b);
    return m;
  }
  function calcPeriodo(func, ini, fim, grupo) {
    const dias = []; let extra = 0, devida = 0, trab = 0, prev = 0;
    for (let d = ini; d <= fim; d = addDias(d, 1)) {
      const todas = grupo[func.id + '|' + d] || [];
      const r = calcularDia(func, d, todas.filter(b => !b.invalidada), S);
      r.todas = todas;
      dias.push(r);
      extra += r.extra; devida += r.devida; trab += r.trabalhado;
      if (r.status !== 'andamento' && r.status !== 'aguardando') prev += r.prevista;
    }
    return { func, dias, extra, devida, saldo: extra - devida, trabalhado: trab, prevista: prev };
  }
  window.ADM = { S, batidasPeriodo, agrupar, calcPeriodo, toast, auditar };

  /* ---------------- seletor de período ---------------- */
  function periodoHTML(ini, fim) {
    return `<div class="periodo">
      <label>De <input type="date" id="pIni" value="${ini}"></label>
      <label>Até <input type="date" id="pFim" value="${fim}"></label>
      <button class="btn sec peq" data-p="hoje">Hoje</button>
      <button class="btn sec peq" data-p="mes">Mês atual</button>
      <button class="btn sec peq" data-p="ant">Mês anterior</button>
      <button class="btn peq" data-p="aplicar">Aplicar</button></div>`;
  }
  function ligarPeriodo(c, onMudar) {
    c.querySelector('.periodo').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const hj = hojeLocal(); let ini, fim;
      if (b.dataset.p === 'hoje') { ini = fim = hj; }
      else if (b.dataset.p === 'mes') { ini = inicioMes(hj); fim = fimMes(hj); }
      else if (b.dataset.p === 'ant') { const x = addDias(inicioMes(hj), -1); ini = inicioMes(x); fim = fimMes(x); }
      else { ini = $('#pIni').value; fim = $('#pFim').value; }
      if (!ini || !fim || ini > fim) return toast('Período inválido.', 'erro');
      S.filtro.ini = ini; S.filtro.fim = fim; onMudar();
    });
  }
  const periodoAtual = () => {
    const hj = hojeLocal();
    return { ini: S.filtro.ini || inicioMes(hj), fim: S.filtro.fim || fimMes(hj) };
  };

  /* ---------------- navegação ---------------- */
  function montarMenu() {
    $('#menu').innerHTML = PAGINAS.map(([id, nome]) => `<a href="#${id}" data-p="${id}">${nome}<span class="cont" id="cont-${id}"></span></a>`).join('');
    $('#menu').onclick = e => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); ir(a.dataset.p); document.body.classList.remove('menu-aberto'); };
  }
  function atualizarContadores() {
    const pend = S.ocorrencias.filter(o => o.status === 'pendente').length;
    const el = $('#cont-ocorrencias'); if (el) el.textContent = pend ? pend : '';
  }
  function ir(p) {
    if (!PAG[p]) p = 'dashboard';
    pagina = p; history.replaceState(null, '', '#' + p);
    document.querySelectorAll('#menu a').forEach(a => a.classList.toggle('ativo', a.dataset.p === p));
    $('#tituloMobile').textContent = PAGINAS.find(x => x[0] === p)[1];
    render();
  }
  async function render() {
    const c = $('#conteudo');
    c.innerHTML = '<div class="carregando">Carregando…</div>';
    try { await PAG[pagina](c); atualizarContadores(); }
    catch (e) { console.error(e); c.innerHTML = `<div class="alerta erro">Erro ao carregar: ${h(msgErro(e))}</div>`; }
  }
  async function recarregar() { await carregarBase(); await render(); }

  /* ================= DASHBOARD ================= */
  PAG.dashboard = async c => {
    const hj = hojeLocal(), ini = inicioMes(hj);
    const g = agrupar(await batidasPeriodo(ini, hj));
    const ativos = S.funcionarios.filter(f => f.ativo);
    let presentes = 0, entraram = 0, semRegistro = 0, atrasos = 0, ext = 0, dev = 0;
    const linhas = ativos.map(f => {
      const per = calcPeriodo(f, ini, hj, g);
      ext += per.extra; dev += per.devida;
      const d = per.dias[per.dias.length - 1];
      const m = d.marc;
      if (m.entrada != null) entraram++;
      if (m.entrada != null && m.saida == null) presentes++;
      if (m.entrada == null && d.prevista > 0) semRegistro++;
      const atr = d.flags.find(x => x.t === 'atraso'); if (atr) atrasos++;
      let sit = STATUS_LABEL[d.status];
      if (m.saida != null) sit = 'Jornada encerrada';
      else if (m.almoco_saida != null && m.almoco_retorno == null) sit = 'No almoço';
      else if (m.entrada != null) sit = 'Presente';
      return `<tr><td><b>${h(f.nome)}</b><div class="peq mut">${h(f.cargo || '')}</div></td><td>${h(d.horario.rotulo)}</td>
        ${TIPOS.map(t => `<td class="num">${min2hm(m[t])}</td>`).join('')}
        <td><span class="pill ${sit === 'Presente' ? 'verde' : sit === 'No almoço' ? 'azul' : d.prevista > 0 && m.entrada == null ? 'cinza' : ''}">${sit}</span>
        ${atr ? `<span class="pill vermelho">${atr.txt}</span>` : ''}</td></tr>`;
    }).join('');
    const pend = S.ocorrencias.filter(o => o.status === 'pendente').length;
    c.innerHTML = `
      <div class="cab"><div><h1>Dashboard</h1><p class="mut">${new Date().toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long' })} · acumulado de ${fmtData(ini)} até hoje</p></div>
        ${pend ? `<a class="alerta aviso link" href="#ocorrencias" data-ir="ocorrencias">${pend} ocorrência(s) aguardando aprovação →</a>` : ''}</div>
      <div class="kpis">
        <div class="kpi"><span>Funcionários ativos</span><b>${ativos.length}</b></div>
        <div class="kpi"><span>Presentes agora</span><b>${presentes}</b><small>${entraram} registraram entrada hoje</small></div>
        <div class="kpi"><span>Sem registro hoje</span><b>${semRegistro}</b></div>
        <div class="kpi"><span>Atrasos do dia</span><b class="${atrasos ? 'neg' : ''}">${atrasos}</b></div>
        <div class="kpi"><span>Horas extras (mês)</span><b class="pos">${dur(ext)}</b></div>
        <div class="kpi"><span>Horas devidas (mês)</span><b class="neg">${dur(dev)}</b></div>
        <div class="kpi destaque"><span>Saldo geral (mês)</span><b class="${classeSaldo(ext - dev)}">${durSaldo(ext - dev)}</b></div>
      </div>
      <div class="card"><h2>Hoje</h2><div class="tabela-wrap"><table>
        <thead><tr><th>Funcionário</th><th>Horário previsto</th>${TIPOS.map(t => `<th>${TIPO_CURTO[t]}</th>`).join('')}<th>Situação</th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="7" class="vazio">Nenhum funcionário cadastrado.</td></tr>'}</tbody></table></div></div>`;
    const lk = c.querySelector('[data-ir]'); if (lk) lk.onclick = e => { e.preventDefault(); ir('ocorrencias'); };
  };

  /* ================= FUNCIONÁRIOS ================= */
  PAG.funcionarios = async c => {
    const hj = hojeLocal();
    c.innerHTML = `
      <div class="cab"><div><h1>Funcionários</h1><p class="mut">${S.funcionarios.filter(f => f.ativo).length} ativos · capacidade inicial 20</p></div>
        ${podeEditar() ? '<button class="btn" id="novo">+ Novo funcionário</button>' : ''}</div>
      <div class="card"><div class="tabela-wrap"><table>
        <thead><tr><th>Nome</th><th>CPF</th><th>Cargo</th><th>Admissão</th><th>Horário vigente</th><th>Digitais</th><th>Situação</th><th></th></tr></thead>
        <tbody>${S.funcionarios.map(f => `<tr class="${f.ativo ? '' : 'inativo'}">
          <td><b>${h(f.nome)}</b></td><td class="num">${mascaraCPF(f.cpf)}</td><td>${h(f.cargo || '')}</td><td>${fmtData(f.admissao)}</td>
          <td>${h(resolverHorario(f, hj, S).rotulo)}</td><td>${f.digitais || 0}/2</td>
          <td><span class="pill ${f.ativo ? 'verde' : 'cinza'}">${f.ativo ? 'Ativo' : 'Inativo'}</span></td>
          <td class="acoes">${podeEditar() ? `<button class="btn sec peq" data-ed="${f.id}">Editar</button><button class="btn sec peq" data-bio="${f.id}">Digital</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum funcionário.</td></tr>'}</tbody>
      </table></div></div>
      <p class="peq mut">Para mudar a escala ou o horário de alguém, use <b>Escalas e horários</b> — assim fica o histórico com vigência e motivo.</p>`;
    const nv = $('#novo'); if (nv) nv.onclick = () => formFuncionario();
    c.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => formFuncionario(funcPorId(b.dataset.ed)));
    c.querySelectorAll('[data-bio]').forEach(b => b.onclick = () => formDigital(funcPorId(b.dataset.bio)));
  };

  function formFuncionario(f) {
    const novo = !f;
    modal(novo ? 'Novo funcionário' : 'Editar funcionário', `
      <label>Nome completo<input name="nome" required value="${h(f && f.nome)}"></label>
      <div class="grid2">
        <label>CPF<input name="cpf" required inputmode="numeric" value="${f ? formatarCPF(f.cpf) : ''}" oninput="this.value=formatarCPF(this.value)"></label>
        <label>Data de admissão<input name="admissao" type="date" required value="${h(f && f.admissao)}"></label>
      </div>
      <label>Cargo<input name="cargo" required value="${h(f && f.cargo)}"></label>
      ${novo ? `<label>Escala inicial<select name="escala_id">${opcoesEscala(1)}</select></label>`
        : `<label class="check"><input type="checkbox" name="ativo" ${f.ativo ? 'checked' : ''}> Funcionário ativo (desmarque em caso de desligamento — o histórico é mantido)</label>`}`,
      {
        onOk: async d => {
          const cpf = soDigitos(d.cpf);
          if (!d.nome || d.nome.split(/\s+/).length < 2) throw new Error('Informe o nome completo.');
          if (!cpfValido(cpf)) throw new Error('CPF inválido.');
          if (S.funcionarios.some(x => x.cpf === cpf && (!f || x.id !== f.id))) throw new Error('Já existe funcionário com este CPF.');
          if (novo) {
            if (S.funcionarios.filter(x => x.ativo).length >= 20 && !(await confirmar('Já existem 20 funcionários ativos (capacidade inicial). Cadastrar mesmo assim?'))) return false;
            await gravar('funcionarios', { nome: d.nome, cpf, cargo: d.cargo, admissao: d.admissao, escala_id: +d.escala_id, ativo: true, digitais: 0 }, 'funcionario.criar');
            toast('Funcionário cadastrado.');
          } else {
            const patch = { nome: d.nome, cpf, cargo: d.cargo, admissao: d.admissao, ativo: d.ativo === 'on' };
            await DB.atualizar('funcionarios', 'id', f.id, patch);
            await auditar('funcionario.editar', { id: f.id, antes: { nome: f.nome, cpf: mascaraCPF(f.cpf), cargo: f.cargo, admissao: f.admissao, ativo: f.ativo }, depois: { ...patch, cpf: mascaraCPF(cpf) } });
            toast('Cadastro atualizado.');
          }
          await recarregar();
        }
      });
  }

  function formDigital(f) {
    if (!Bio.ativo()) return modal('Biometria', '<p>A biometria está desligada em <code>config.js</code> (BIOMETRIA: "desligado").</p>');
    modal(`Digital · ${f.nome}`, `
      <div class="alerta info">${h(Bio.descricao)}. ${Bio.modo === 'simulador' ? 'Nenhuma digital real é capturada no simulador.' : 'O cadastro precisa ser feito no computador da recepção, onde o leitor está ligado.'}</div>
      <p>Digitais cadastradas: <b>${f.digitais || 0} de 2</b></p>
      <label>Qual dedo cadastrar?<select name="dedo"><option value="1">Dedo 1 (principal)</option><option value="2">Dedo 2 (reserva)</option></select></label>
      <p class="peq mut">LGPD: o modelo da digital fica somente na ponte local da recepção. No banco fica apenas a quantidade cadastrada.</p>`,
      {
        ok: 'Iniciar captura', onOk: async d => {
          const r = await Bio.cadastrar(f, +d.dedo);
          if (!r.ok) throw new Error(r.erro || 'Falha no cadastro da digital.');
          const n = Math.max(f.digitais || 0, +d.dedo);
          await DB.atualizar('funcionarios', 'id', f.id, { digitais: n });
          await auditar('biometria.cadastrar', { id: f.id, dedo: +d.dedo, modo: Bio.modo });
          toast('Digital cadastrada' + (Bio.modo === 'simulador' ? ' (simulação).' : '.'));
          await recarregar();
        }
      });
  }

  /* ================= ESCALAS E HORÁRIOS ================= */
  PAG.escalas = async c => {
    const hj = hojeLocal();
    const cards = S.escalas.map(e => {
      const v = versaoEscala(e.id, hj, S.versoes);
      const fut = S.versoes.filter(x => x.escala_id === e.id && x.vigencia_inicio > hj);
      const qtd = S.funcionarios.filter(f => f.ativo && resolverHorario(f, hj, S).escalaId === e.id).length;
      const jor = v ? hm2min(v.saida) - hm2min(v.entrada) - 60 : 0;
      return `<div class="escala"><h3>${h(e.nome)}</h3>
        <div class="escala-h">${v ? v.entrada.slice(0, 5) : '--'} <span>→</span> ${v ? v.saida.slice(0, 5) : '--'}</div>
        <div class="peq mut">Jornada ${dur(jor)} + 1h almoço · ${qtd} funcionário(s)</div>
        ${fut.map(x => `<div class="pill azul">A partir de ${fmtData(x.vigencia_inicio)}: ${x.entrada.slice(0, 5)}–${x.saida.slice(0, 5)}</div>`).join('')}
        ${podeEditar() ? `<button class="btn sec peq" data-esc="${e.id}">Alterar horário da escala</button>` : ''}</div>`;
    }).join('');
    const hist = [...S.alteracoes].reverse().map(a => {
      const f = funcPorId(a.funcionario_id);
      const novo = a.entrada ? `${a.entrada.slice(0, 5)}–${a.saida.slice(0, 5)}` : (S.escalas.find(e => e.id == a.escala_id) || {}).nome;
      return `<tr><td>${fmtData(partesLocais(a.criado_em).data)}</td><td>${h(f ? f.nome : '#' + a.funcionario_id)}</td>
        <td><span class="pill ${a.tipo === 'temporaria' ? 'azul' : ''}">${a.tipo === 'temporaria' ? 'Temporária' : 'Permanente'}</span></td>
        <td>${fmtData(a.data_inicio)}${a.tipo === 'temporaria' ? ' a ' + fmtData(a.data_fim || a.data_inicio) : ' em diante'}</td>
        <td class="num">${h(a.anterior || '—')}</td><td class="num"><b>${h(novo)}</b></td><td>${h(a.motivo)}</td><td class="peq">${h(a.admin_email || '')}</td></tr>`;
    }).join('');
    const histEsc = [...S.versoes].filter(v => v.vigencia_inicio > '2000-01-01').reverse().map(v => `<tr><td>${fmtData(partesLocais(v.criado_em).data)}</td>
      <td>${h((S.escalas.find(e => e.id === v.escala_id) || {}).nome)}</td><td>${fmtData(v.vigencia_inicio)}</td>
      <td class="num">${v.entrada.slice(0, 5)}–${v.saida.slice(0, 5)}</td><td>${h(v.motivo)}</td><td class="peq">${h(v.admin_email || '')}</td></tr>`).join('');
    c.innerHTML = `
      <div class="cab"><div><h1>Escalas e horários</h1><p class="mut">Jornada padrão: 8h24 trabalhadas + 1h de almoço flexível (9h24 de permanência)</p></div>
        ${podeEditar() ? '<button class="btn" id="altFunc">Alterar horário de funcionário</button>' : ''}</div>
      <div class="escalas">${cards}</div>
      <div class="card"><h2>Histórico de alterações por funcionário</h2><div class="tabela-wrap"><table>
        <thead><tr><th>Registrado em</th><th>Funcionário</th><th>Tipo</th><th>Vigência</th><th>Anterior</th><th>Novo</th><th>Motivo</th><th>Responsável</th></tr></thead>
        <tbody>${hist || '<tr><td colspan="8" class="vazio">Nenhuma alteração registrada.</td></tr>'}</tbody></table></div></div>
      <div class="card"><h2>Histórico de horários das escalas</h2><div class="tabela-wrap"><table>
        <thead><tr><th>Registrado em</th><th>Escala</th><th>Vale a partir de</th><th>Horário</th><th>Motivo</th><th>Responsável</th></tr></thead>
        <tbody>${histEsc || '<tr><td colspan="6" class="vazio">Horários originais, sem alterações.</td></tr>'}</tbody></table></div></div>`;
    c.querySelectorAll('[data-esc]').forEach(b => b.onclick = () => formEscala(+b.dataset.esc));
    const af = $('#altFunc'); if (af) af.onclick = () => formAlteracao();
  };

  function campoRetroativo() {
    return `<label class="check"><input type="checkbox" name="retro"> Permitir data passada (recalcula o banco de horas desses dias; as batidas originais não mudam)</label>`;
  }
  async function validarHorario(ent, sai) {
    const a = hm2min(ent), b = hm2min(sai);
    if (a == null || b == null || b - a <= 60) throw new Error('Horário inválido: a saída precisa ser mais de 1h depois da entrada.');
    const j = b - a - 60;
    if (j !== JORNADA_PADRAO && !(await confirmar(`A jornada resultante será ${dur(j)} (padrão 8h24). Confirmar?`))) return false;
    return true;
  }

  function formEscala(id) {
    const e = S.escalas.find(x => x.id === id), v = versaoEscala(id, hojeLocal(), S.versoes);
    modal(`Alterar ${e.nome}`, `
      <p class="mut">Atual: <b>${v.entrada.slice(0, 5)}–${v.saida.slice(0, 5)}</b>. Vale para todos os funcionários desta escala, a partir da data escolhida.</p>
      <div class="grid2"><label>Nova entrada<input type="time" name="entrada" required value="${v.entrada.slice(0, 5)}"></label>
      <label>Nova saída<input type="time" name="saida" required value="${v.saida.slice(0, 5)}"></label></div>
      <label>Vale a partir de<input type="date" name="inicio" required value="${hojeLocal()}"></label>
      ${campoRetroativo()}
      <label>Motivo<textarea name="motivo" required rows="2"></textarea></label>`,
      {
        onOk: async d => {
          if (!d.motivo) throw new Error('Informe o motivo.');
          if (d.inicio < hojeLocal() && !d.retro) throw new Error('Data no passado: marque a opção para permitir.');
          if (!(await validarHorario(d.entrada, d.saida))) return false;
          await gravar('escala_versoes', { escala_id: id, entrada: d.entrada, saida: d.saida, vigencia_inicio: d.inicio, motivo: d.motivo }, 'escala.alterar');
          toast('Novo horário da escala registrado.'); await recarregar();
        }
      });
  }

  function formAlteracao() {
    const o = modal('Alterar horário de funcionário', `
      <label>Funcionário<select name="funcionario_id" required>${opcoesFunc()}</select></label>
      <div class="grid2"><label>Tipo<select name="tipo"><option value="permanente">Permanente</option><option value="temporaria">Temporária (data específica / período)</option></select></label>
      <label>Novo horário<select name="modo"><option value="escala">Usar uma escala</option><option value="personalizado">Horário personalizado</option></select></label></div>
      <div data-modo="escala"><label>Escala<select name="escala_id">${opcoesEscala(1)}</select></label></div>
      <div data-modo="personalizado" hidden class="grid2"><label>Entrada<input type="time" name="entrada"></label><label>Saída<input type="time" name="saida"></label></div>
      <div class="grid2"><label>A partir de<input type="date" name="data_inicio" required value="${hojeLocal()}"></label>
      <label data-temp hidden>Até (inclusive)<input type="date" name="data_fim"></label></div>
      ${campoRetroativo()}
      <label>Motivo<textarea name="motivo" required rows="2"></textarea></label>
      <div class="peq mut" id="anterior"></div>`,
      {
        onOk: async d => {
          const f = funcPorId(d.funcionario_id);
          if (!d.motivo) throw new Error('Informe o motivo.');
          if (d.data_inicio < hojeLocal() && !d.retro) throw new Error('Data no passado: marque a opção para permitir.');
          if (d.tipo === 'temporaria' && d.data_fim && d.data_fim < d.data_inicio) throw new Error('A data final é anterior à inicial.');
          const row = { funcionario_id: f.id, tipo: d.tipo, data_inicio: d.data_inicio, data_fim: d.tipo === 'temporaria' ? (d.data_fim || d.data_inicio) : null, motivo: d.motivo, escala_id: null, entrada: null, saida: null };
          if (d.modo === 'personalizado') {
            if (!(await validarHorario(d.entrada, d.saida))) return false;
            row.entrada = d.entrada; row.saida = d.saida;
          } else row.escala_id = +d.escala_id;
          const ant = resolverHorario(f, d.data_inicio, S);
          row.anterior = `${ant.escalaNome} ${min2hm(ant.entrada)}–${min2hm(ant.saida)}`;
          await gravar('alteracoes', row, 'horario.alterar');
          toast('Alteração registrada.'); await recarregar();
        }
      });
    const sel = n => o.querySelector(`[name=${n}]`);
    const atualizar = () => {
      o.querySelector('[data-modo=escala]').hidden = sel('modo').value !== 'escala';
      o.querySelector('[data-modo=personalizado]').hidden = sel('modo').value !== 'personalizado';
      o.querySelector('[data-temp]').hidden = sel('tipo').value !== 'temporaria';
      const f = funcPorId(sel('funcionario_id').value);
      if (f) o.querySelector('#anterior').textContent = 'Horário vigente nessa data: ' + resolverHorario(f, sel('data_inicio').value || hojeLocal(), S).rotulo;
    };
    o.addEventListener('change', atualizar); atualizar();
  }

  /* ================= REGISTROS DE PONTO ================= */
  PAG.registros = async c => {
    const { ini, fim } = periodoAtual();
    const fid = S.filtro.func || (S.funcionarios.find(f => f.ativo) || {}).id;
    const f = funcPorId(fid);
    let tabela = '<p class="vazio">Cadastre um funcionário primeiro.</p>', resumo = '';
    if (f) {
      const per = calcPeriodo(f, ini, fim, agrupar(await batidasPeriodo(ini, fim)));
      tabela = `<div class="tabela-wrap"><table class="registros">
        <thead><tr><th>Data</th><th>Horário previsto</th>${TIPOS.map(t => `<th>${TIPO_CURTO[t]}</th>`).join('')}<th>Trabalhado</th><th>Previsto</th><th>Saldo</th><th>Ocorrências</th></tr></thead>
        <tbody>${per.dias.map(d => linhaDia(d)).join('')}</tbody></table></div>`;
      resumo = resumoHTML(per);
    }
    const tent = await DB.listar('tentativas', { order: 'momento', desc: true, limit: 40 });
    c.innerHTML = `
      <div class="cab"><div><h1>Registros de ponto</h1><p class="mut">Registros originais são preservados. Correções ficam marcadas como ajuste.</p></div>
        ${podeEditar() ? '<button class="btn" id="manual">+ Batida de ajuste</button>' : ''}</div>
      <div class="card filtros"><label>Funcionário<select id="selFunc">${opcoesFunc(fid)}</select></label>${periodoHTML(ini, fim)}</div>
      ${resumo}
      <div class="card">${tabela}</div>
      <div class="card"><h2>Tentativas e ocorrências do terminal</h2><div class="tabela-wrap"><table>
        <thead><tr><th>Quando</th><th>CPF</th><th>Funcionário</th><th>Resultado</th><th>Detalhe</th><th>Terminal</th></tr></thead>
        <tbody>${tent.map(t => `<tr><td class="num">${fmtData(partesLocais(t.momento || t.criado_em).data)} ${partesLocais(t.momento || t.criado_em).horaSeg}</td>
          <td class="num">${h(t.cpf_mascarado || '')}</td><td>${h((funcPorId(t.funcionario_id) || {}).nome || '—')}</td>
          <td><span class="pill ${t.resultado === 'registrado' ? 'verde' : t.resultado === 'falha_comunicacao' ? 'amarelo' : 'vermelho'}">${h(t.resultado)}</span></td>
          <td>${h(TIPO_LABEL[t.detalhe] || t.detalhe || '')}</td><td>${h(t.terminal || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma tentativa.</td></tr>'}</tbody></table></div></div>`;
    $('#selFunc').onchange = e => { S.filtro.func = e.target.value; render(); };
    ligarPeriodo(c, render);
    const mn = $('#manual'); if (mn) mn.onclick = () => formManual(fid);
    c.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => formInvalidar(+b.dataset.inv));
    c.querySelectorAll('[data-info]').forEach(b => b.onclick = () => infoBatida(+b.dataset.info));
  };

  function resumoHTML(per) {
    return `<div class="kpis tres">
      <div class="kpi"><span>Horas extras</span><b class="pos">${dur(per.extra)}</b></div>
      <div class="kpi"><span>Horas devidas</span><b class="neg">${dur(per.devida)}</b></div>
      <div class="kpi destaque"><span>Saldo líquido</span><b class="${classeSaldo(per.saldo)}">${durSaldo(per.saldo)}</b><small>Trabalhado ${dur(per.trabalhado)} de ${dur(per.prevista)} previstos</small></div></div>`;
  }

  let _batidasTela = {};
  function celulaBatidas(d, tipo) {
    const bs = d.todas.filter(b => b.tipo === tipo).sort((a, b) => a.momento < b.momento ? -1 : 1);
    if (!bs.length) return '<span class="mut">—</span>';
    return bs.map(b => {
      _batidasTela[b.id] = b;
      const hr = partesLocais(b.momento).hora;
      const cls = b.invalidada ? 'bt inv' : b.origem === 'ajuste' ? 'bt aj' : 'bt';
      return `<span class="${cls}"><button class="lnk" data-info="${b.id}" title="Detalhes">${hr}</button>${b.origem === 'ajuste' ? '<i>aj</i>' : ''}${!b.invalidada && podeEditar() ? `<button class="lnk x" data-inv="${b.id}" title="Invalidar batida">×</button>` : ''}</span>`;
    }).join('');
  }
  function linhaDia(d) {
    if (d.status === 'futuro') return `<tr class="futuro"><td>${fmtData(d.data)} <span class="mut">${DIAS_SEMANA[diaSemana(d.data)]}</span></td><td colspan="9" class="mut">—</td></tr>`;
    const semExp = d.prevista === 0 && !d.todas.length;
    const flags = d.flags.map(x => `<span class="pill ${['atraso', 'falta', 'batida_esquecida', 'saida_antecipada', 'almoco_excedente'].includes(x.t) ? 'vermelho' : ['he_ok'].includes(x.t) ? 'verde' : x.t === 'feriado' || x.t === 'dispensa' ? 'azul' : 'amarelo'}">${h(x.txt)}</span>`).join('');
    const status = ['andamento', 'aguardando'].includes(d.status) ? `<span class="pill cinza">${STATUS_LABEL[d.status]}</span>` : '';
    return `<tr class="${semExp ? 'folga' : ''}"><td>${fmtData(d.data)} <span class="mut">${DIAS_SEMANA[diaSemana(d.data)]}</span></td>
      <td class="peq">${d.prevista ? h(d.horario.rotulo) : (d.feriado ? 'Feriado' : d.dispensa ? 'Dispensado' : 'Sem expediente')}</td>
      ${TIPOS.map(t => `<td class="num">${celulaBatidas(d, t)}</td>`).join('')}
      <td class="num">${d.todas.length ? dur(d.trabalhado) : '—'}</td><td class="num">${d.prevista ? dur(d.prevista) : '—'}</td>
      <td class="num ${classeSaldo(d.saldo)}"><b>${d.saldo ? durSaldo(d.saldo) : (d.todas.length || d.prevista ? '0h00' : '—')}</b></td>
      <td>${status}${flags}</td></tr>`;
  }

  function infoBatida(id) {
    const b = _batidasTela[id]; if (!b) return;
    const p = partesLocais(b.momento);
    modal('Detalhes da batida', `<dl class="dl">
      <dt>Funcionário</dt><dd>${h((funcPorId(b.funcionario_id) || {}).nome)}</dd>
      <dt>Tipo</dt><dd>${TIPO_LABEL[b.tipo]}</dd><dt>Data/hora</dt><dd>${fmtData(p.data)} ${p.horaSeg}</dd>
      <dt>Origem</dt><dd>${b.origem === 'ajuste' ? 'Ajuste administrativo' : 'Recepção'} · método ${h(b.metodo || '')}</dd>
      <dt>Terminal</dt><dd>${h(b.terminal || '—')}</dd>
      ${b.origem === 'ajuste' ? `<dt>Lançado por</dt><dd>${h(b.admin_email || '')}</dd><dt>Motivo</dt><dd>${h(b.motivo || '')}</dd>` : ''}
      ${b.invalidada ? `<dt>Invalidada</dt><dd>${h(b.invalidada.motivo)} · ${h(b.invalidada.admin_email || '')}</dd>` : ''}
      <dt>Gravado em</dt><dd>${b.criado_em ? fmtData(partesLocais(b.criado_em).data) + ' ' + partesLocais(b.criado_em).horaSeg : '—'}</dd></dl>`);
  }

  function formInvalidar(id) {
    const b = _batidasTela[id];
    modal('Invalidar batida', `<div class="alerta aviso">A batida de <b>${TIPO_LABEL[b.tipo]}</b> às <b>${partesLocais(b.momento).horaSeg}</b> continuará gravada (riscada) e deixará de contar no cálculo.</div>
      <label>Motivo<textarea name="motivo" required rows="2"></textarea></label>`,
      {
        ok: 'Invalidar', onOk: async d => {
          if (!d.motivo) throw new Error('Informe o motivo.');
          await gravar('batidas_invalidadas', { batida_id: id, motivo: d.motivo }, 'batida.invalidar');
          toast('Batida invalidada.'); await recarregar();
        }
      });
  }

  function formManual(fid) {
    modal('Batida de ajuste', `
      <div class="alerta info">Use para batidas esquecidas ou corrigidas. Fica marcada como <b>ajuste</b>, com seu usuário e o motivo.</div>
      <label>Funcionário<select name="funcionario_id">${opcoesFunc(fid)}</select></label>
      <div class="grid3"><label>Data<input type="date" name="data" required value="${hojeLocal()}"></label>
      <label>Tipo<select name="tipo">${TIPOS.map(t => `<option value="${t}">${TIPO_LABEL[t]}</option>`).join('')}</select></label>
      <label>Hora<input type="time" name="hora" required></label></div>
      <label>Motivo<textarea name="motivo" required rows="2" placeholder="Ex.: esqueceu de registrar o retorno do almoço, confirmado pela coordenação"></textarea></label>`,
      {
        ok: 'Lançar ajuste', onOk: async d => {
          if (!d.motivo || !d.hora) throw new Error('Preencha hora e motivo.');
          if (d.data > hojeLocal()) throw new Error('Não é possível lançar batida no futuro.');
          const ex = await DB.listar('batidas', { eq: { funcionario_id: +d.funcionario_id, data: d.data, tipo: d.tipo } });
          const inv = new Set(S.invalidadas.map(i => i.batida_id));
          if (ex.some(b => !inv.has(b.id))) throw new Error(`Já existe ${TIPO_LABEL[d.tipo]} válida nesse dia. Invalide-a antes (botão × na batida).`);
          await gravar('batidas', { funcionario_id: +d.funcionario_id, tipo: d.tipo, data: d.data, momento: isoLocal(d.data, d.hora), origem: 'ajuste', metodo: 'manual', terminal: 'ADMIN', motivo: d.motivo }, 'batida.ajuste');
          toast('Batida de ajuste lançada.'); await recarregar();
        }
      });
  }

  /* ================= BANCO DE HORAS ================= */
  PAG.banco = async c => {
    const { ini, fim } = periodoAtual();
    const g = agrupar(await batidasPeriodo(ini, fim));
    const pers = S.funcionarios.filter(f => f.ativo).map(f => calcPeriodo(f, ini, fim, g));
    const T = pers.reduce((t, p) => ({ extra: t.extra + p.extra, devida: t.devida + p.devida, trabalhado: t.trabalhado + p.trabalhado, prevista: t.prevista + p.prevista }), { extra: 0, devida: 0, trabalhado: 0, prevista: 0 });
    T.saldo = T.extra - T.devida;
    c.innerHTML = `
      <div class="cab"><div><h1>Banco de horas</h1><p class="mut">${fmtData(ini)} a ${fmtData(fim)} · extras e devidas sempre separadas, sem compensação escondida</p></div></div>
      <div class="card filtros">${periodoHTML(ini, fim)}</div>
      ${resumoHTML(T)}
      <div class="card"><div class="tabela-wrap"><table>
        <thead><tr><th>Funcionário</th><th>Horário vigente</th><th>Dias previstos</th><th>Trabalhado</th><th>Previsto</th><th>Horas extras</th><th>Horas devidas</th><th>Saldo líquido</th><th></th></tr></thead>
        <tbody>${pers.map(p => `<tr><td><b>${h(p.func.nome)}</b></td><td class="peq">${h(resolverHorario(p.func, fim < hojeLocal() ? fim : hojeLocal(), S).rotulo)}</td>
          <td class="num">${p.dias.filter(d => d.prevista > 0 && d.status !== 'futuro').length}</td>
          <td class="num">${dur(p.trabalhado)}</td><td class="num">${dur(p.prevista)}</td>
          <td class="num pos">${dur(p.extra)}</td><td class="num neg">${dur(p.devida)}</td>
          <td class="num ${classeSaldo(p.saldo)}"><b>${durSaldo(p.saldo)}</b></td>
          <td><button class="btn sec peq" data-ver="${p.func.id}">Ver dias</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3"><b>Total</b></td><td class="num">${dur(T.trabalhado)}</td><td class="num">${dur(T.prevista)}</td>
          <td class="num pos"><b>${dur(T.extra)}</b></td><td class="num neg"><b>${dur(T.devida)}</b></td><td class="num ${classeSaldo(T.saldo)}"><b>${durSaldo(T.saldo)}</b></td><td></td></tr></tfoot>
      </table></div></div>`;
    ligarPeriodo(c, render);
    c.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { S.filtro.func = b.dataset.ver; ir('registros'); });
  };

  /* ================= OCORRÊNCIAS ================= */
  PAG.ocorrencias = async c => {
    const { ini, fim } = periodoAtual();
    const g = agrupar(await batidasPeriodo(ini, fim));
    const auto = [];
    for (const f of S.funcionarios.filter(x => x.ativo)) {
      for (const d of calcPeriodo(f, ini, fim, g).dias)
        for (const fl of d.flags) if (['atraso', 'falta', 'saida_antecipada', 'almoco_excedente', 'batida_esquecida', 'sem_almoco'].includes(fl.t)) auto.push({ f, d, fl });
    }
    const pend = S.ocorrencias.filter(o => o.status === 'pendente');
    const dec = S.ocorrencias.filter(o => o.status !== 'pendente' && o.data_inicio <= fim && (o.data_fim || o.data_inicio) >= ini).reverse();
    const linhaOc = (o, acoes) => `<tr><td>${h((funcPorId(o.funcionario_id) || {}).nome)}</td><td>${h(OCORRENCIA_TIPOS[o.tipo] || o.tipo)}${o.minutos ? ` · ${dur(+o.minutos)}` : ''}</td>
      <td class="num">${fmtData(o.data_inicio)}${o.data_fim && o.data_fim !== o.data_inicio ? ' a ' + fmtData(o.data_fim) : ''}</td><td>${h(o.descricao || '')}</td>
      <td class="peq">${h(o.admin_email || '')}</td>
      <td>${acoes ? (podeEditar() ? `<button class="btn verde peq" data-ap="${o.id}">Aprovar</button> <button class="btn vermelho peq" data-rj="${o.id}">Rejeitar</button>` : '<span class="pill amarelo">Pendente</span>')
        : `<span class="pill ${o.status === 'aprovada' ? 'verde' : 'vermelho'}">${o.status === 'aprovada' ? 'Aprovada' : 'Rejeitada'}</span> <span class="peq mut">${h(o.decidido_por || '')}</span>`}</td></tr>`;
    c.innerHTML = `
      <div class="cab"><div><h1>Ocorrências</h1><p class="mut">Justificativas, abonos, férias, afastamentos e HE autorizadas só afetam o cálculo depois de aprovadas.</p></div>
        ${podeEditar() ? '<button class="btn" id="novaOc">+ Nova ocorrência</button>' : ''}</div>
      <div class="card"><h2>Pendentes de aprovação <span class="pill amarelo">${pend.length}</span></h2><div class="tabela-wrap"><table>
        <thead><tr><th>Funcionário</th><th>Tipo</th><th>Período</th><th>Descrição</th><th>Lançado por</th><th></th></tr></thead>
        <tbody>${pend.map(o => linhaOc(o, true)).join('') || '<tr><td colspan="6" class="vazio">Nada pendente.</td></tr>'}</tbody></table></div></div>
      <div class="card filtros">${periodoHTML(ini, fim)}</div>
      <div class="card"><h2>Detectadas automaticamente no período <span class="pill cinza">${auto.length}</span></h2><div class="tabela-wrap"><table>
        <thead><tr><th>Data</th><th>Funcionário</th><th>Ocorrência</th><th></th></tr></thead>
        <tbody>${auto.map((a, i) => `<tr><td class="num">${fmtData(a.d.data)} <span class="mut">${DIAS_SEMANA[diaSemana(a.d.data)]}</span></td><td>${h(a.f.nome)}</td>
          <td><span class="pill vermelho">${h(a.fl.txt)}</span></td>
          <td>${podeEditar() ? `<button class="btn sec peq" data-just="${i}">Justificar / abonar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhuma irregularidade no período.</td></tr>'}</tbody></table></div></div>
      <div class="card"><h2>Decididas no período</h2><div class="tabela-wrap"><table>
        <thead><tr><th>Funcionário</th><th>Tipo</th><th>Período</th><th>Descrição</th><th>Lançado por</th><th>Situação</th></tr></thead>
        <tbody>${dec.map(o => linhaOc(o, false)).join('') || '<tr><td colspan="6" class="vazio">Nenhuma.</td></tr>'}</tbody></table></div></div>`;
    ligarPeriodo(c, render);
    const nv = $('#novaOc'); if (nv) nv.onclick = () => formOcorrencia();
    c.querySelectorAll('[data-just]').forEach(b => b.onclick = () => {
      const a = auto[+b.dataset.just];
      const tipo = a.fl.t === 'falta' ? 'justificativa' : 'abono_parcial';
      formOcorrencia({ funcionario_id: a.f.id, tipo, data_inicio: a.d.data, minutos: a.fl.min || '', descricao: a.fl.txt + ' — ' });
    });
    c.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => decidir(+b.dataset.ap, 'aprovada'));
    c.querySelectorAll('[data-rj]').forEach(b => b.onclick = () => decidir(+b.dataset.rj, 'rejeitada'));
  };

  function formOcorrencia(pre = {}) {
    const o = modal('Nova ocorrência', `
      <label>Funcionário<select name="funcionario_id">${opcoesFunc(pre.funcionario_id)}</select></label>
      <label>Tipo<select name="tipo">${Object.entries(OCORRENCIA_TIPOS).map(([k, v]) => `<option value="${k}" ${k === pre.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="grid2"><label>De<input type="date" name="data_inicio" required value="${pre.data_inicio || hojeLocal()}"></label>
      <label>Até<input type="date" name="data_fim" value="${pre.data_fim || pre.data_inicio || ''}"></label></div>
      <label data-min>Minutos (abono parcial / HE autorizada)<input type="number" name="minutos" min="0" max="600" value="${pre.minutos || ''}"></label>
      <label>Descrição / justificativa<textarea name="descricao" rows="3" required>${h(pre.descricao || '')}</textarea></label>
      <p class="peq mut">Entra como <b>pendente</b>. Abonos, férias e afastamentos só alteram o banco de horas depois de aprovados.</p>`,
      {
        onOk: async d => {
          if (!d.descricao) throw new Error('Descreva a ocorrência.');
          if (d.data_fim && d.data_fim < d.data_inicio) throw new Error('Data final anterior à inicial.');
          if (d.tipo === 'abono_parcial' && !(+d.minutos > 0)) throw new Error('Informe os minutos do abono parcial.');
          await gravar('ocorrencias', { funcionario_id: +d.funcionario_id, tipo: d.tipo, data_inicio: d.data_inicio, data_fim: d.data_fim || d.data_inicio, minutos: d.minutos ? +d.minutos : null, descricao: d.descricao, status: 'pendente' }, 'ocorrencia.criar');
          toast('Ocorrência registrada como pendente.'); await recarregar();
        }
      });
    const t = o.querySelector('[name=tipo]');
    const upd = () => { o.querySelector('[data-min]').hidden = !['abono_parcial', 'he_autorizada'].includes(t.value); };
    t.onchange = upd; upd();
  }

  async function decidir(id, status) {
    const oc = S.ocorrencias.find(o => o.id === id);
    if (!(await confirmar(`${status === 'aprovada' ? 'Aprovar' : 'Rejeitar'} "${OCORRENCIA_TIPOS[oc.tipo]}" de ${(funcPorId(oc.funcionario_id) || {}).nome}?`, status === 'aprovada' ? 'Aprovar' : 'Rejeitar'))) return;
    try {
      await DB.atualizar('ocorrencias', 'id', id, { status, decidido_por: S.sessao.email, decidido_em: new Date().toISOString() });
      await auditar('ocorrencia.' + status, { id, tipo: oc.tipo, funcionario_id: oc.funcionario_id });
      toast('Ocorrência ' + status + '.'); await recarregar();
    } catch (e) { toast(msgErro(e), 'erro'); }
  }

  /* ================= RELATÓRIOS ================= */
  PAG.relatorios = async c => {
    const mes = S.filtro.mes || hojeLocal().slice(0, 7);
    c.innerHTML = `
      <div class="cab"><div><h1>Relatórios</h1><p class="mut">PDF com CPF parcialmente mascarado</p></div></div>
      <div class="card filtros">
        <label>Mês<input type="month" id="rMes" value="${mes}"></label>
        <label>Funcionário<select id="rFunc">${opcoesFunc('', true)}</select></label>
      </div>
      <div class="relat">
        <div class="card"><h2>Relatório individual</h2><p class="mut">Registros diários, horas trabalhadas, extras, devidas, saldo líquido, faltas e justificativas. Com "Todos", gera um PDF com uma seção por funcionário.</p>
          <button class="btn" id="pdfInd">Gerar PDF individual</button></div>
        <div class="card"><h2>Relatório geral consolidado</h2><p class="mut">Todos os funcionários com resumo individual, total de extras, devidas e saldo de cada um.</p>
          <button class="btn" id="pdfGer">Gerar PDF consolidado</button></div>
      </div>
      <p class="peq mut">Os relatórios são de controle interno e trazem esse aviso no rodapé. Não substituem o espelho de ponto de um REP homologado.</p>`;
    const pegar = () => { const m = $('#rMes').value; if (!m) throw new Error('Escolha o mês.'); S.filtro.mes = m; return { ini: m + '-01', fim: fimMes(m + '-01'), fid: $('#rFunc').value }; };
    $('#pdfInd').onclick = async () => { try { const p = pegar(); await Relatorios.individual(p.ini, p.fim, p.fid); } catch (e) { toast(msgErro(e), 'erro'); } };
    $('#pdfGer').onclick = async () => { try { const p = pegar(); await Relatorios.geral(p.ini, p.fim); } catch (e) { toast(msgErro(e), 'erro'); } };
  };

  /* ================= CONFIGURAÇÕES ================= */
  PAG.config = async c => {
    const cf = S.config;
    const admins = await DB.listar('admins').catch(() => []);
    c.innerHTML = `
      <div class="cab"><div><h1>Configurações</h1><p class="mut">${h(cfg.ESCOLA)} · ${DB.modo === 'demo' ? 'modo demonstração' : 'Supabase'} · ${h(Bio.descricao)}</p></div></div>
      <div class="grid-config">
      <form class="card" id="fRegras"><h2>Regras de cálculo</h2>
        <label>Tolerância para atraso / saída antecipada / almoço (minutos)<input type="number" name="tol" min="0" max="30" value="${cf.tolerancia_min ?? 5}"></label>
        <label class="check"><input type="checkbox" name="clt" ${cf.tolerancia_clt ? 'checked' : ''}> Desconsiderar no saldo variações de até 10 min/dia (CLT art. 58 §1º)</label>
        <fieldset><legend>Dias de expediente</legend>${DIAS_SEMANA.map((n, i) => `<label class="check inline"><input type="checkbox" name="d${i}" ${cf.dias_uteis.includes(i) ? 'checked' : ''}> ${n}</label>`).join('')}</fieldset>
        ${ehAdmin() ? '<button class="btn">Salvar regras</button>' : '<p class="peq mut">Somente o perfil admin altera as regras.</p>'}
      </form>
      <div class="card"><h2>Feriados e recessos</h2>
        ${ehAdmin() ? `<form id="fFer" class="linha"><input type="date" name="data" required><input name="descricao" placeholder="Descrição" required><button class="btn peq">Adicionar</button></form>` : ''}
        <div class="lista-fer">${S.feriados.map(f => `<div><span class="num">${fmtData(f.data)} <span class="mut">${DIAS_SEMANA[diaSemana(f.data)]}</span></span> ${h(f.descricao)} ${ehAdmin() ? `<button class="lnk x" data-rf="${f.data}">×</button>` : ''}</div>`).join('') || '<p class="vazio">Nenhum feriado.</p>'}</div>
        <p class="peq mut">Inclua os feriados municipais e o calendário de recesso da escola.</p></div>
      <div class="card"><h2>Usuários administrativos</h2>
        <table><thead><tr><th>E-mail</th><th>Nome</th><th>Perfil</th></tr></thead><tbody>${admins.map(a => `<tr><td>${h(a.email)}</td><td>${h(a.nome || '')}</td><td><span class="pill">${h(a.perfil)}</span></td></tr>`).join('')}</tbody></table>
        <p class="peq mut"><b>admin</b>: tudo · <b>gestor</b>: funcionários, horários, ajustes e aprovações · <b>consulta</b>: só visualiza e gera relatórios.<br>Novos usuários: crie em Supabase › Authentication e cadastre na tabela <code>admins</code> (passo a passo no LEIA-ME).</p></div>
      <div class="card"><h2>Backup</h2><p class="mut">Baixa todas as tabelas em um arquivo JSON. Faça pelo menos uma vez por mês e guarde fora deste computador.</p>
        <button class="btn sec" id="bkp">Baixar backup completo</button>
        ${DB.modo === 'demo' ? '<hr><button class="btn vermelho peq" id="reset">Apagar dados da demonstração</button>' : ''}</div>
      <div class="card aviso-legal"><h2>Conformidade</h2><p class="peq">Este sistema é de <b>controle interno</b>. Não é um REP-P homologado nos termos da Portaria MTP nº 671/2021; para uso como registro oficial é preciso avaliar e cumprir esses requisitos (comprovante ao trabalhador, AFD/AEJ, assinatura eletrônica, registro do programa no INPI, entre outros). Dados pessoais e biométricos seguem a LGPD: acesso restrito por perfil, CPF mascarado nos relatórios e digitais guardadas somente localmente.</p></div>
      </div>`;
    const fr = $('#fRegras');
    fr.onsubmit = async e => {
      e.preventDefault(); if (!ehAdmin()) return;
      const fd = new FormData(fr);
      const patch = { tolerancia_min: +fd.get('tol') || 0, tolerancia_clt: !!fd.get('clt'), dias_uteis: DIAS_SEMANA.map((_, i) => i).filter(i => fd.get('d' + i)) };
      try { await DB.atualizar('configuracoes', 'id', 1, patch); await auditar('config.alterar', { antes: S.config, depois: patch }); toast('Regras salvas.'); await recarregar(); }
      catch (err) { toast(msgErro(err), 'erro'); }
    };
    const ff = $('#fFer');
    if (ff) ff.onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(ff);
      try { await gravar('feriados', { data: fd.get('data'), descricao: fd.get('descricao').trim() }, 'feriado.criar'); toast('Feriado adicionado.'); await recarregar(); }
      catch (err) { toast(msgErro(err), 'erro'); }
    };
    c.querySelectorAll('[data-rf]').forEach(b => b.onclick = async () => {
      if (!(await confirmar('Remover este feriado?', 'Remover'))) return;
      try { await DB.remover('feriados', 'data', b.dataset.rf); await auditar('feriado.remover', { data: b.dataset.rf }); await recarregar(); } catch (err) { toast(msgErro(err), 'erro'); }
    });
    $('#bkp').onclick = baixarBackup;
    const rs = $('#reset'); if (rs) rs.onclick = async () => { if (await confirmar('Apagar todos os dados da demonstração e recomeçar?', 'Apagar')) { DB.resetDemo(); location.reload(); } };
  };

  async function baixarBackup() {
    try {
      const tabelas = ['funcionarios', 'escalas', 'escala_versoes', 'alteracoes', 'batidas', 'batidas_invalidadas', 'ocorrencias', 'feriados', 'configuracoes', 'tentativas', 'auditoria'];
      const out = { gerado_em: new Date().toISOString(), escola: cfg.ESCOLA, modo: DB.modo };
      for (const t of tabelas) out[t] = await DB.listar(t);
      const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `backup-ponto-${hojeLocal()}.json`; a.click(); URL.revokeObjectURL(a.href);
      await auditar('backup.baixar', { tabelas });
    } catch (e) { toast('Falha no backup: ' + msgErro(e), 'erro'); }
  }

  /* ================= LOGIN / INÍCIO ================= */
  function mostrarLogin(erro) {
    $('#app').hidden = true; $('#login').hidden = false;
    const el = $('#erroLogin'); el.hidden = !erro; el.textContent = erro || '';
  }
  async function abrirApp() {
    $('#login').hidden = true; $('#app').hidden = false;
    $('#usuario').innerHTML = `<b>${h(S.sessao.nome || S.sessao.email)}</b><br>perfil ${h(S.sessao.perfil)}`;
    $('#faixaModo').innerHTML = DB.modo === 'demo' ? '<div class="faixa">MODO DEMONSTRAÇÃO · dados fictícios guardados só neste navegador · preencha o config.js para usar o banco real</div>' : '';
    montarMenu();
    await carregarBase();
    ir(location.hash.slice(1) || 'dashboard');
  }
  $('#formLogin').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      S.sessao = await DB.login(fd.get('email'), fd.get('senha'));
      if (!S.sessao || !S.sessao.perfil) { await DB.logout(); return mostrarLogin('Este usuário não tem acesso administrativo.'); }
      abrirApp().catch(err => mostrarLogin(msgErro(err)));
    } catch (err) { mostrarLogin(msgErro(err)); }
  };
  $('#btnSair').onclick = async () => { await DB.logout(); location.hash = ''; location.reload(); };
  $('#btnMenu').onclick = () => document.body.classList.toggle('menu-aberto');

  (async function iniciar() {
    $('#escolaLogin').textContent = cfg.ESCOLA; $('#escolaApp').textContent = cfg.ESCOLA;
    document.title = 'Administração · ' + cfg.ESCOLA;
    if (DB.modo === 'demo') $('#dicaDemo').hidden = false;
    try {
      S.sessao = await DB.sessao();
      if (S.sessao && S.sessao.perfil) await abrirApp();
      else mostrarLogin(S.sessao ? 'Este usuário não tem acesso administrativo.' : '');
    } catch (e) { mostrarLogin(msgErro(e)); }
  })();
})();
