/* ============================================================
   db.js — camada de dados
   Modo "supabase": banco real (config.js preenchido)
   Modo "demo": tudo no localStorage deste navegador, para testar
   Os dois modos expõem exatamente a mesma interface (DB.xxx).
   ============================================================ */
const DB = (function () {
  const cfg = window.PONTO_CONFIG || {};
  const usaSupa = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const modo = usaSupa ? 'supabase' : 'demo';

  /* =================== SUPABASE =================== */
  let sb = null;
  if (usaSupa) sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  async function rpc(nome, args) {
    const { data, error } = await sb.rpc(nome, args);
    if (error) throw new Error(error.message);
    return data;
  }

  const SUPA = {
    horaServidor: () => rpc('ponto_hora'),
    identificar: (cpf, terminal) => rpc('ponto_identificar', { p_cpf: cpf, p_terminal: terminal }),
    registrar: (cpf, tipo, metodo, terminal) => rpc('ponto_registrar', { p_cpf: cpf, p_tipo: tipo, p_metodo: metodo, p_terminal: terminal }),
    logFalha: (detalhe, terminal) => rpc('ponto_log', { p_detalhe: detalhe, p_terminal: terminal }),

    async login(email, senha) {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw new Error('E-mail ou senha inválidos.');
      return SUPA.sessao();
    },
    async logout() { await sb.auth.signOut(); },
    async sessao() {
      const { data } = await sb.auth.getUser();
      const u = data && data.user;
      if (!u) return null;
      const { data: a } = await sb.from('admins').select('*').eq('user_id', u.id).eq('ativo', true).maybeSingle();
      return a ? { email: u.email, nome: a.nome, perfil: a.perfil } : { email: u.email, perfil: null };
    },
    async listar(t, o = {}) {
      const P = 1000, out = [];
      let de = 0;
      while (true) {
        let q = sb.from(t).select('*');
        if (o.eq) for (const k in o.eq) q = q.eq(k, o.eq[k]);
        if (o.gte) for (const k in o.gte) q = q.gte(k, o.gte[k]);
        if (o.lte) for (const k in o.lte) q = q.lte(k, o.lte[k]);
        if (o.order) q = q.order(o.order, { ascending: !o.desc });
        q = o.limit ? q.range(0, o.limit - 1) : q.range(de, de + P - 1);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        out.push(...data);
        if (o.limit || data.length < P) break;
        de += P;
      }
      return out;
    },
    async inserir(t, row) {
      const { data, error } = await sb.from(t).insert(row).select().single();
      if (error) throw new Error(traduzErro(error));
      return data;
    },
    async atualizar(t, chave, valor, patch) {
      const { error } = await sb.from(t).update(patch).eq(chave, valor);
      if (error) throw new Error(traduzErro(error));
    },
    async remover(t, chave, valor) {
      const { error } = await sb.from(t).delete().eq(chave, valor);
      if (error) throw new Error(traduzErro(error));
    }
  };

  function traduzErro(e) {
    const m = e.message || String(e);
    if (/duplicate key|unique/i.test(m)) return 'Registro duplicado (já existe).';
    if (/row-level security|permission denied/i.test(m)) return 'Seu perfil não tem permissão para esta ação.';
    return m;
  }

  /* =================== DEMONSTRAÇÃO (localStorage) =================== */
  const KEY = 'ponto_escolar_demo_v1';
  const KEY_SESS = 'ponto_escolar_demo_sessao';
  let mem = null;

  function salvar() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* navegador sem storage */ } }
  function carregar() {
    if (mem) return mem;
    try { const j = localStorage.getItem(KEY); if (j) mem = JSON.parse(j); } catch (e) { mem = null; }
    if (!mem) { semear(); salvar(); }
    return mem;
  }
  function sessaoDemo() { try { return JSON.parse(sessionStorage.getItem(KEY_SESS) || 'null'); } catch (e) { return null; } }

  function ins(t, row) {
    mem._seq[t] = (mem._seq[t] || 0) + 1;
    const r = { id: mem._seq[t], criado_em: new Date().toISOString(), ...row };
    (mem[t] = mem[t] || []).push(r);
    return r;
  }

  function gerarCPF(ri) {
    const n = Array.from({ length: 9 }, () => ri(0, 9));
    for (let t = 9; t < 11; t++) {
      let s = 0;
      for (let i = 0; i < t; i++) s += n[i] * (t + 1 - i);
      n.push(((10 * s) % 11) % 10);
    }
    return n.join('');
  }

  function semear() {
    mem = { _seq: {}, escalas: [], escala_versoes: [], funcionarios: [], alteracoes: [], batidas: [], batidas_invalidadas: [], tentativas: [], ocorrencias: [], feriados: [], configuracoes: [], auditoria: [] };
    const E = [['07:00', '16:24'], ['07:30', '16:54'], ['08:00', '17:24'], ['08:36', '18:00']];
    E.forEach((x, i) => {
      mem.escalas.push({ id: i + 1, nome: 'Escala ' + (i + 1) });
      ins('escala_versoes', { escala_id: i + 1, entrada: x[0], saida: x[1], vigencia_inicio: '2000-01-01', motivo: 'Horário inicial', admin_email: 'sistema' });
    });
    mem.configuracoes.push({ id: 1, tolerancia_min: 5, tolerancia_clt: false, dias_uteis: [1, 2, 3, 4, 5] });
    [['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República'], ['2026-11-20', 'Dia da Consciência Negra'], ['2026-12-25', 'Natal'],
     ['2027-01-01', 'Confraternização Universal'], ['2027-03-26', 'Sexta-feira Santa'], ['2027-04-21', 'Tiradentes'], ['2027-05-01', 'Dia do Trabalho'],
     ['2027-09-07', 'Independência'], ['2027-10-12', 'Nossa Senhora Aparecida'], ['2027-11-02', 'Finados'], ['2027-11-15', 'Proclamação da República'],
     ['2027-11-20', 'Dia da Consciência Negra'], ['2027-12-25', 'Natal']].forEach(([data, descricao]) => mem.feriados.push({ data, descricao }));

    let seed = 20261104;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const pessoas = [
      ['Ana Paula Ferreira', 'Secretária escolar', 1], ['Carlos Eduardo Lima', 'Inspetor de alunos', 2],
      ['Juliana Martins Souza', 'Auxiliar administrativa', 3], ['Roberto Alves Pereira', 'Zelador', 1],
      ['Fernanda Costa Ribeiro', 'Coordenadora pedagógica', 4], ['Marcos Vinícius Rocha', 'Auxiliar de serviços gerais', 2]
    ];
    pessoas.forEach((p, i) => ins('funcionarios', { nome: p[0], cpf: gerarCPF(ri), cargo: p[1], admissao: '2025-02-03', escala_id: p[2], ativo: true, digitais: i < 4 ? 2 : 0 }));

    const hoje = hojeLocal();
    const agora = partesLocais(Date.now()).min;
    for (let k = 15; k >= 0; k--) {
      const dia = addDias(hoje, -k);
      if (![1, 2, 3, 4, 5].includes(diaSemana(dia))) continue;
      if (mem.feriados.some(f => f.data === dia)) continue;
      mem.funcionarios.forEach((f, i) => {
        if (k === 6 && i === 3) return; // uma falta para demonstrar
        const v = mem.escala_versoes.find(x => x.escala_id === f.escala_id);
        const e = hm2min(v.entrada) + ri(-8, 14);
        const as = ri(660, 750);
        const ar = as + ri(54, 72);
        const s = e + 564 + ri(-35, 50);
        let marc = [['entrada', e], ['almoco_saida', as], ['almoco_retorno', ar], ['saida', s]];
        if (k === 0) marc = marc.filter(x => x[1] <= agora - 2);
        if (k === 3 && i === 1) marc = marc.filter(x => x[0] !== 'saida'); // batida esquecida
        marc.forEach(([tipo, mm]) => ins('batidas', {
          funcionario_id: f.id, tipo, data: dia, momento: isoLocal(dia, min2hm(mm) + ':' + pad2(ri(0, 59))),
          origem: 'recepcao', metodo: i < 4 ? 'simulador' : 'cpf', terminal: 'RECEPCAO-01'
        }));
      });
    }
    ins('ocorrencias', { funcionario_id: 4, tipo: 'justificativa', data_inicio: addDias(hoje, -6), data_fim: addDias(hoje, -6), descricao: 'Consulta médica (aguardando atestado)', status: 'pendente', admin_email: 'demo@escola' });
    ins('ocorrencias', { funcionario_id: 5, tipo: 'he_autorizada', data_inicio: inicioMes(hoje), data_fim: fimMes(hoje), descricao: 'Reunião de pais e mestres', status: 'aprovada', admin_email: 'demo@escola', decidido_por: 'demo@escola' });
  }

  function batidasHoje(fid) {
    const d = carregar(), hoje = hojeLocal();
    const inv = new Set(d.batidas_invalidadas.map(i => i.batida_id));
    return d.batidas.filter(b => b.funcionario_id === fid && b.data === hoje && !inv.has(b.id)).sort((a, b) => a.momento < b.momento ? -1 : 1);
  }
  function tentativa(cpf, fid, resultado, detalhe, terminal) {
    carregar(); ins('tentativas', { momento: new Date().toISOString(), cpf_mascarado: mascaraCPF(cpf), funcionario_id: fid || null, resultado, detalhe, terminal }); salvar();
  }

  const DEMO = {
    async horaServidor() { return new Date().toISOString(); },
    async identificar(cpf, terminal) {
      const d = carregar(); cpf = soDigitos(cpf);
      const f = d.funcionarios.find(x => x.cpf === cpf && x.ativo);
      if (!f) { tentativa(cpf, null, 'nao_encontrado', 'CPF não cadastrado ou inativo', terminal); return { ok: false, erro: 'CPF não encontrado. Procure a secretaria.' }; }
      const q = batidasHoje(f.id).length;
      return { ok: true, nome: nomeCurto(f.nome), proxima: q < 4 ? TIPOS[q] : null, qtd: q, digitais: f.digitais || 0 };
    },
    async registrar(cpf, tipo, metodo, terminal) {
      const d = carregar(); cpf = soDigitos(cpf);
      const f = d.funcionarios.find(x => x.cpf === cpf && x.ativo);
      if (!f) { tentativa(cpf, null, 'nao_encontrado', 'Registro com CPF não cadastrado', terminal); return { ok: false, erro: 'CPF não encontrado. Procure a secretaria.' }; }
      const hj = batidasHoje(f.id);
      if (hj.length >= 4) { tentativa(cpf, f.id, 'jornada_encerrada', 'Quinta batida recusada', terminal); return { ok: false, erro: 'As 4 batidas de hoje já foram registradas.' }; }
      const prox = TIPOS[hj.length];
      if (tipo !== prox) { tentativa(cpf, f.id, 'fora_sequencia', `Esperado ${prox}, recebido ${tipo}`, terminal); return { ok: false, erro: 'A sequência de batidas mudou. Identifique-se novamente.' }; }
      const ult = hj[hj.length - 1];
      if (ult && Date.now() - new Date(ult.momento).getTime() < 60000) { tentativa(cpf, f.id, 'duplicada', 'Batida em menos de 1 minuto', terminal); return { ok: false, erro: 'Já houve uma batida há menos de 1 minuto. Aguarde.' }; }
      const b = ins('batidas', { funcionario_id: f.id, tipo: prox, data: hojeLocal(), momento: new Date().toISOString(), origem: 'recepcao', metodo, terminal });
      salvar();
      tentativa(cpf, f.id, 'registrado', prox, terminal);
      return { ok: true, tipo: prox, momento: b.momento, nome: nomeCurto(f.nome) };
    },
    async logFalha(detalhe, terminal) { tentativa('', null, 'falha_comunicacao', String(detalhe).slice(0, 300), terminal); return true; },

    async login(email, senha) {
      if (senha !== 'demo') throw new Error('No modo demonstração a senha é "demo".');
      const s = { email: email || 'demo@escola', nome: 'Direção (demonstração)', perfil: 'admin' };
      try { sessionStorage.setItem(KEY_SESS, JSON.stringify(s)); } catch (e) { /* */ }
      return s;
    },
    async logout() { try { sessionStorage.removeItem(KEY_SESS); } catch (e) { /* */ } },
    async sessao() { return sessaoDemo(); },
    async listar(t, o = {}) {
      if (t === 'admins') { const s = sessaoDemo(); return s ? [{ email: s.email, nome: s.nome, perfil: s.perfil, ativo: true }] : []; }
      let rows = (carregar()[t] || []).slice();
      if (o.eq) for (const k in o.eq) rows = rows.filter(r => r[k] == o.eq[k]);
      if (o.gte) for (const k in o.gte) rows = rows.filter(r => r[k] >= o.gte[k]);
      if (o.lte) for (const k in o.lte) rows = rows.filter(r => r[k] <= o.lte[k]);
      if (o.order) rows.sort((a, b) => (a[o.order] < b[o.order] ? -1 : a[o.order] > b[o.order] ? 1 : 0) * (o.desc ? -1 : 1));
      if (o.limit) rows = rows.slice(0, o.limit);
      return JSON.parse(JSON.stringify(rows));
    },
    async inserir(t, row) {
      carregar();
      const s = sessaoDemo();
      if (t === 'feriados') {
        if (mem.feriados.some(f => f.data === row.data)) throw new Error('Já existe feriado nesta data.');
        mem.feriados.push({ ...row }); salvar(); return { ...row };
      }
      const r = ins(t, { ...row, admin_email: s ? s.email : null });
      if (t === 'auditoria') r.momento = r.criado_em;
      salvar();
      return JSON.parse(JSON.stringify(r));
    },
    async atualizar(t, chave, valor, patch) {
      carregar();
      const r = (mem[t] || []).find(x => x[chave] == valor);
      if (!r) throw new Error('Registro não encontrado.');
      Object.assign(r, patch); salvar();
    },
    async remover(t, chave, valor) {
      carregar();
      mem[t] = (mem[t] || []).filter(x => x[chave] != valor); salvar();
    },
    resetDemo() { try { localStorage.removeItem(KEY); } catch (e) { /* */ } mem = null; }
  };

  return Object.assign({ modo }, usaSupa ? SUPA : DEMO);
})();
