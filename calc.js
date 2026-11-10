/* Cálculo de horas: trabalhadas, extras, devidas, faltas e abonos.
   Compartilhado pelo relatório mensal e mensal. Funciona no navegador e no Node (testes). */
(function (root) {
  var TZ = "America/Sao_Paulo";

  // Tipos de ocorrência (como aparecem no painel)
  var TIPOS_OCORRENCIA = {
    atestado: { rotulo: "Atestado médico", efeito: "dia_abonado" },
    falta_justificada: { rotulo: "Falta justificada", efeito: "dia_abonado" },
    ferias: { rotulo: "Férias", efeito: "dia_abonado" },
    afastamento: { rotulo: "Afastamento / licença", efeito: "dia_abonado" },
    folga_abonada: { rotulo: "Dia abonado pela direção", efeito: "dia_abonado" },
    abono_atraso: { rotulo: "Abono de atraso", efeito: "minutos" },
    saida_antecipada: { rotulo: "Saída antecipada autorizada", efeito: "minutos" },
    outro: { rotulo: "Outro (apenas registro)", efeito: "info" },
    // Classificam as horas extras do dia como atividade extra (reunião etc.)
    reuniao_pedagogica: { rotulo: "Extra: reunião pedagógica", efeito: "motivo_extra", motivo: "Reunião pedagógica" },
    formacao_continuada: { rotulo: "Extra: formação continuada", efeito: "motivo_extra", motivo: "Formação continuada" },
    evento_escolar: { rotulo: "Extra: evento escolar", efeito: "motivo_extra", motivo: "Evento escolar" },
    outro_extra: { rotulo: "Extra: outro motivo", efeito: "motivo_extra", motivo: "Outros" }
  };
  var REGULARES = ["entrada", "almoco_saida", "almoco_retorno", "saida"];
  var SEM_MOTIVO = "Reunião (sem motivo informado)";

  function diasEntre(ini, fim) {
    var out = [], d = new Date(ini + "T12:00:00Z"), f = new Date(fim + "T12:00:00Z");
    while (d <= f) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 864e5); }
    return out;
  }
  function diaSemana(data) { return new Date(data + "T12:00:00Z").getUTCDay(); }

  function ms(x) { return new Date(x.momento).getTime(); }

  // Períodos regulares trabalhados (em ms): entrada→saída almoço e retorno→saída (ou entrada→saída direto).
  function intervalosRegulares(bd) {
    var t = {};
    bd.forEach(function (x) { if (REGULARES.indexOf(x.tipo) >= 0) t[x.tipo] = ms(x); });
    var iv = [];
    if (t.entrada && t.almoco_saida) iv.push([t.entrada, t.almoco_saida]);
    if (t.almoco_retorno && t.saida) iv.push([t.almoco_retorno, t.saida]);
    if (t.entrada && t.saida && !t.almoco_saida && !t.almoco_retorno) iv.push([t.entrada, t.saida]);
    return iv.filter(function (p) { return p[1] > p[0]; });
  }
  // Períodos de reunião: cada entrada pareia com a saída seguinte. Entrada sem saída fica aberta.
  function intervalosReuniao(bd) {
    var r = bd.filter(function (x) { return x.tipo === "reuniao_entrada" || x.tipo === "reuniao_saida"; }).sort(function (a, b) { return ms(a) - ms(b); });
    var iv = [], aberta = false, ini = null;
    r.forEach(function (x) {
      if (x.tipo === "reuniao_entrada") { if (ini === null) ini = ms(x); }
      else if (ini !== null) { if (ms(x) > ini) iv.push([ini, ms(x)]); ini = null; }
    });
    if (ini !== null) aberta = true;
    return { iv: iv, aberta: aberta };
  }
  // União de períodos (não conta duas vezes o que se sobrepõe), em minutos.
  function uniao(lista) {
    var a = lista.slice().sort(function (x, y) { return x[0] - y[0]; }), tot = 0, cur = null;
    a.forEach(function (p) {
      if (!cur) cur = [p[0], p[1]];
      else if (p[0] <= cur[1]) cur[1] = Math.max(cur[1], p[1]);
      else { tot += cur[1] - cur[0]; cur = [p[0], p[1]]; }
    });
    if (cur) tot += cur[1] - cur[0];
    return tot / 60000;
  }
  function minutosSoma(iv) { return iv.reduce(function (s, p) { return s + (p[1] - p[0]); }, 0) / 60000; }
  // Mantido: minutos da jornada regular
  function minutosDia(bd) { return minutosSoma(intervalosRegulares(bd)); }

  // ctx: { hoje, tol, uteis:[0-6], feriados:{data:descricao}, jornada, limiteDia, intervaloMin, batidas:[válidas do funcionário], ocorrencias:[aprovadas do funcionário] }
  function calcularFuncionario(p, ini, fim, ctx) {
    var jornada = ctx.jornada, tol = ctx.tol || 0, limiteDia = ctx.limiteDia || 600, intMin = ctx.intervaloMin || 60;
    var res = { p: p, dias: [], trab: 0, normal: 0, extra: 0, extraComum: 0, extraReuniao: 0, porMotivo: {}, dev: 0, faltas: 0, diasTrab: 0, abonados: 0, incompletos: 0, alertas: [] };
    var fimAnterior = null;
    // Para o descanso entre jornadas, olha o último registro do dia anterior ao período
    var anteriores = ctx.batidas.filter(function (b) { return b.data < ini; });
    if (anteriores.length) fimAnterior = ms(anteriores[anteriores.length - 1]);
    diasEntre(ini, fim).forEach(function (d) {
      if (d > ctx.hoje) return;
      if (p.admissao && d < p.admissao) return;
      if (p.desligamento && d > p.desligamento) return;
      var util = ctx.uteis.indexOf(diaSemana(d)) >= 0 && !ctx.feriados[d];
      var bd = ctx.batidas.filter(function (b) { return b.data === d; });
      var oc = (ctx.ocorrencias || []).filter(function (o) { return d >= o.data_inicio && d <= (o.data_fim || o.data_inicio); });
      var abonoDia = null, compens = null, minAbono = 0, notas = [], motivoExtra = null;
      oc.forEach(function (o) {
        var t = TIPOS_OCORRENCIA[o.tipo] || TIPOS_OCORRENCIA.outro;
        notas.push(t.rotulo);
        if (t.efeito === "dia_abonado") abonoDia = t.rotulo;
        else if (t.efeito === "compensacao") compens = t.rotulo;
        else if (t.efeito === "minutos") minAbono += Number(o.minutos) || 0;
        else if (t.efeito === "motivo_extra") motivoExtra = t.motivo;
      });
      var ivReg = intervalosRegulares(bd), reu = intervalosReuniao(bd);
      var trabReg = minutosSoma(ivReg);
      var trab = uniao(ivReg.concat(reu.iv));
      var reuMin = Math.max(0, trab - uniao(ivReg));       // reunião fora do horário já contado
      var extra = 0, extraC = 0, extraR = 0, dev = 0, normal = 0, alertas = [];
      var obs = ctx.feriados[d] || (util ? "" : "Não útil");
      var completo = bd.some(function (x) { return x.tipo === "saida"; });

      if (bd.length === 0) {
        if (util) {
          if (abonoDia) { obs = abonoDia + " (abonado)"; res.abonados++; }
          else if (compens) { dev = jornada; obs = compens; }
          else { dev = jornada; res.faltas++; obs = "Falta"; }
        } else if (notas.length) obs = obs + " · " + notas.join(", ");
      } else {
        res.diasTrab++;
        if (!completo) {
          obs = d === ctx.hoje ? "Em andamento" : "Batidas incompletas";
          if (d !== ctx.hoje) res.incompletos++;
          trab = 0; reuMin = 0;
        } else {
          var diff;
          if (!util) diff = trabReg;
          else if (abonoDia) diff = Math.max(0, trabReg - jornada - tol);
          else { diff = trabReg - jornada; if (Math.abs(diff) <= tol) diff = 0; }
          if (diff > 0) extraC = diff; else dev = -diff;
          if (dev > 0 && minAbono > 0) dev = Math.max(0, dev - minAbono);
          if (util && !abonoDia) normal = Math.min(trabReg, jornada);
          // Extra do dia sem batida de reunião, classificada pela direção (permanência na escola)
          var motivo = motivoExtra || SEM_MOTIVO;
          if (motivoExtra && reuMin === 0 && extraC > 0) { extraR = extraC; extraC = 0; }
          else extraR = reuMin;
          if (extraR > 0) res.porMotivo[motivo] = (res.porMotivo[motivo] || 0) + extraR;
          if (extraR > 0 && reuMin > 0) obs = (obs ? obs + " · " : "") + "Reunião " + hm(reuMin);
          if (notas.length) obs = (obs ? obs + " · " : "") + notas.join(", ");
          extra = extraC + extraR;
          // alertas legais (apenas aviso para conferência)
          if (trab > limiteDia) alertas.push("Jornada de " + hm(trab) + " (acima de " + hm(limiteDia) + ")");
          var t = {}; bd.forEach(function (x) { if (REGULARES.indexOf(x.tipo) >= 0) t[x.tipo] = ms(x); });
          if (t.almoco_saida && t.almoco_retorno) {
            var alm = (t.almoco_retorno - t.almoco_saida) / 60000;
            if (trabReg > 360 && alm < intMin) alertas.push("Intervalo de " + hm(alm) + " (mínimo " + hm(intMin) + ")");
            else if (alm > 120) alertas.push("Intervalo de " + hm(alm) + " (acima de 2h)");
          } else if (trabReg > 360) alertas.push("Jornada sem intervalo de almoço registrado");
        }
        if (reu.aberta && d !== ctx.hoje) alertas.push("Reunião sem batida de saída");
        // descanso entre jornadas
        var primeiro = bd.reduce(function (m, x) { return Math.min(m, ms(x)); }, Infinity);
        if (fimAnterior !== null) {
          var desc = (primeiro - fimAnterior) / 3600000;
          if (desc < 11 && desc >= 0) alertas.push("Descanso de " + hm(desc * 60) + " desde o dia anterior (mínimo 11h)");
        }
        fimAnterior = bd.reduce(function (m, x) { return Math.max(m, ms(x)); }, 0);
      }
      res.trab += trab; res.normal += normal; res.extra += extra; res.extraComum += extraC; res.extraReuniao += extraR; res.dev += dev;
      alertas.forEach(function (a) { res.alertas.push({ d: d, t: a }); });
      res.dias.push({ d: d, bd: bd, trab: trab, normal: normal, extra: extra, extraComum: extraC, extraReuniao: extraR, dev: dev, obs: obs, alertas: alertas });
    });
    return res;
  }

  function hm(min) {
    var s = min < 0 ? "-" : ""; min = Math.abs(Math.round(min));
    return s + Math.floor(min / 60) + "h" + String(min % 60).padStart(2, "0");
  }

  var api = { TZ: TZ, TIPOS_OCORRENCIA: TIPOS_OCORRENCIA, diasEntre: diasEntre, diaSemana: diaSemana, minutosDia: minutosDia, SEM_MOTIVO: SEM_MOTIVO, calcularFuncionario: calcularFuncionario, hm: hm };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Calc = api;
})(typeof window !== "undefined" ? window : globalThis);
