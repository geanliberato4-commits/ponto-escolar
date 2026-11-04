/* Cálculo de horas: trabalhadas, extras, devidas, faltas e abonos.
   Compartilhado pelo relatório mensal e pelo banco de horas. Funciona no navegador e no Node (testes). */
(function (root) {
  var TZ = "America/Sao_Paulo";

  // Tipos de ocorrência (como aparecem no painel)
  var TIPOS_OCORRENCIA = {
    atestado: { rotulo: "Atestado médico", efeito: "dia_abonado" },
    falta_justificada: { rotulo: "Falta justificada", efeito: "dia_abonado" },
    compensacao: { rotulo: "Folga por banco de horas", efeito: "compensacao" },
    abono_atraso: { rotulo: "Abono de atraso", efeito: "minutos" },
    saida_antecipada: { rotulo: "Saída antecipada autorizada", efeito: "minutos" },
    outro: { rotulo: "Outro (apenas registro)", efeito: "info" }
  };

  function diasEntre(ini, fim) {
    var out = [], d = new Date(ini + "T12:00:00Z"), f = new Date(fim + "T12:00:00Z");
    while (d <= f) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 864e5); }
    return out;
  }
  function diaSemana(data) { return new Date(data + "T12:00:00Z").getUTCDay(); }

  // Soma dos períodos trabalhados. Entrada→saída almoço e retorno→saída.
  function minutosDia(bd) {
    var t = {};
    bd.forEach(function (x) { t[x.tipo] = new Date(x.momento).getTime(); });
    var tot = 0;
    if (t.entrada && t.almoco_saida) tot += (t.almoco_saida - t.entrada) / 60000;
    if (t.almoco_retorno && t.saida) tot += (t.saida - t.almoco_retorno) / 60000;
    if (t.entrada && t.saida && !t.almoco_saida && !t.almoco_retorno) tot += (t.saida - t.entrada) / 60000;
    return tot;
  }

  // ctx: { hoje, tol, uteis:[0-6], feriados:{data:descricao}, jornada, batidas:[válidas do funcionário], ocorrencias:[aprovadas do funcionário] }
  function calcularFuncionario(p, ini, fim, ctx) {
    var jornada = ctx.jornada, tol = ctx.tol || 0;
    var res = { p: p, dias: [], trab: 0, extra: 0, dev: 0, faltas: 0, diasTrab: 0, abonados: 0, incompletos: 0 };
    diasEntre(ini, fim).forEach(function (d) {
      if (d > ctx.hoje) return;
      if (p.admissao && d < p.admissao) return;
      if (p.desligamento && d > p.desligamento) return;
      var util = ctx.uteis.indexOf(diaSemana(d)) >= 0 && !ctx.feriados[d];
      var bd = ctx.batidas.filter(function (b) { return b.data === d; });
      var oc = (ctx.ocorrencias || []).filter(function (o) { return d >= o.data_inicio && d <= (o.data_fim || o.data_inicio); });
      var abonoDia = null, compens = null, minAbono = 0, notas = [];
      oc.forEach(function (o) {
        var t = TIPOS_OCORRENCIA[o.tipo] || TIPOS_OCORRENCIA.outro;
        notas.push(t.rotulo);
        if (t.efeito === "dia_abonado") abonoDia = t.rotulo;
        else if (t.efeito === "compensacao") compens = t.rotulo;
        else if (t.efeito === "minutos") minAbono += Number(o.minutos) || 0;
      });
      var trab = minutosDia(bd), extra = 0, dev = 0, obs = ctx.feriados[d] || (util ? "" : "Não útil");
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
        } else {
          var diff;
          if (!util) diff = trab;
          else if (abonoDia) diff = Math.max(0, trab - jornada - tol);
          else { diff = trab - jornada; if (Math.abs(diff) <= tol) diff = 0; }
          if (diff > 0) extra = diff; else dev = -diff;
          if (dev > 0 && minAbono > 0) dev = Math.max(0, dev - minAbono);
          if (notas.length) obs = (obs ? obs + " · " : "") + notas.join(", ");
        }
      }
      res.trab += trab; res.extra += extra; res.dev += dev;
      res.dias.push({ d: d, bd: bd, trab: trab, extra: extra, dev: dev, obs: obs });
    });
    return res;
  }

  function hm(min) {
    var s = min < 0 ? "-" : ""; min = Math.abs(Math.round(min));
    return s + Math.floor(min / 60) + "h" + String(min % 60).padStart(2, "0");
  }

  var api = { TZ: TZ, TIPOS_OCORRENCIA: TIPOS_OCORRENCIA, diasEntre: diasEntre, diaSemana: diaSemana, minutosDia: minutosDia, calcularFuncionario: calcularFuncionario, hm: hm };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Calc = api;
})(typeof window !== "undefined" ? window : globalThis);
