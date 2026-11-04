/* ============================================================
   calc.js — regras de jornada e banco de horas
   Funções puras: não acessam banco. Usadas pela recepção e pelo admin.
   ============================================================ */
const TZ = 'America/Sao_Paulo';
const JORNADA_PADRAO = 504;   // 8h24 em minutos
const ALMOCO_PREVISTO = 60;   // 1 hora
const TIPOS = ['entrada', 'almoco_saida', 'almoco_retorno', 'saida'];
const TIPO_LABEL = { entrada: 'Entrada', almoco_saida: 'Saída para almoço', almoco_retorno: 'Retorno do almoço', saida: 'Saída final' };
const TIPO_CURTO = { entrada: 'Entrada', almoco_saida: 'Saída alm.', almoco_retorno: 'Retorno', saida: 'Saída' };
const OCORRENCIA_TIPOS = {
  justificativa: 'Justificativa',
  abono: 'Abono (dia inteiro)',
  abono_parcial: 'Abono parcial (minutos)',
  ferias: 'Férias',
  afastamento: 'Afastamento',
  folga: 'Folga autorizada',
  he_autorizada: 'Hora extra autorizada',
  atraso: 'Atraso',
  falta: 'Falta',
  saida_antecipada: 'Saída antecipada',
  almoco_excedente: 'Intervalo de almoço excedente',
  batida_esquecida: 'Batida esquecida',
  outro: 'Outro'
};
// Ocorrências aprovadas destes tipos dispensam o dia inteiro (previsto = 0)
const DISPENSA_DIA = ['abono', 'ferias', 'afastamento', 'folga'];
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/* ---------- datas e horas (sempre no fuso de São Paulo) ---------- */
const _fmtTZ = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
function partesLocais(d) {
  const p = {};
  for (const x of _fmtTZ.formatToParts(new Date(d))) p[x.type] = x.value;
  const hh = p.hour === '24' ? '00' : p.hour;
  return {
    data: `${p.year}-${p.month}-${p.day}`,
    min: (+hh) * 60 + (+p.minute),
    hora: `${hh}:${p.minute}`,
    horaSeg: `${hh}:${p.minute}:${p.second}`
  };
}
function hojeLocal() { return partesLocais(Date.now()).data; }
function addDias(data, n) { const d = new Date(data + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function diaSemana(data) { return new Date(data + 'T12:00:00Z').getUTCDay(); }
function inicioMes(data) { return data.slice(0, 8) + '01'; }
function fimMes(data) { const [y, m] = data.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
function pad2(n) { return String(n).padStart(2, '0'); }
function hm2min(s) { if (s == null || s === '') return null; const [a, b] = String(s).split(':'); return (+a) * 60 + (+b); }
function min2hm(m) { if (m == null) return '—'; m = ((m % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
function dur(m) { m = Math.round(m || 0); const neg = m < 0; m = Math.abs(m); return (neg ? '-' : '') + Math.floor(m / 60) + 'h' + pad2(m % 60); }
function durSaldo(m) { return (m > 0 ? '+' : '') + dur(m); }
function fmtData(d) { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; }
// Brasil sem horário de verão desde 2019: -03:00 fixo
function isoLocal(data, hora) { return new Date(`${data}T${hora.length === 5 ? hora + ':00' : hora}-03:00`).toISOString(); }

/* ---------- CPF e nomes ---------- */
function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }
function formatarCPF(c) {
  c = soDigitos(c).slice(0, 11);
  let r = c.slice(0, 3);
  if (c.length > 3) r += '.' + c.slice(3, 6);
  if (c.length > 6) r += '.' + c.slice(6, 9);
  if (c.length > 9) r += '-' + c.slice(9);
  return r;
}
function mascaraCPF(c) { c = soDigitos(c); return c.length === 11 ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : '***'; }
function cpfValido(c) {
  c = soDigitos(c);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += (+c[i]) * (t + 1 - i);
    if (((10 * s) % 11) % 10 !== +c[t]) return false;
  }
  return true;
}
function nomeCurto(n) { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1] : (p[0] || ''); }

/* ---------- horário vigente (sem retroatividade) ----------
   Ordem: alteração temporária que cobre a data > última alteração
   permanente com início <= data > escala do cadastro.
   A escala em si também é versionada (escala_versoes).           */
function _maisRecente(a, b) {
  if (a.data_inicio !== b.data_inicio) return a.data_inicio < b.data_inicio ? 1 : -1;
  return String(a.criado_em) < String(b.criado_em) ? 1 : -1;
}
function versaoEscala(escalaId, data, versoes) {
  return versoes
    .filter(v => v.escala_id == escalaId && v.vigencia_inicio <= data)
    .sort((a, b) => a.vigencia_inicio !== b.vigencia_inicio
      ? (a.vigencia_inicio < b.vigencia_inicio ? 1 : -1)
      : (String(a.criado_em) < String(b.criado_em) ? 1 : -1))[0];
}
function resolverHorario(func, data, ctx) {
  const alts = (ctx.alteracoes || []).filter(a => a.funcionario_id == func.id);
  const temp = alts.filter(a => a.tipo === 'temporaria' && a.data_inicio <= data && (a.data_fim || a.data_inicio) >= data).sort(_maisRecente)[0];
  const perm = alts.filter(a => a.tipo === 'permanente' && a.data_inicio <= data).sort(_maisRecente)[0];
  const ref = temp || perm;
  let escalaId = func.escala_id, entrada = null, saida = null, origem = 'Escala do cadastro';
  if (ref) {
    if (ref.entrada && ref.saida) {
      entrada = hm2min(ref.entrada); saida = hm2min(ref.saida); escalaId = null;
      origem = ref.tipo === 'temporaria' ? 'Horário temporário' : 'Horário personalizado';
    } else if (ref.escala_id) {
      escalaId = ref.escala_id;
      origem = ref.tipo === 'temporaria' ? 'Escala temporária' : 'Escala alterada';
    }
  }
  if (entrada == null && escalaId != null) {
    const v = versaoEscala(escalaId, data, ctx.versoes || []);
    if (v) { entrada = hm2min(v.entrada); saida = hm2min(v.saida); }
  }
  const esc = (ctx.escalas || []).find(e => e.id == escalaId);
  const nome = esc ? esc.nome : 'Personalizado';
  return { entrada, saida, escalaId, escalaNome: nome, origem, rotulo: `${nome} · ${min2hm(entrada)}–${min2hm(saida)}` };
}

/* ---------- cálculo de um dia ----------
   bats = batidas VÁLIDAS (não invalidadas) do funcionário nesse dia */
function calcularDia(func, data, bats, ctx) {
  const cfg = ctx.config || {};
  const hoje = hojeLocal();
  const tol = cfg.tolerancia_min != null ? +cfg.tolerancia_min : 5;
  const h = resolverHorario(func, data, ctx);
  const prevBase = (h.entrada != null && h.saida != null) ? Math.max(0, h.saida - h.entrada - ALMOCO_PREVISTO) : JORNADA_PADRAO;
  const util = (cfg.dias_uteis || [1, 2, 3, 4, 5]).map(Number).includes(diaSemana(data));
  const feriado = (ctx.feriados || []).find(f => f.data === data);
  const ocs = (ctx.ocorrencias || []).filter(o => o.funcionario_id == func.id && o.data_inicio <= data && (o.data_fim || o.data_inicio) >= data);
  const aprov = ocs.filter(o => o.status === 'aprovada');
  const dispensa = aprov.find(o => DISPENSA_DIA.includes(o.tipo));
  const antesAdmissao = func.admissao && data < func.admissao;
  const prevista = (util && !feriado && !dispensa && !antesAdmissao) ? prevBase : 0;

  const ord = [...bats].sort((a, b) => String(a.momento) < String(b.momento) ? -1 : 1);
  const m = {};
  for (const b of ord) if (m[b.tipo] == null) m[b.tipo] = partesLocais(b.momento).min;
  const e = m.entrada, as = m.almoco_saida, ar = m.almoco_retorno, s = m.saida;
  const qtd = Object.keys(m).length;
  const flags = [];
  const base = { data, funcionario_id: func.id, horario: h, prevista, util, feriado, dispensa, marc: m, ocorrencias: ocs, flags };

  if (data > hoje) return { ...base, status: 'futuro', trabalhado: 0, saldo: 0, extra: 0, devida: 0 };

  let trab = 0;
  if (e != null && as != null) trab += Math.max(0, as - e);
  if (ar != null && s != null) trab += Math.max(0, s - ar);
  if (e != null && s != null && as == null && ar == null) {
    trab = Math.max(0, s - e - 0);
    flags.push({ t: 'sem_almoco', txt: 'Intervalo não registrado' });
  }

  let status = 'normal';
  if (qtd === 0) {
    if (prevista > 0 && data < hoje) { status = 'falta'; flags.push({ t: 'falta', txt: 'Falta' }); }
    else if (prevista > 0) status = 'aguardando';
    else status = feriado ? 'feriado' : dispensa ? 'dispensa' : antesAdmissao ? 'folga' : 'folga';
  } else if (qtd < 4 && !(qtd === 2 && e != null && s != null)) {
    if (data < hoje) { status = 'incompleto'; flags.push({ t: 'batida_esquecida', txt: 'Batida esquecida: ' + TIPOS.filter(t => m[t] == null).map(t => TIPO_CURTO[t]).join(', ') }); }
    else status = 'andamento';
  }

  const conta = status !== 'andamento' && status !== 'aguardando';
  let saldo = 0;
  if (conta) {
    saldo = trab - prevista;
    if (cfg.tolerancia_clt && prevista > 0 && Math.abs(saldo) <= 10) saldo = 0; // CLT art. 58 §1º
    const abonoMin = aprov.filter(o => o.tipo === 'abono_parcial').reduce((t, o) => t + (+o.minutos || 0), 0);
    if (saldo < 0 && abonoMin) saldo = Math.min(0, saldo + abonoMin);
  }

  if (prevista > 0 && e != null && h.entrada != null && e - h.entrada > tol) flags.push({ t: 'atraso', min: e - h.entrada, txt: `Atraso de ${e - h.entrada} min` });
  if (prevista > 0 && s != null && h.saida != null && h.saida - s > tol) flags.push({ t: 'saida_antecipada', min: h.saida - s, txt: `Saída antecipada (${h.saida - s} min)` });
  if (as != null && ar != null) {
    const d = ar - as;
    if (d - ALMOCO_PREVISTO > tol) flags.push({ t: 'almoco_excedente', min: d - ALMOCO_PREVISTO, txt: `Almoço ${d} min (retorno previsto ${min2hm(as + 60)})` });
    else if (ALMOCO_PREVISTO - d > tol) flags.push({ t: 'almoco_reduzido', min: ALMOCO_PREVISTO - d, txt: `Almoço reduzido: ${d} min` });
  }
  if (dispensa) flags.push({ t: 'dispensa', txt: OCORRENCIA_TIPOS[dispensa.tipo] });
  if (feriado) flags.push({ t: 'feriado', txt: 'Feriado: ' + feriado.descricao });
  const heAutorizada = aprov.some(o => o.tipo === 'he_autorizada');
  if (saldo > 0 && heAutorizada) flags.push({ t: 'he_ok', txt: 'HE autorizada' });

  return { ...base, status, trabalhado: trab, saldo, extra: Math.max(saldo, 0), devida: Math.max(-saldo, 0), heAutorizada };
}

const STATUS_LABEL = {
  normal: 'Normal', andamento: 'Em andamento', aguardando: 'Sem registro', falta: 'Falta',
  incompleto: 'Batida pendente', feriado: 'Feriado', dispensa: 'Dispensado', folga: 'Sem expediente', futuro: '—'
};

/* exporta para testes em Node (no navegador é ignorado) */
if (typeof module !== 'undefined') module.exports = { calcularDia, resolverHorario, cpfValido, dur, durSaldo, hm2min, min2hm, isoLocal, addDias, partesLocais };
