(function () {
  var C = window.CONFIG;
  var db = supabase.createClient(C.supabaseUrl, C.supabaseKey);
  var $ = function (id) { return document.getElementById(id); };
  var TZ = "America/Sao_Paulo";
  var TIPOS = ["entrada", "almoco_saida", "almoco_retorno", "saida"];
  var NOMES = { entrada: "Entrada", almoco_saida: "Saída almoço", almoco_retorno: "Retorno almoço", saida: "Saída" };
  var perfil = null, meuEmail = "", escalas = [], cfg = { tolerancia_min: 5, dias_uteis: [1, 2, 3, 4, 5] };
  var aba = "dash";

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hoje() { return new Date().toLocaleDateString("sv-SE", { timeZone: TZ }); }
  function hora(iso) { return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }); }
  function dataBR(s) { if (!s) return ""; var p = String(s).slice(0, 10).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
  function hm(min) {
    var s = min < 0 ? "-" : ""; min = Math.abs(Math.round(min));
    return s + Math.floor(min / 60) + "h" + String(min % 60).padStart(2, "0");
  }
  function maskCpf(c) { c = String(c || "").replace(/\D/g, ""); return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4"); }
  function cpfValido(c) {
    c = String(c).replace(/\D/g, "");
    if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    for (var t = 9; t < 11; t++) {
      var s = 0;
      for (var i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
      var d = ((s * 10) % 11) % 10;
      if (d !== Number(c[t])) return false;
    }
    return true;
  }
  function podeEditar() { return perfil === "admin" || perfil === "gestor"; }
  function msgHtml(t, tipo) { return t ? '<div class="msg ' + (tipo || "err") + '">' + esc(t) + "</div>" : ""; }
  function icones() { try { if (window.lucide) lucide.createIcons(); } catch (e) {} }
  function iniciais(n) { var p = String(n || "?").trim().split(/\s+/); return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase(); }
  function pageHead(icone, titulo, desc, acoes) {
    return '<div class="page-head"><div class="ph-ic"><i data-lucide="' + icone + '"></i></div><div class="ph-t"><h2>' + esc(titulo) + "</h2><p>" + esc(desc) + "</p></div>" + (acoes || "") + "</div>";
  }
  function vazio(icone, texto) { return '<div class="card empty"><i data-lucide="' + icone + '"></i>' + esc(texto) + "</div>"; }
  function toast(t, erro) {
    var el = document.createElement("div");
    el.className = "toast" + (erro ? " err" : "");
    el.textContent = t;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  }
  function esqueleto() {
    return '<div class="kpis"><div class="skel" style="height:80px"></div><div class="skel" style="height:80px"></div><div class="skel" style="height:80px"></div></div><div class="skel" style="height:220px"></div>';
  }
  function minLocal(iso) {
    var p = new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false }).split(":");
    return Number(p[0]) * 60 + Number(p[1]);
  }
  function dataLocal(ms) { return new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ }); }

  async function buscarTudo(q) {
    var out = [], from = 0, passo = 1000;
    for (;;) {
      var r = await q().range(from, from + passo - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < passo) break;
      from += passo;
    }
    return out;
  }

  function modal(html, montar) {
    var root = $("modalRoot");
    root.innerHTML = '<div class="modal"><div class="card">' + html + "</div></div>";
    function fechar() { root.innerHTML = ""; }
    root.querySelectorAll("[data-fechar]").forEach(function (b) { b.addEventListener("click", fechar); });
    if (montar) montar(root, fechar);
    icones();
    return fechar;
  }

  /* ---------- login ---------- */
  $("escola2").textContent = C.escola + " · Controle de ponto";
  $("hojeTxt").textContent = new Date().toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  icones();

  async function iniciarSessao() {
    var s = await db.auth.getSession();
    if (!s.data.session) return mostrarLogin();
    var r = await db.rpc("meu_perfil");
    if (r.error || !r.data) {
      await db.auth.signOut();
      mostrarLogin("Este usuário não tem acesso administrativo.");
      return;
    }
    perfil = r.data;
    meuEmail = s.data.session.user.email;
    var rotulo = { admin: "Administrador", gestor: "Gestor", consulta: "Consulta" }[perfil] || perfil;
    $("quemNome").textContent = meuEmail;
    $("quemPerfil").textContent = rotulo;
    $("avatar").textContent = iniciais(meuEmail.split("@")[0].replace(/[._-]+/g, " "));
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    icones();
    var e = await db.from("escalas").select("id,nome,ativa").order("id");
    var v = await db.from("escala_versoes").select("escala_id,entrada,saida,vigencia_inicio").order("vigencia_inicio");
    escalas = (e.data || []).map(function (x) {
      var vs = (v.data || []).filter(function (y) { return y.escala_id === x.id; });
      var ult = vs[vs.length - 1];
      return { id: x.id, nome: x.nome, ativa: x.ativa !== false, entrada: ult ? ult.entrada.slice(0, 5) : "", saida: ult ? ult.saida.slice(0, 5) : "" };
    });
    var c = await db.from("configuracoes").select("*").eq("id", 1).maybeSingle();
    if (c.data) cfg = c.data;
    ir(aba);
  }
  function mostrarLogin(m) {
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("loginMsg").innerHTML = msgHtml(m);
    icones();
  }
  async function entrar() {
    $("loginMsg").innerHTML = ""; $("entrar").disabled = true;
    var r = await db.auth.signInWithPassword({ email: $("email").value.trim(), password: $("senha").value });
    $("entrar").disabled = false;
    if (r.error) { $("loginMsg").innerHTML = msgHtml("E-mail ou senha incorretos."); return; }
    $("senha").value = "";
    iniciarSessao();
  }
  $("entrar").addEventListener("click", entrar);
  $("senha").addEventListener("keydown", function (e) { if (e.key === "Enter") entrar(); });
  $("sair").addEventListener("click", async function () { await db.auth.signOut(); perfil = null; mostrarLogin(); });

  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-t]");
    if (b) ir(b.getAttribute("data-t"));
  });
  function ir(t) {
    aba = t;
    $("appView").classList.remove("open");
    document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-t") === t); });
    var f = { dash: telaDash, func: telaFunc, ex: telaEx, reg: telaReg, ocor: telaOcor, cal: telaCal, rel: telaRel, esc: telaEsc, cfg: telaCfg }[t];
    $("main").innerHTML = esqueleto();
    f().then(icones).catch(function (e) {
      $("main").innerHTML = '<div class="msg err"><i data-lucide="alert-triangle"></i><div>Não foi possível carregar esta tela. ' + esc(e.message || e) + '<br><button class="btn sec sm" id="tentar" style="margin-top:8px">Tentar de novo</button></div></div>';
      $("tentar").addEventListener("click", function () { ir(t); });
      icones();
    });
  }
  // menu: recolher/expandir e versão celular
  try { if (localStorage.getItem("menuRecolhido") === "1") $("appView").classList.add("collapsed"); } catch (e) {}
  $("recolher").addEventListener("click", function () {
    var c = $("appView").classList.toggle("collapsed");
    try { localStorage.setItem("menuRecolhido", c ? "1" : "0"); } catch (e) {}
  });
  $("burger").addEventListener("click", function () { $("appView").classList.add("open"); });
  $("scrim").addEventListener("click", function () { $("appView").classList.remove("open"); });

  /* ---------- Dashboard ---------- */
  async function telaDash() {
    var d = hoje(), dias = [];
    for (var i = 6; i >= 0; i--) dias.push(dataLocal(Date.now() - i * 864e5));
    var todos = await db.from("funcionarios").select("id,nome,escala_id,ativo").order("nome");
    if (todos.error) throw todos.error;
    var f = { data: todos.data.filter(function (x) { return x.ativo; }) };
    var ativoSet = {}; f.data.forEach(function (x) { ativoSet[x.id] = 1; });
    var b = await buscarTudo(function () { return db.from("batidas").select("id,funcionario_id,tipo,data,momento").gte("data", dias[0]).lte("data", d).order("momento"); });
    var inv = await buscarTudo(function () { return db.from("batidas_invalidadas").select("batida_id"); });
    var fer = await db.from("feriados").select("data,descricao").gte("data", dias[0]).lte("data", d);
    var invSet = {}; inv.forEach(function (x) { invSet[x.batida_id] = 1; });
    var ferMap = {}; (fer.data || []).forEach(function (x) { ferMap[x.data] = x.descricao; });
    var validas = b.filter(function (x) { return !invSet[x.id]; });
    var uteis = cfg.dias_uteis || [1, 2, 3, 4, 5], tol = cfg.tolerancia_min || 0;
    function util(dt) { return uteis.indexOf(new Date(dt + "T12:00:00").getDay()) >= 0 && !ferMap[dt]; }

    var ativos = f.data.length, hojeUtil = util(d);
    var porHoje = {};
    validas.filter(function (x) { return x.data === d; }).forEach(function (x) { (porHoje[x.funcionario_id] = porHoje[x.funcionario_id] || {})[x.tipo] = x.momento; });
    var presentes = 0, atrasos = 0;
    f.data.forEach(function (p) {
      var m = porHoje[p.id];
      if (!m) return;
      presentes++;
      var e = escalas.filter(function (x) { return x.id === p.escala_id; })[0];
      if (m.entrada && e && e.entrada) {
        var pr = e.entrada.split(":");
        if (minLocal(m.entrada) > Number(pr[0]) * 60 + Number(pr[1]) + tol) atrasos++;
      }
    });
    var semBatida = hojeUtil ? ativos - presentes : 0;
    var taxa = (hojeUtil && ativos) ? Math.round(presentes / ativos * 100) + "%" : "—";
    var batidasHoje = validas.filter(function (x) { return x.data === d; }).length;

    var pri = await primeiraBatida();
    var diasGraf = dias.filter(function (dt) { return pri && dt >= pri; });
    var barras = diasGraf.map(function (dt) {
      var u = util(dt);
      var ids = {}; validas.forEach(function (x) { if (x.data === dt && ativoSet[x.funcionario_id]) ids[x.funcionario_id] = 1; });
      var n = Object.keys(ids).length, pct = (u && ativos) ? Math.round(n / ativos * 100) : 0;
      var dd = dt.split("-"), dow = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(dt + "T12:00:00").getDay()];
      return '<div class="col"><span class="pct">' + (u ? pct + "%" : "") + '</span><div class="bar-wrap"><div class="bar' + (u ? "" : " off") + '" style="height:' + (u ? Math.max(pct, 2) : 4) + '%" title="' + (u ? n + " de " + ativos : (ferMap[dt] || "Não útil")) + '"></div></div><small>' + dow + "<br>" + dd[2] + "/" + dd[1] + "</small></div>";
    }).join("");

    var nomes = {}; todos.data.forEach(function (x) { nomes[x.id] = x.nome; });
    var ult = validas.slice().reverse().filter(function (x) { return nomes[x.funcionario_id]; }).slice(0, 8);
    var ultHtml = ult.length ? '<ul class="list">' + ult.map(function (x) {
      return '<li><div class="avatar">' + esc(iniciais(nomes[x.funcionario_id])) + '</div><div style="flex:1;min-width:0"><b>' + esc(nomes[x.funcionario_id]) + '</b><div class="muted" style="font-size:.82rem">' + NOMES[x.tipo] + " · " + (x.data === d ? "hoje" : dataBR(x.data)) + '</div></div><span class="tag blue">' + hora(x.momento) + "</span></li>";
    }).join("") + "</ul>" : '<div class="empty">Nenhum registro nos últimos 7 dias.</div>';

    var pend = [], agora = minLocal(new Date().toISOString());
    var porDia = {};
    validas.forEach(function (x) { if (ativoSet[x.funcionario_id] && x.data < d) { var k = x.funcionario_id + "|" + x.data; (porDia[k] = porDia[k] || []).push(x.tipo); } });
    Object.keys(porDia).sort().forEach(function (k) {
      if (porDia[k].indexOf("saida") < 0) { var q = k.split("|"); pend.push({ ic: "log-out", t: "<b>" + esc(nomes[q[0]]) + "</b> sem batida de saída em " + dataBR(q[1]) + ".", ir: "reg", dt: q[1] }); }
    });
    if (hojeUtil) {
      var ocHoje = await db.from("ocorrencias").select("funcionario_id,data_inicio,data_fim").eq("status", "aprovada").lte("data_inicio", d);
      var cobertos = {}; (ocHoje.data || []).forEach(function (o) { if ((o.data_fim || o.data_inicio) >= d) cobertos[o.funcionario_id] = 1; });
      f.data.forEach(function (p) {
        if (porHoje[p.id] || cobertos[p.id]) return;
        var e = escalas.filter(function (x) { return x.id === p.escala_id; })[0];
        if (!e || !e.entrada) return;
        var pr = e.entrada.split(":");
        if (agora > Number(pr[0]) * 60 + Number(pr[1]) + tol) pend.push({ ic: "user-x", t: "<b>" + esc(p.nome) + "</b> ainda não bateu a entrada (previsto " + e.entrada + ").", ir: "reg", dt: d });
      });
    }
    if (podeEditar()) {
      var po = await db.from("ocorrencias").select("id").eq("status", "pendente");
      if ((po.data || []).length) pend.push({ ic: "file-check", t: "<b>" + po.data.length + "</b> ocorrência(s) aguardando aprovação.", ir: "ocor" });
    }
    if (perfil === "admin") {
      var dp = new Date(d + "T12:00:00"); dp.setDate(0);
      var ymPrev = dp.toISOString().slice(0, 7), prim = await primeiraBatida();
      if (prim && prim <= ymPrev + "-31" && !(await mesFechadoInfo(ymPrev))) pend.push({ ic: "lock", t: "O mês <b>" + ymPrev.split("-")[1] + "/" + ymPrev.split("-")[0] + "</b> ainda não foi fechado.", ir: "rel" });
    }
    var pendHtml = pend.length
      ? '<div class="card" style="margin-bottom:14px"><h3>Pendências <span class="tag warn">' + pend.length + '</span></h3><ul class="list">' + pend.slice(0, 12).map(function (x) {
        return '<li><div class="ic amber" style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center"><i data-lucide="' + x.ic + '"></i></div><div style="flex:1">' + x.t + '</div><button class="btn sec sm" data-go="' + x.ir + '"' + (x.dt ? ' data-dt="' + x.dt + '"' : "") + ">Ver</button></li>";
      }).join("") + "</ul>" + (pend.length > 12 ? '<div class="muted">E mais ' + (pend.length - 12) + "…</div>" : "") + "</div>"
      : '<div class="msg ok"><i data-lucide="check-circle"></i><div>Nenhuma pendência no momento.</div></div>';
    function kpi(ic, cor, valor, rot) { return '<div class="card kpi"><div class="ic ' + cor + '"><i data-lucide="' + ic + '"></i></div><div><b>' + valor + "</b><span>" + rot + "</span></div></div>"; }
    var aviso = hojeUtil ? "" : '<div class="msg warn"><i data-lucide="calendar-off"></i><div>Hoje não é dia útil' + (ferMap[d] ? " (" + esc(ferMap[d]) + ")" : "") + ": faltas e taxa de presença não são calculadas.</div></div>";
    $("main").innerHTML =
      pageHead("layout-dashboard", "Dashboard", "Situação do ponto hoje, " + dataBR(d) + ".") + aviso + pendHtml +
      '<div class="kpis">' +
      kpi("users", "blue", ativos, "Funcionários ativos") +
      kpi("user-check", "green", presentes, "Presentes hoje") +
      kpi("user-x", "red", semBatida, "Sem batida até agora") +
      kpi("alarm-clock", "amber", atrasos, "Atrasos hoje") +
      kpi("gauge", "navy", taxa, "Taxa de presença") +
      kpi("clock", "blue", batidasHoje, "Registros de ponto hoje") + "</div>" +
      (ativos ? '<div class="two"><div class="card"><h3>Frequência dos últimos 7 dias</h3><div class="sub">Funcionários ativos com ao menos uma batida no dia. Dias não úteis em cinza.</div><div class="chart">' + (barras || '<div class="empty">O gráfico começa no primeiro dia com registros.</div>') + '</div></div>' +
        '<div class="card"><h3>Últimos registros</h3><div class="sub">Batidas mais recentes da equipe.</div>' + ultHtml + "</div></div>"
        : vazio("users", "Nenhum funcionário ativo ainda. Vá em Funcionários › Novo funcionário."));
    $("main").querySelectorAll("[data-go]").forEach(function (bt) {
      bt.addEventListener("click", function () { if (bt.getAttribute("data-dt")) regData = bt.getAttribute("data-dt"); ir(bt.getAttribute("data-go")); });
    });
  }

  /* ---------- Funcionários ---------- */
  var pinsSet = {};
  async function carregarPins() {
    var r = await db.rpc("pins_cadastrados");
    pinsSet = {};
    (r.data || []).forEach(function (id) { pinsSet[id] = 1; });
  }
  async function telaFunc() { return listaFunc(true); }
  async function telaEx() { return listaFunc(false); }

  async function listaFunc(ativos) {
    var r = await db.from("funcionarios").select("*").eq("ativo", ativos).order("nome");
    if (r.error) throw r.error;
    await carregarPins();
    var linhas = r.data.map(function (p) {
      var e = escalas.filter(function (x) { return x.id === p.escala_id; })[0];
      var acoes = "";
      if (podeEditar()) {
        if (ativos) acoes += '<button class="btn sec sm" data-a="pin" data-id="' + p.id + '" title="Definir PIN"><i data-lucide="key-round"></i> PIN</button> <button class="btn sec sm" data-a="dig" data-id="' + p.id + '" title="Digital"><i data-lucide="fingerprint"></i> Digital</button> <button class="btn sec sm" data-a="edit" data-id="' + p.id + '"><i data-lucide="pencil"></i> Editar</button> <button class="btn danger sm" data-a="rem" data-id="' + p.id + '"><i data-lucide="user-minus"></i> Remover</button>';
        else acoes += '<button class="btn sec sm" data-a="react" data-id="' + p.id + '"><i data-lucide="user-check"></i> Reativar</button>';
      }
      var acesso = ativos
        ? (pinsSet[p.id] ? '<span class="tag ok">PIN</span> ' : '<span class="tag warn">Sem PIN</span> ') + (p.digitais > 0 ? '<span class="tag blue">' + p.digitais + " digital" + (p.digitais > 1 ? "is" : "") + "</span>" : "")
        : '<span class="tag off">Desligado' + (p.desligamento ? " em " + dataBR(p.desligamento) : "") + "</span>" + (p.motivo_desligamento ? '<br><small class="muted">' + esc(p.motivo_desligamento) + "</small>" : "");
      return "<tr><td>" + esc(p.nome) + "</td><td>" + maskCpf(p.cpf) + "</td><td>" + esc(p.cargo || "") + "</td><td>" +
        esc(e ? e.nome + " (" + e.entrada + ")" : "") + "</td><td>" + acesso + '</td><td class="act">' + acoes + "</td></tr>";
    }).join("");
    var semPin = ativos ? r.data.filter(function (p) { return !pinsSet[p.id]; }).length : 0;
    var avisoPin = semPin ? '<div class="msg warn"><i data-lucide="key-round"></i><div><b>' + semPin + (semPin === 1 ? " funcionário está" : " funcionários estão") + " sem PIN</b> e não " + (semPin === 1 ? "consegue" : "conseguem") + " bater ponto. Use o botão PIN na linha de cada um.</div></div>" : "";
    $("main").innerHTML =
      pageHead(ativos ? "users" : "archive", ativos ? "Funcionários" : "Ex-funcionários",
        ativos ? "Cadastro da equipe. Quem sai da escola é removido (desligado) e o histórico de ponto continua guardado." : "Pessoas desligadas. O histórico delas continua guardado e dá para reativar.",
        (ativos && podeEditar() ? '<button class="btn" id="novo"><i data-lucide="user-plus"></i> Novo funcionário</button>' : "")) +
      avisoPin + '<div class="bar-tools"><div class="grow muted">' + r.data.length + (r.data.length === 1 ? " pessoa" : " pessoas") + '</div><div class="field" style="max-width:260px"><i data-lucide="search"></i><input id="busca" placeholder="Buscar por nome"></div></div>' +
      (r.data.length ? '<div class="scroll"><table><tr><th>Nome</th><th>CPF</th><th>Cargo</th><th>Escala</th><th>' + (ativos ? "Acesso ao ponto" : "Situação") + "</th><th></th></tr>" + linhas + "</table></div>"
        : vazio("users", ativos ? "Nenhum funcionário ativo por aqui." : "Nenhum ex-funcionário."));
    if ($("novo")) $("novo").addEventListener("click", function () { formFunc(null); });
    if ($("busca")) ligarBusca($("busca"), $("main"));
    var porId = {}; r.data.forEach(function (p) { porId[p.id] = p; });
    $("main").querySelectorAll("[data-a]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = porId[b.getAttribute("data-id")], a = b.getAttribute("data-a");
        if (a === "edit") formFunc(p);
        if (a === "rem") formRemover(p);
        if (a === "react") reativar(p);
        if (a === "pin") formPin(p);
        if (a === "dig") formDigital(p);
      });
    });
  }

  function formPin(p, aoSalvar) {
    modal("<h2>PIN de " + esc(p.nome) + "</h2><p class=\"muted\">O PIN (4 a 6 números) é pessoal e vai junto com o CPF na recepção. Ele é guardado criptografado: nem a direção consegue ver depois.</p>" +
      '<label>Novo PIN</label><input id="pN" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">' +
      '<label>Repita o PIN</label><input id="pN2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"><div id="pMsg"></div>' +
      '<div class="acts"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="pOk">Salvar PIN</button></div>',
      function (root, fechar) {
        root.querySelector("#pOk").addEventListener("click", async function () {
          var a = root.querySelector("#pN").value, b = root.querySelector("#pN2").value, m = root.querySelector("#pMsg");
          if (!/^\d{4,6}$/.test(a)) { m.innerHTML = msgHtml("O PIN deve ter de 4 a 6 números."); return; }
          if (a !== b) { m.innerHTML = msgHtml("Os dois PINs não são iguais."); return; }
          this.disabled = true;
          var r = await db.rpc("definir_pin", { p_id: p.id, p_pin: a });
          this.disabled = false;
          if (r.error || !r.data || !r.data.ok) { m.innerHTML = msgHtml((r.data && r.data.erro) || (r.error && r.error.message) || "Erro."); return; }
          fechar(); toast("PIN salvo."); if (aoSalvar) aoSalvar(); else ir(aba);
        });
      });
  }

  function formDigital(p) {
    var agente = Bio.criar(C.agente);
    var DEDOS = ["Polegar direito", "Indicador direito", "Médio direito", "Anelar direito", "Mínimo direito", "Polegar esquerdo", "Indicador esquerdo", "Médio esquerdo", "Anelar esquerdo", "Mínimo esquerdo"];
    modal("<h2>Digital de " + esc(p.nome) + "</h2>" +
      '<p class="muted">Cada pessoa pode ter até 2 digitais (ex.: os dois indicadores). Este computador precisa estar com o leitor conectado e o programa do leitor aberto.</p>' +
      '<div id="dSt" class="msg warn">Verificando o leitor…</div>' +
      '<p>Digitais cadastradas: <b id="dQtd">' + (p.digitais || 0) + "</b></p>" +
      '<label>Dedo</label><select id="dDedo">' + DEDOS.map(function (n, i) { return '<option value="' + (i === 1 ? 6 : i === 6 ? 1 : i) + '">' + n + "</option>"; }).join("") + "</select>" +
      '<div id="dMsg"></div><div class="acts"><button class="btn danger" id="dRem"><i data-lucide="trash-2"></i> Remover digitais</button><button class="btn sec" data-fechar>Fechar</button><button class="btn" id="dCap" disabled><i data-lucide="fingerprint"></i> Capturar</button></div>',
      function (root) {
        var st = root.querySelector("#dSt"), cap = root.querySelector("#dCap"), m = root.querySelector("#dMsg");
        root.querySelector("#dDedo").value = "1";
        agente.status().then(function (s) {
          if (s.conectado) { st.className = "msg ok"; st.textContent = "Leitor conectado" + (s.leitor ? ": " + s.leitor : "") + "."; cap.disabled = false; }
          else { st.className = "msg err"; st.textContent = "Leitor não encontrado. Conecte o leitor e abra o programa do leitor neste computador."; }
        });
        cap.addEventListener("click", async function () {
          this.disabled = true;
          m.innerHTML = msgHtml("Coloque o mesmo dedo no leitor 3 vezes, soltando entre as leituras…", "warn");
          var r = await agente.cadastrar();
          if (!r.ok || !r.template) { m.innerHTML = msgHtml(r.erro === "agente_indisponivel" ? "O programa do leitor não respondeu." : "Não foi possível ler a digital. Tente de novo."); this.disabled = false; return; }
          var s = await db.rpc("bio_salvar_digital", { p_funcionario_id: p.id, p_dedo: Number(root.querySelector("#dDedo").value), p_template: r.template });
          this.disabled = false;
          if (s.error || !s.data || !s.data.ok) { m.innerHTML = msgHtml((s.data && s.data.erro) || (s.error && s.error.message) || "Erro."); return; }
          var q = root.querySelector("#dQtd"); q.textContent = String(Number(q.textContent) + 1 > 2 ? 2 : Number(q.textContent) + 1);
          m.innerHTML = msgHtml("Digital cadastrada.", "ok");
        });
        root.querySelector("#dRem").addEventListener("click", async function () {
          if (!confirm("Remover todas as digitais de " + p.nome + "?")) return;
          var r = await db.rpc("bio_remover_digitais", { p_funcionario_id: p.id });
          if (r.error || (r.data && r.data.ok === false)) { m.innerHTML = msgHtml("Não foi possível remover: " + ((r.data && r.data.erro) || (r.error && r.error.message))); return; }
          root.querySelector("#dQtd").textContent = "0"; m.innerHTML = msgHtml("Digitais removidas.", "ok");
        });
      });
    // atualiza a lista ao fechar
    var obs = new MutationObserver(function () { if (!$("modalRoot").innerHTML) { obs.disconnect(); if (aba === "func") ir("func"); } });
    obs.observe($("modalRoot"), { childList: true });
  }

  function opcoesEscala(sel) {
    return escalas.filter(function (e) { return e.ativa || e.id === sel; }).map(function (e) {
      return '<option value="' + e.id + '"' + (e.id === sel ? " selected" : "") + ">" + esc(e.nome) + " — " + e.entrada + " às " + e.saida + "</option>";
    }).join("");
  }

  function formFunc(p) {
    var novo = !p;
    modal(
      "<h2>" + (novo ? "Novo funcionário" : "Editar funcionário") + "</h2>" +
      '<label>Nome completo</label><input id="fNome" value="' + esc(p ? p.nome : "") + '">' +
      '<label>CPF</label><input id="fCpf" inputmode="numeric" maxlength="14" value="' + (p ? maskCpf(p.cpf) : "") + '"' + (novo ? "" : " disabled") + ">" +
      '<label>Cargo</label><input id="fCargo" value="' + esc(p ? p.cargo || "" : "") + '">' +
      '<label>Data de admissão</label><input id="fAdm" type="date" value="' + (p && p.admissao ? p.admissao : "") + '">' +
      '<label>Escala</label><select id="fEsc">' + opcoesEscala(p ? p.escala_id : 1) + "</select>" +
      (novo ? '<label>PIN de acesso (4 a 6 números)</label><input id="fPin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"><small class="muted">Pode ser definido depois, em Funcionários › PIN. Sem PIN a pessoa não consegue bater ponto.</small>' : "") +
      (novo ? "" : '<div id="boxMotivo" class="hidden"><label>Motivo da troca de escala (obrigatório)</label><input id="fMot"></div>') +
      '<div id="fMsg"></div><div class="acts">' + (!novo && perfil === "admin" ? '<button class="btn ghost-danger" id="fExc" title="Só funciona se a pessoa nunca bateu ponto"><i data-lucide="trash-2"></i> Excluir cadastro</button>' : "") + '<button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="fSalvar">Salvar</button></div>',
      function (root, fechar) {
        var cpfEl = root.querySelector("#fCpf");
        cpfEl.addEventListener("input", function () { if (!cpfEl.disabled) cpfEl.value = maskCpf(cpfEl.value.replace(/\D/g, "").slice(0, 11)).replace(/[.-]$/, ""); });
        if (!novo) root.querySelector("#fEsc").addEventListener("change", function () {
          root.querySelector("#boxMotivo").classList.toggle("hidden", Number(this.value) === p.escala_id);
        });
        if (!novo && root.querySelector("#fExc")) root.querySelector("#fExc").addEventListener("click", function () { fechar(); excluir(p); });
        root.querySelector("#fSalvar").addEventListener("click", async function () {
          var pinNovo = novo ? root.querySelector("#fPin").value : "";
          if (novo && pinNovo && !/^\d{4,6}$/.test(pinNovo)) { root.querySelector("#fMsg").innerHTML = msgHtml("O PIN deve ter de 4 a 6 números."); return; }
          var nome = root.querySelector("#fNome").value.trim();
          var cpf = cpfEl.value.replace(/\D/g, "");
          var m = root.querySelector("#fMsg");
          if (nome.length < 3) { m.innerHTML = msgHtml("Digite o nome completo."); return; }
          if (novo && !cpfValido(cpf)) { m.innerHTML = msgHtml("CPF inválido."); return; }
          var esc_id = Number(root.querySelector("#fEsc").value);
          var dados = { nome: nome, cargo: root.querySelector("#fCargo").value.trim() || null, admissao: root.querySelector("#fAdm").value || null, escala_id: esc_id };
          this.disabled = true;
          var r;
          if (novo) {
            dados.cpf = cpf;
            r = await db.from("funcionarios").insert(dados).select().single();
            if (!r.error) await db.from("auditoria").insert({ acao: "funcionario.criar", detalhe: { id: r.data.id, nome: nome } });
          } else {
            var mot = (root.querySelector("#fMot") || {}).value || "";
            if (esc_id !== p.escala_id && mot.trim().length < 3) { m.innerHTML = msgHtml("Informe o motivo da troca de escala."); this.disabled = false; return; }
            r = await db.from("funcionarios").update(dados).eq("id", p.id);
            if (!r.error && esc_id !== p.escala_id) {
              var ant = escalas.filter(function (x) { return x.id === p.escala_id; })[0];
              await db.from("alteracoes").insert({ funcionario_id: p.id, tipo: "permanente", data_inicio: hoje(), escala_id: esc_id, anterior: ant ? ant.nome : String(p.escala_id), motivo: mot.trim() });
            }
            if (!r.error) await db.from("auditoria").insert({ acao: "funcionario.editar", detalhe: { id: p.id, nome: nome } });
          }
          this.disabled = false;
          if (r.error) {
            m.innerHTML = msgHtml(r.error.code === "23505" ? "Já existe um funcionário com este CPF (pode estar desligado: use Mostrar desligados › Reativar)." : "Erro: " + r.error.message);
            return;
          }
          var avisoPin = "";
          if (novo && pinNovo) { var rp = await db.rpc("definir_pin", { p_id: r.data.id, p_pin: pinNovo }); if (rp.error || !rp.data || !rp.data.ok) avisoPin = " Mas o PIN não foi salvo: defina em PIN."; }
          fechar(); ir("func"); toast((novo ? "Funcionário cadastrado." : "Alterações salvas.") + avisoPin, !!avisoPin);
        });
      });
  }

  function formRemover(p) {
    modal(
      "<h2>Remover funcionário</h2>" +
      "<p><b>" + esc(p.nome) + "</b> deixará de bater ponto. O histórico e os relatórios dele continuam guardados, e dá para reativar depois.</p>" +
      '<label>Data do desligamento</label><input id="rData" type="date" value="' + hoje() + '">' +
      '<label>Motivo (opcional)</label><input id="rMot" placeholder="Ex.: pedido de demissão">' +
      '<div id="rMsg"></div><div class="acts"><button class="btn sec" data-fechar>Cancelar</button><button class="btn danger" id="rOk">Confirmar remoção</button></div>',
      function (root, fechar) {
        root.querySelector("#rOk").addEventListener("click", async function () {
          this.disabled = true;
          var r = await db.rpc("desligar_funcionario", { p_id: p.id, p_data: root.querySelector("#rData").value || null, p_motivo: root.querySelector("#rMot").value });
          this.disabled = false;
          if (r.error || !r.data || !r.data.ok) { root.querySelector("#rMsg").innerHTML = msgHtml((r.data && r.data.erro) || (r.error && r.error.message) || "Erro."); return; }
          fechar(); ir("func"); toast(p.nome + " foi removido(a). O histórico foi mantido.");
        });
      });
  }

  async function reativar(p) {
    if (!confirm("Reativar " + p.nome + "? Ele voltará a bater ponto.")) return;
    var r = await db.rpc("reativar_funcionario", { p_id: p.id });
    if (r.error || !r.data || !r.data.ok) { toast((r.data && r.data.erro) || (r.error && r.error.message), true); return; }
    ir("func"); toast(p.nome + " foi reativado(a).");
  }
  async function excluir(p) {
    if (!confirm("Excluir o cadastro de " + p.nome + " definitivamente?\n\nIsso só é permitido se a pessoa nunca bateu ponto. Para quem já trabalhou, use Remover.")) return;
    var r = await db.rpc("excluir_funcionario", { p_id: p.id });
    if (r.error || !r.data || !r.data.ok) { toast((r.data && r.data.erro) || (r.error && r.error.message), true); return; }
    ir("func"); toast("Cadastro excluído.");
  }

  /* ---------- Registros ---------- */
  var regData = null;
  async function telaReg() {
    regData = regData || hoje();
    var b = await db.from("batidas").select("*").eq("data", regData).order("momento");
    var trav = !!(await mesFechadoInfo(regData.slice(0, 7)));
    var f = await db.from("funcionarios").select("id,nome,ativo").order("nome");
    var inv = await db.from("batidas_invalidadas").select("*");
    if (b.error || f.error) throw (b.error || f.error);
    var nomes = {}; f.data.forEach(function (x) { nomes[x.id] = x.nome; });
    var invMap = {}; (inv.data || []).forEach(function (i) { invMap[i.batida_id] = i; });
    var linhas = b.data.map(function (x) {
      var i = invMap[x.id];
      return "<tr" + (i ? ' style="opacity:.55"' : "") + "><td>" + esc(nomes[x.funcionario_id] || "?") + "</td><td>" + NOMES[x.tipo] + "</td><td>" + hora(x.momento) + "</td><td>" +
        (x.origem === "ajuste" ? '<span class="tag warn">Ajuste</span>' : '<span class="tag">Recepção</span>') + "</td><td>" +
        (i ? '<span class="tag err">Invalidada</span><br><small>' + esc(i.motivo) + "</small>" : (x.motivo ? "<small>" + esc(x.motivo) + "</small>" : "")) + '</td><td class="act">' +
        (podeEditar() && !i && !trav ? '<button class="btn sec sm" data-ed="' + x.id + '"><i data-lucide="pencil"></i> Corrigir hora</button> <button class="btn sec sm" data-inv="' + x.id + '"><i data-lucide="ban"></i> Invalidar</button>' : "") + "</td></tr>";
    }).join("");
    $("main").innerHTML =
      pageHead("clock", "Registros de ponto", "Batidas de cada dia. Para corrigir, invalide a batida com motivo e lance um ajuste.",
        (podeEditar() && !trav ? '<button class="btn" id="rgAj"><i data-lucide="plus"></i> Lançar batida esquecida</button> <button class="btn sec" id="rgAb"><i data-lucide="file-check"></i> Abonar dia (atestado etc.)</button>' + (perfil === "admin" ? ' <button class="btn sec" id="rgSA"><i data-lucide="calendar-off"></i> Dia sem aula/feriado</button>' : "") : "")) +
      (trav ? '<div class="msg warn"><i data-lucide="lock"></i><div>Este mês está fechado: não é possível lançar nem corrigir ponto. O administrador pode reabrir em Relatórios.</div></div>' : "") +
      '<div class="bar-tools"><label class="chk" for="rgD"><i data-lucide="calendar"></i> Dia</label><input type="date" id="rgD" value="' + regData + '"><div class="field" style="max-width:260px"><i data-lucide="search"></i><input id="busca" placeholder="Buscar por nome"></div></div>' +
      (b.data.length ? '<div class="scroll"><table><tr><th>Funcionário</th><th>Tipo</th><th>Hora</th><th>Origem</th><th>Observação</th><th></th></tr>' + linhas + "</table></div>"
        : vazio("clock", "Nenhuma batida em " + dataBR(regData) + "."));
    ligarBusca($("busca"), $("main"));
    $("rgD").addEventListener("change", function () { regData = this.value || hoje(); ir("reg"); });
    var ativosF = f.data.filter(function (x) { return x.ativo; });
    if ($("rgAj")) $("rgAj").addEventListener("click", function () { formAjuste(ativosF); });
    if ($("rgAb")) $("rgAb").addEventListener("click", function () { formOcor(ativosF, regData, "falta_justificada"); });
    if ($("rgSA")) $("rgSA").addEventListener("click", function () { formDiaSemAula(regData); });
    var bPorId = {}; b.data.forEach(function (x) { bPorId[x.id] = x; });
    $("main").querySelectorAll("[data-ed]").forEach(function (bt) {
      bt.addEventListener("click", function () { var x = bPorId[bt.getAttribute("data-ed")]; formEditarBatida(x, nomes[x.funcionario_id]); });
    });
    $("main").querySelectorAll("[data-inv]").forEach(function (bt) {
      bt.addEventListener("click", function () { formInvalidar(Number(bt.getAttribute("data-inv"))); });
    });
  }
  function formInvalidar(id) {
    modal("<h2>Invalidar batida</h2><label>Motivo (obrigatório)</label><input id=\"iMot\"><div id=\"iMsg\"></div>" +
      '<div class="acts"><button class="btn sec" data-fechar>Cancelar</button><button class="btn danger" id="iOk">Invalidar</button></div>',
      function (root, fechar) {
        root.querySelector("#iOk").addEventListener("click", async function () {
          var mot = root.querySelector("#iMot").value.trim();
          if (mot.length < 3) { root.querySelector("#iMsg").innerHTML = msgHtml("Informe o motivo."); return; }
          var r = await db.from("batidas_invalidadas").insert({ batida_id: id, motivo: mot });
          if (r.error) { root.querySelector("#iMsg").innerHTML = msgHtml(r.error.message); return; }
          await db.from("auditoria").insert({ acao: "batida.invalidar", detalhe: { batida_id: id, motivo: mot } });
          fechar(); ir("reg");
        });
      });
  }
  function formEditarBatida(x, nome) {
    modal("<h2>Corrigir horário</h2><p><b>" + esc(nome) + "</b> · " + NOMES[x.tipo] + " em " + dataBR(x.data) + ". Hoje consta " + hora(x.momento) + ". A batida antiga fica guardada como invalidada e uma nova é lançada como ajuste.</p>" +
      '<label>Horário correto</label><input type="time" id="eH" value="' + hora(x.momento) + '"><label>Motivo (obrigatório)</label><input id="eM" placeholder="Ex.: bateu na hora errada"><div id="eMsg"></div>' +
      '<div class="acts"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="eOk">Corrigir</button></div>',
      function (root, fechar) {
        root.querySelector("#eOk").addEventListener("click", async function () {
          var h = root.querySelector("#eH").value, mot = root.querySelector("#eM").value.trim(), m = root.querySelector("#eMsg");
          if (!h || mot.length < 3) { m.innerHTML = msgHtml("Informe o horário e o motivo."); return; }
          this.disabled = true;
          var inv = await db.from("batidas_invalidadas").insert({ batida_id: x.id, motivo: "Corrigida: " + mot });
          if (inv.error) { m.innerHTML = msgHtml(inv.error.message); this.disabled = false; return; }
          var r = await db.from("batidas").insert({ funcionario_id: x.funcionario_id, tipo: x.tipo, data: x.data, momento: x.data + "T" + h + ":00-03:00", origem: "ajuste", metodo: "ajuste", motivo: mot });
          if (r.error) { m.innerHTML = msgHtml("A batida antiga foi invalidada, mas a nova não foi lançada: " + r.error.message + ". Use Lançar batida esquecida."); this.disabled = false; return; }
          await db.from("auditoria").insert({ acao: "batida.corrigir", detalhe: { batida_id: x.id, novo: h, motivo: mot } });
          fechar(); ir("reg"); toast("Horário corrigido.");
        });
      });
  }
  function formDiaSemAula(data) {
    modal("<h2>Dia sem aula / feriado</h2><p>Vale para <b>todos</b> os funcionários: o dia não conta como falta e quem trabalhar tem tudo como hora extra.</p>" +
      '<label>Data</label><input type="date" id="sD" value="' + data + '"><label>Descrição</label><input id="sT" placeholder="Ex.: Recesso escolar"><div id="sMsg"></div>' +
      '<div class="acts"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="sOk">Salvar</button></div>',
      function (root, fechar) {
        root.querySelector("#sOk").addEventListener("click", async function () {
          var d = root.querySelector("#sD").value, t = root.querySelector("#sT").value.trim();
          if (!d || t.length < 2) { root.querySelector("#sMsg").innerHTML = msgHtml("Informe a data e a descrição."); return; }
          var r = await db.from("feriados").insert({ data: d, descricao: t });
          if (r.error) { root.querySelector("#sMsg").innerHTML = msgHtml(r.error.code === "23505" ? "Esse dia já está cadastrado." : r.error.message); return; }
          fechar(); ir("reg"); toast("Dia marcado.");
        });
      });
  }
  function formAjuste(funcs) {
    modal("<h2>Lançar batida esquecida</h2>" +
      '<label>Funcionário</label><select id="aF">' + funcs.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nome) + "</option>"; }).join("") + "</select>" +
      '<label>Tipo</label><select id="aT">' + TIPOS.map(function (t) { return '<option value="' + t + '">' + NOMES[t] + "</option>"; }).join("") + "</select>" +
      '<div class="row2"><div><label>Data</label><input type="date" id="aD" value="' + regData + '"></div><div><label>Hora</label><input type="time" id="aH"></div></div>' +
      '<label>Motivo (obrigatório)</label><input id="aM"><div id="aMsg"></div>' +
      '<div class="acts"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="aOk">Lançar</button></div>',
      function (root, fechar) {
        root.querySelector("#aOk").addEventListener("click", async function () {
          var d = root.querySelector("#aD").value, h = root.querySelector("#aH").value, mot = root.querySelector("#aM").value.trim();
          if (!d || !h || mot.length < 3) { root.querySelector("#aMsg").innerHTML = msgHtml("Preencha data, hora e motivo."); return; }
          var r = await db.from("batidas").insert({
            funcionario_id: Number(root.querySelector("#aF").value), tipo: root.querySelector("#aT").value,
            data: d, momento: d + "T" + h + ":00-03:00", origem: "ajuste", metodo: "ajuste", motivo: mot
          });
          if (r.error) { root.querySelector("#aMsg").innerHTML = msgHtml(r.error.message); return; }
          regData = d; fechar(); ir("reg");
        });
      });
  }

  /* ---------- dados compartilhados (relatório) ---------- */
  var TIPOS_OC = Calc.TIPOS_OCORRENCIA;
  function diasDoMes(ym) {
    var p = ym.split("-"), n = new Date(Number(p[0]), Number(p[1]), 0).getDate(), out = [];
    for (var d = 1; d <= n; d++) out.push(ym + "-" + String(d).padStart(2, "0"));
    return out;
  }
  async function carregarPeriodo(ini, fim) {
    var bs = await buscarTudo(function () { return db.from("batidas").select("id,funcionario_id,tipo,data,momento").gte("data", ini).lte("data", fim).order("momento"); });
    var inv = await buscarTudo(function () { return db.from("batidas_invalidadas").select("batida_id"); });
    var fer = await db.from("feriados").select("data,descricao").gte("data", ini).lte("data", fim);
    var oc = await buscarTudo(function () { return db.from("ocorrencias").select("*").eq("status", "aprovada").lte("data_inicio", fim).order("id"); });
    var invSet = {}; inv.forEach(function (i) { invSet[i.batida_id] = 1; });
    var ferMap = {}; (fer.data || []).forEach(function (x) { ferMap[x.data] = x.descricao; });
    return {
      batidas: bs.filter(function (b) { return !invSet[b.id]; }), feriados: ferMap,
      ocorrencias: oc.filter(function (o) { return (o.data_fim || o.data_inicio) >= ini; })
    };
  }
  function calcular(p, ini, fim, dados) {
    return Calc.calcularFuncionario(p, ini, fim, {
      hoje: hoje(), tol: cfg.tolerancia_min || 0, uteis: cfg.dias_uteis || [1, 2, 3, 4, 5], feriados: dados.feriados, jornada: C.jornadaMin,
      batidas: dados.batidas.filter(function (b) { return b.funcionario_id === p.id; }),
      ocorrencias: dados.ocorrencias.filter(function (o) { return o.funcionario_id === p.id; })
    });
  }
  async function mesFechadoInfo(ym) {
    var r = await db.from("meses_fechados").select("*").eq("mes", ym + "-01").maybeSingle();
    return r.data && !r.data.reaberto_em ? r.data : null;
  }
  function ligarBusca(input, escopo) {
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      escopo.querySelectorAll("tr").forEach(function (tr) {
        if (tr.querySelector("th")) return;
        tr.style.display = !q || tr.textContent.toLowerCase().indexOf(q) >= 0 ? "" : "none";
      });
    });
  }
  async function primeiraBatida() {
    var r = await db.from("batidas").select("data").order("data").limit(1);
    return r.data && r.data[0] ? r.data[0].data : null;
  }
  function baixarCsv(nome, linhas) {
    var txt = "﻿" + linhas.map(function (l) {
      return l.map(function (c) { c = String(c == null ? "" : c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(";");
    }).join("\r\n");
    baixar(nome, txt, "text/csv;charset=utf-8");
  }
  function baixar(nome, txt, tipo) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: tipo }));
    a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- Ocorrências ---------- */
  async function telaOcor() {
    var f = await db.from("funcionarios").select("id,nome,ativo").order("nome");
    var o = await db.from("ocorrencias").select("*").order("data_inicio", { ascending: false }).limit(300);
    if (f.error || o.error) throw (f.error || o.error);
    var nomes = {}; f.data.forEach(function (x) { nomes[x.id] = x.nome; });
    var ST = { pendente: '<span class="tag warn">Pendente</span>', aprovada: '<span class="tag ok">Aprovada</span>', rejeitada: '<span class="tag err">Rejeitada</span>' };
    var linhas = o.data.map(function (x) {
      var t = TIPOS_OC[x.tipo] || { rotulo: x.tipo };
      var per = dataBR(x.data_inicio) + (x.data_fim && x.data_fim !== x.data_inicio ? " a " + dataBR(x.data_fim) : "");
      var ac = (perfil === "admin" && x.status === "pendente")
        ? '<button class="btn sm" data-ap="' + x.id + '"><i data-lucide="check"></i> Aprovar</button> <button class="btn danger sm" data-rj="' + x.id + '"><i data-lucide="x"></i> Rejeitar</button>' : "";
      return "<tr><td>" + esc(nomes[x.funcionario_id] || "?") + "</td><td>" + esc(t.rotulo) + "</td><td>" + per + "</td><td>" + (x.minutos ? hm(x.minutos) : "") + "</td><td>" + esc(x.descricao || "") + "</td><td>" + (ST[x.status] || x.status) + '</td><td class="act">' + ac + "</td></tr>";
    }).join("");
    $("main").innerHTML =
      pageHead("file-check", "Ocorrências e abonos", "Atestados, férias, afastamentos, faltas justificadas, dias abonados e abonos de atraso. Só as aprovadas pelo administrador entram nos cálculos.",
        (podeEditar() ? '<button class="btn" id="oNova"><i data-lucide="plus"></i> Nova ocorrência</button>' : "")) +
      (o.data.length ? '<div class="scroll"><table><tr><th>Funcionário</th><th>Tipo</th><th>Período</th><th>Minutos</th><th>Descrição</th><th>Situação</th><th></th></tr>' + linhas + "</table></div>"
        : vazio("file-check", "Nenhuma ocorrência registrada."));
    if ($("oNova")) $("oNova").addEventListener("click", function () { formOcor(f.data.filter(function (x) { return x.ativo; })); });
    async function decidir(id, st) {
      var r = await db.from("ocorrencias").update({ status: st }).eq("id", id);
      if (r.error) { toast(r.error.message, true); return; }
      await db.from("auditoria").insert({ acao: "ocorrencia." + st, detalhe: { id: id } });
      ir("ocor"); toast(st === "aprovada" ? "Ocorrência aprovada." : "Ocorrência rejeitada.");
    }
    $("main").querySelectorAll("[data-ap]").forEach(function (b) { b.addEventListener("click", function () { decidir(Number(b.getAttribute("data-ap")), "aprovada"); }); });
    $("main").querySelectorAll("[data-rj]").forEach(function (b) { b.addEventListener("click", function () { decidir(Number(b.getAttribute("data-rj")), "rejeitada"); }); });
  }
  function formOcor(funcs, dataPad, tipoPad, funcPad) {
    modal("<h2>Nova ocorrência</h2>" +
      '<label>Funcionário</label><select id="oF">' + funcs.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nome) + "</option>"; }).join("") + "</select>" +
      '<label>Tipo</label><select id="oT">' + Object.keys(TIPOS_OC).map(function (k) { return '<option value="' + k + '">' + esc(TIPOS_OC[k].rotulo) + "</option>"; }).join("") + "</select>" +
      '<div class="row2"><div><label>De</label><input type="date" id="oI" value="' + (dataPad || hoje()) + '"></div><div><label>Até</label><input type="date" id="oFim" value="' + (dataPad || hoje()) + '"></div></div>' +
      '<div id="oBoxMin" class="hidden"><label>Minutos abonados</label><input type="number" id="oMin" min="1" max="600" placeholder="Ex.: 30"></div>' +
      '<label>Descrição / motivo (obrigatório)</label><input id="oD" placeholder="Ex.: atestado do Dr. Fulano, CID não informado"><div id="oMsg"></div>' +
      '<p class="muted" style="font-size:.82rem">' + (perfil === "admin" ? "Como administrador, a ocorrência já entra aprovada." : "Ficará pendente até o administrador aprovar.") + "</p>" +
      '<div class="acts"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="oOk">Salvar</button></div>',
      function (root, fechar) {
        var tp = root.querySelector("#oT");
        function ajusta() { root.querySelector("#oBoxMin").classList.toggle("hidden", TIPOS_OC[tp.value].efeito !== "minutos"); }
        if (tipoPad) tp.value = tipoPad; if (funcPad) root.querySelector("#oF").value = String(funcPad);
        tp.addEventListener("change", ajusta); ajusta();
        root.querySelector("#oOk").addEventListener("click", async function () {
          var m = root.querySelector("#oMsg"), ini = root.querySelector("#oI").value, fim = root.querySelector("#oFim").value || ini;
          var desc = root.querySelector("#oD").value.trim(), min = Number(root.querySelector("#oMin").value) || null;
          if (!ini || fim < ini) { m.innerHTML = msgHtml("Confira as datas."); return; }
          if (desc.length < 3) { m.innerHTML = msgHtml("Informe a descrição."); return; }
          if (TIPOS_OC[tp.value].efeito === "minutos" && !min) { m.innerHTML = msgHtml("Informe os minutos."); return; }
          this.disabled = true;
          var r = await db.from("ocorrencias").insert({ funcionario_id: Number(root.querySelector("#oF").value), tipo: tp.value, data_inicio: ini, data_fim: fim, minutos: min, descricao: desc, status: perfil === "admin" ? "aprovada" : "pendente" });
          this.disabled = false;
          if (r.error) { m.innerHTML = msgHtml(r.error.message); return; }
          fechar(); ir("ocor"); toast("Ocorrência registrada.");
        });
      });
  }

  /* ---------- Relatórios ---------- */
  async function telaRel() {
    var f = await db.from("funcionarios").select("id,nome,cpf,cargo,admissao,ativo,desligamento").order("nome");
    if (f.error) throw f.error;
    var mes = hoje().slice(0, 7);
    $("main").innerHTML =
      pageHead("file-text", "Relatórios", "Fechamento mensal: horas extras a pagar e horas devidas a descontar. Não há acúmulo de banco de horas. PDF, impressão ou Excel.") +
      '<div class="bar-tools"><input type="month" id="rM" value="' + mes + '">' +
      '<select id="rF" style="max-width:280px"><option value="0">Todos (consolidado)</option>' +
      f.data.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nome) + (x.ativo ? "" : " (desligado)") + "</option>"; }).join("") + "</select>" +
      '<button class="btn" id="rG"><i data-lucide="play"></i> Gerar</button><button class="btn sec hidden" id="rP"><i data-lucide="printer"></i> Imprimir / PDF</button><button class="btn sec hidden" id="rX"><i data-lucide="download"></i> Excel (CSV)</button></div>' +
      '<div id="rFech"></div><div id="rOut"></div>';
    var csv = [], nomeCsv = "";
    $("rG").addEventListener("click", async function () { var o = await gerar(f.data); csv = o.csv; nomeCsv = o.nome; });
    $("rP").addEventListener("click", function () { window.print(); });
    $("rX").addEventListener("click", function () { baixarCsv(nomeCsv, csv); });
  }

  async function gerar(funcs) {
    var ym = $("rM").value, fid = Number($("rF").value);
    if (!ym) return { csv: [], nome: "" };
    $("rOut").innerHTML = '<div class="skel" style="height:160px"></div>';
    var dias = diasDoMes(ym), ini = dias[0], fim = dias[dias.length - 1], tol = cfg.tolerancia_min || 0;
    var dados = await carregarPeriodo(ini, fim);
    var lista = fid ? funcs.filter(function (x) { return x.id === fid; }) : funcs;
    var resultados = lista.map(function (p) { return calcular(p, ini, fim, dados); });
    var csv = [], html;
    var cab = '<div class="printonly"><img src="img/logo.png" alt=""><h2>Relatório de ponto — ' + esc(C.escola) + "</h2></div>";
    html = cab + '<p class="muted">Período: ' + dataBR(ini) + " a " + dataBR(fim) + " · Jornada: " + hm(C.jornadaMin) + " · Tolerância: " + tol + " min</p>";
    if (!fid) {
      csv.push(["Funcionário", "Dias trabalhados", "Horas trabalhadas", "Extras (a pagar)", "Devidas (a descontar)", "Faltas", "Abonados", "Líquido do mês"]);
      html += '<div class="scroll"><table><tr><th>Funcionário</th><th>Dias trabalhados</th><th>Horas trabalhadas</th><th>Extras (a pagar)</th><th>Devidas (a descontar)</th><th>Faltas</th><th>Abonos</th><th>Líquido do mês</th></tr>' +
        resultados.map(function (r) {
          var s = r.extra - r.dev;
          csv.push([r.p.nome, r.diasTrab, hm(r.trab), hm(r.extra), hm(r.dev), r.faltas, r.abonados, hm(s)]);
          return "<tr><td>" + esc(r.p.nome) + (r.p.ativo ? "" : ' <span class="tag off">desligado</span>') + "</td><td>" + r.diasTrab + "</td><td>" + hm(r.trab) + '</td><td class="pos">' + hm(r.extra) + '</td><td class="neg">' + hm(r.dev) + "</td><td>" + r.faltas + "</td><td>" + r.abonados + '</td><td class="' + (s < 0 ? "neg" : "pos") + '">' + hm(s) + "</td></tr>";
        }).join("") + "</table></div>";
      var inc = resultados.reduce(function (a, r) { return a + r.incompletos; }, 0);
      if (inc) html += '<div class="msg warn">' + inc + " dia(s) com batidas incompletas (sem saída) não entram no saldo. Confira em Registros de ponto.</div>";
    } else {
      var r = resultados[0], s = r.extra - r.dev;
      csv.push(["Data", "Entrada", "Saída almoço", "Retorno", "Saída", "Trabalhado", "Extra", "Devido", "Observação"]);
      html += "<h3>" + esc(r.p.nome) + ' <small class="muted">CPF ' + maskCpf(r.p.cpf) + (r.p.cargo ? " · " + esc(r.p.cargo) : "") + "</small></h3>" +
        '<div class="scroll"><table><tr><th>Data</th><th>Entrada</th><th>Saída almoço</th><th>Retorno</th><th>Saída</th><th>Trabalhado</th><th>Extra</th><th>Devido</th><th>Obs.</th></tr>' +
        r.dias.map(function (x) {
          var m = {}; x.bd.forEach(function (b) { m[b.tipo] = b.momento; });
          csv.push([dataBR(x.d)].concat(TIPOS.map(function (t) { return m[t] ? hora(m[t]) : ""; }), [x.trab ? hm(x.trab) : "", x.extra ? hm(x.extra) : "", x.dev ? hm(x.dev) : "", x.obs]));
          return "<tr><td>" + dataBR(x.d) + "</td>" + TIPOS.map(function (t) { return "<td>" + (m[t] ? hora(m[t]) : "") + "</td>"; }).join("") +
            "<td>" + (x.trab ? hm(x.trab) : "") + '</td><td class="pos">' + (x.extra ? hm(x.extra) : "") + '</td><td class="neg">' + (x.dev ? hm(x.dev) : "") + "</td><td>" + esc(x.obs) + "</td></tr>";
        }).join("") + "</table></div>" +
        "<p><b>Totais:</b> trabalhadas " + hm(r.trab) + " · extras " + hm(r.extra) + " · devidas " + hm(r.dev) + " · faltas " + r.faltas + " · abonados " + r.abonados + " · <b>líquido do mês " + hm(s) + "</b></p>";
      csv.push([]); csv.push(["Totais", "", "", "", "", hm(r.trab), hm(r.extra), hm(r.dev), "Líquido " + hm(s)]);
    }
    html += '<div class="printonly assin">' + (fid ? "<div>" + esc(resultados[0].p.nome) + "<br><small>Funcionário(a)</small></div>" : "") + "<div>Direção<br><small>" + esc(C.escola) + "</small></div></div>";
    html += '<p class="muted" style="font-size:.8rem">Controle interno, não é registro de ponto homologado (Portaria MTP 671/2021). Ocorrências aprovadas (atestados, abonos, folgas) já estão consideradas.</p>';
    $("rOut").innerHTML = html;
    $("rP").classList.remove("hidden"); $("rX").classList.remove("hidden");
    await montarFechamento(ym);
    icones();
    return { csv: csv, nome: "relatorio-" + ym + (fid ? "-" + resultados[0].p.nome.split(" ")[0].toLowerCase() : "") + ".csv" };
  }

  async function montarFechamento(ym) {
    var info = await mesFechadoInfo(ym), box = $("rFech");
    var fim = diasDoMes(ym).pop(), terminou = fim < hoje();
    if (info) {
      box.innerHTML = '<div class="msg ok"><i data-lucide="lock"></i><div style="flex:1">Mês <b>fechado</b> em ' + dataBR(info.fechado_em) + (info.fechado_por ? " por " + esc(info.fechado_por) : "") + ". Ninguém consegue lançar ou corrigir ponto neste mês." +
        (perfil === "admin" ? ' <button class="btn sec sm" id="rReabrir" style="margin-left:8px">Reabrir mês</button>' : "") + "</div></div>";
      if ($("rReabrir")) $("rReabrir").addEventListener("click", async function () {
        var mot = window.prompt("Motivo para reabrir " + ym.split("-")[1] + "/" + ym.split("-")[0] + ":");
        if (!mot) return;
        var r = await db.rpc("reabrir_mes", { p_mes: ym + "-01", p_motivo: mot });
        if (r.error || !r.data || !r.data.ok) { toast((r.data && r.data.erro) || (r.error && r.error.message), true); return; }
        toast("Mês reaberto."); montarFechamento(ym);
      });
    } else if (perfil === "admin" && terminou) {
      box.innerHTML = '<div class="msg warn"><i data-lucide="unlock"></i><div style="flex:1">Este mês ainda está aberto. Depois de conferir e enviar à contabilidade, feche o mês para impedir alterações. <button class="btn sm" id="rFechar" style="margin-left:8px">Fechar mês</button></div></div>';
      $("rFechar").addEventListener("click", async function () {
        if (!confirm("Fechar o mês? Depois disso ninguém consegue lançar ou corrigir ponto nele, até o administrador reabrir.")) return;
        var r = await db.rpc("fechar_mes", { p_mes: ym + "-01" });
        if (r.error || !r.data || !r.data.ok) { toast((r.data && r.data.erro) || (r.error && r.error.message), true); return; }
        toast("Mês fechado."); montarFechamento(ym);
      });
    } else box.innerHTML = "";
    icones();
  }

  /* ---------- Calendário da equipe ---------- */
  async function telaCal() {
    var mes = hoje().slice(0, 7);
    $("main").innerHTML = pageHead("calendar-days", "Calendário da equipe", "Uma linha por pessoa, um dia por coluna. Passe o mouse sobre o dia para ver detalhes.") +
      '<div class="bar-tools"><input type="month" id="cM" value="' + mes + '"><button class="btn" id="cG"><i data-lucide="play"></i> Ver</button></div><div id="cOut"></div>';
    async function ver() {
      var ym = $("cM").value; if (!ym) return;
      $("cOut").innerHTML = '<div class="skel" style="height:200px"></div>';
      var dias = diasDoMes(ym), ini = dias[0], fim = dias[dias.length - 1];
      var f = await db.from("funcionarios").select("id,nome,cpf,cargo,admissao,ativo,desligamento").order("nome");
      if (f.error) throw f.error;
      var lista = f.data.filter(function (p) { return p.ativo || (p.desligamento && p.desligamento >= ini); });
      var dados = await carregarPeriodo(ini, fim);
      var dow = ["D", "S", "T", "Q", "Q", "S", "S"];
      var cab = "<tr><th class=\"nm\">Funcionário</th>" + dias.map(function (d) { return "<th title=\"" + dataBR(d) + "\">" + d.slice(8) + "<br><small>" + dow[Calc.diaSemana(d)] + "</small></th>"; }).join("") + "<th>Faltas</th></tr>";
      var corpo = lista.map(function (p) {
        var r = calcular(p, ini, fim, dados), m = {}; r.dias.forEach(function (x) { m[x.d] = x; });
        var cels = dias.map(function (d) {
          var x = m[d];
          if (!x) return '<td class="c-vz"></td>';
          var cl, tx;
          if (x.bd.length) {
            var comp = x.bd.some(function (b) { return b.tipo === "saida"; });
            cl = comp ? "c-ok" : "c-warn"; tx = comp ? "✓" : "…";
          } else if (x.obs === "Falta") { cl = "c-err"; tx = "F"; }
          else if (/abonado/.test(x.obs)) { cl = "c-abo"; tx = "A"; }
          else { cl = "c-off"; tx = ""; }
          return '<td class="' + cl + '" title="' + esc(dataBR(d) + (x.obs ? " · " + x.obs : "") + (x.trab ? " · " + hm(x.trab) : "")) + '">' + tx + "</td>";
        }).join("");
        return '<tr><td class="nm">' + esc(p.nome) + (p.ativo ? "" : ' <span class="tag off">desligado</span>') + "</td>" + cels + "<td><b>" + r.faltas + "</b></td></tr>";
      }).join("");
      $("cOut").innerHTML = '<div class="scroll cal"><table>' + cab + corpo + "</table></div>" +
        '<div class="legenda"><span class="c-ok">✓</span> Dia completo <span class="c-warn">…</span> Sem saída / em andamento <span class="c-err">F</span> Falta <span class="c-abo">A</span> Abonado (atestado, férias…) <span class="c-off"></span> Não útil / feriado</div>';
    }
    $("cG").addEventListener("click", ver);
    await ver();
  }

  /* ---------- Escalas ---------- */
  async function telaEsc() {
    var e = await db.from("escalas").select("id,nome,ativa").order("id");
    var v = await db.from("escala_versoes").select("*").order("vigencia_inicio", { ascending: false });
    var f = await db.from("funcionarios").select("id,escala_id").eq("ativo", true);
    if (e.error || v.error) throw (e.error || v.error);
    var arquivadas = e.data.filter(function (x) { return x.ativa === false; });
    var cards = e.data.filter(function (x) { return x.ativa !== false; }).map(function (x) {
      var vs = v.data.filter(function (y) { return y.escala_id === x.id; });
      var n = (f.data || []).filter(function (p) { return p.escala_id === x.id; }).length;
      var atual = vs.filter(function (y) { return y.vigencia_inicio <= hoje(); })[0] || vs[0];
      return '<div class="card" style="margin-bottom:14px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;flex:1">' + esc(x.nome) + '</h3><span class="tag blue">' + n + " funcionário(s)</span>" +
        (podeEditar() ? '<button class="btn sec sm" data-ev="' + x.id + '"><i data-lucide="clock"></i> Mudar horário</button> <button class="btn danger sm" data-er="' + x.id + '" data-nome="' + esc(x.nome) + '"><i data-lucide="trash-2"></i> Remover escala</button>' : "") + "</div>" +
        (atual ? '<p style="margin:8px 0">Horário atual: <b>' + atual.entrada.slice(0, 5) + " às " + atual.saida.slice(0, 5) + "</b></p>" : "") +
        (vs.length ? '<div class="scroll"><table><tr><th>A partir de</th><th>Entrada</th><th>Saída</th><th>Motivo</th></tr>' + vs.map(function (y) {
          return "<tr><td>" + dataBR(y.vigencia_inicio) + "</td><td>" + y.entrada.slice(0, 5) + "</td><td>" + y.saida.slice(0, 5) + "</td><td>" + esc(y.motivo || "") + "</td></tr>";
        }).join("") + "</table></div>" : "") + "</div>";
    }).join("");
    $("main").innerHTML = pageHead("calendar-clock", "Escalas", "Crie escalas, mude os horários e remova as que não usa mais. Cada mudança de horário vale a partir de uma data e o histórico fica guardado.",
        (podeEditar() ? '<button class="btn" id="eNova"><i data-lucide="plus"></i> Nova escala</button>' : "")) +
      (cards || vazio("calendar-clock", "Nenhuma escala cadastrada.")) +
      (arquivadas.length ? '<div class="card"><h3>Escalas removidas</h3><div class="sub">Ficam guardadas por causa do histórico. Dá para restaurar.</div>' + arquivadas.map(function (x) {
        return '<div style="display:flex;gap:10px;align-items:center;padding:6px 0"><span style="flex:1">' + esc(x.nome) + "</span>" + (podeEditar() ? '<button class="btn sec sm" data-rs="' + x.id + '">Restaurar</button>' : "") + "</div>";
      }).join("") + "</div>" : "");
    if ($("eNova")) $("eNova").addEventListener("click", formNovaEscala);
    $("main").querySelectorAll("[data-er]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Remover a escala " + b.getAttribute("data-nome") + "?\n\nO histórico continua guardado e dá para restaurar.")) return;
        var r = await db.rpc("arquivar_escala", { p_id: Number(b.getAttribute("data-er")) });
        if (r.error || !r.data || !r.data.ok) { toast((r.data && r.data.erro) || (r.error && r.error.message), true); return; }
        await recarregarEscalas(); ir("esc"); toast("Escala removida.");
      });
    });
    $("main").querySelectorAll("[data-rs]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var r = await db.rpc("reativar_escala", { p_id: Number(b.getAttribute("data-rs")) });
        if (r.error || !r.data || !r.data.ok) { toast((r.data && r.data.erro) || (r.error && r.error.message), true); return; }
        await recarregarEscalas(); ir("esc"); toast("Escala restaurada.");
      });
    });
    $("main").querySelectorAll("[data-ev]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = Number(b.getAttribute("data-ev"));
        modal("<h2>Mudar horário</h2>" +
          '<div class="row2"><div><label>Entrada</label><input type="time" id="vE" value="07:00"></div><div><label>Saída</label><input type="time" id="vS" value="17:00"></div></div>' +
          '<label>Vale a partir de</label><input type="date" id="vD" value="' + hoje() + '">' +
          '<label>Motivo (obrigatório)</label><input id="vM"><div id="vMsg"></div>' +
          '<div class="acts"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="vOk">Salvar</button></div>',
          function (root, fechar) {
            root.querySelector("#vOk").addEventListener("click", async function () {
              var m = root.querySelector("#vMsg"), en = root.querySelector("#vE").value, sa = root.querySelector("#vS").value, d = root.querySelector("#vD").value, mot = root.querySelector("#vM").value.trim();
              if (!en || !sa || !d || sa <= en) { m.innerHTML = msgHtml("Confira entrada, saída e data."); return; }
              if (mot.length < 3) { m.innerHTML = msgHtml("Informe o motivo."); return; }
              var r = await db.from("escala_versoes").insert({ escala_id: id, entrada: en, saida: sa, vigencia_inicio: d, motivo: mot });
              if (r.error) { m.innerHTML = msgHtml(r.error.message); return; }
              await db.from("auditoria").insert({ acao: "escala.versao", detalhe: { escala_id: id, entrada: en, saida: sa, desde: d } });
              fechar(); await recarregarEscalas(); ir("esc"); toast("Horário salvo.");
            });
          });
      });
    });
  }
  function formNovaEscala() {
    modal("<h2>Nova escala</h2>" +
      '<label>Nome</label><input id="nN" placeholder="Ex.: Meio período manhã">' +
      '<div class="row2"><div><label>Entrada</label><input type="time" id="nE" value="07:00"></div><div><label>Saída</label><input type="time" id="nS" value="16:00"></div></div>' +
      '<label>Vale a partir de</label><input type="date" id="nD" value="' + hoje() + '"><div id="nMsg"></div>' +
      '<div class="acts"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="nOk">Criar escala</button></div>',
      function (root, fechar) {
        root.querySelector("#nOk").addEventListener("click", async function () {
          var m = root.querySelector("#nMsg");
          this.disabled = true;
          var r = await db.rpc("criar_escala", { p_nome: root.querySelector("#nN").value, p_entrada: root.querySelector("#nE").value, p_saida: root.querySelector("#nS").value, p_inicio: root.querySelector("#nD").value || null });
          this.disabled = false;
          if (r.error || !r.data || !r.data.ok) { m.innerHTML = msgHtml((r.data && r.data.erro) || (r.error && r.error.message)); return; }
          fechar(); await recarregarEscalas(); ir("esc"); toast("Escala criada.");
        });
      });
  }
  async function recarregarEscalas() {
    var e = await db.from("escalas").select("id,nome,ativa").order("id");
    var v = await db.from("escala_versoes").select("escala_id,entrada,saida,vigencia_inicio").order("vigencia_inicio");
    escalas = (e.data || []).map(function (x) {
      var vs = (v.data || []).filter(function (y) { return y.escala_id === x.id && y.vigencia_inicio <= hoje(); });
      var ult = vs[vs.length - 1];
      return { id: x.id, nome: x.nome, ativa: x.ativa !== false, entrada: ult ? ult.entrada.slice(0, 5) : "", saida: ult ? ult.saida.slice(0, 5) : "" };
    });
  }

  /* ---------- Configurações ---------- */
  async function telaCfg() {
    var c = await db.from("configuracoes").select("*").eq("id", 1).maybeSingle();
    var fer = await db.from("feriados").select("*").order("data");
    var tr = perfil === "admin" ? await db.rpc("listar_terminais") : { data: [] };
    if (c.data) cfg = c.data;
    var dow = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"], uteis = cfg.dias_uteis || [1, 2, 3, 4, 5];
    var adm = perfil === "admin";
    var ub = adm ? await db.from("auditoria").select("momento").eq("acao", "backup.baixar").order("momento", { ascending: false }).limit(1) : { data: [] };
    var ultB = ub.data && ub.data[0] ? ub.data[0].momento : null;
    var diasB = ultB ? Math.floor((Date.now() - new Date(ultB).getTime()) / 864e5) : null;
    var avisoB = ultB ? (diasB > 7 ? '<div class="msg warn"><i data-lucide="alert-triangle"></i><div>O último backup foi há ' + diasB + " dias (" + dataBR(dataLocal(new Date(ultB).getTime())) + "). Baixe um novo.</div></div>" : '<div class="msg ok"><i data-lucide="check-circle"></i><div>Último backup: ' + dataBR(dataLocal(new Date(ultB).getTime())) + ".</div></div>")
      : '<div class="msg warn"><i data-lucide="alert-triangle"></i><div>Nenhum backup baixado ainda. Recomendado: baixar uma vez por semana.</div></div>';
    var terms = (tr.data || []).map(function (t) {
      return "<tr><td>" + esc(t.nome) + "</td><td>" + (t.ativo ? '<span class="tag ok">Ativo</span>' : '<span class="tag off">Desativado</span>') + "</td><td>" + (t.ultimo_uso ? dataBR(t.ultimo_uso) + " " + hora(t.ultimo_uso) : "nunca") + '</td><td class="act">' + (t.ativo ? '<button class="btn danger sm" data-td="' + t.id + '">Desativar</button>' : "") + "</td></tr>";
    }).join("");
    $("main").innerHTML = pageHead("settings", "Configurações", "Regras de cálculo, feriados, leitor de digital e backup.") +
      '<div class="card" style="margin-bottom:14px"><h3>Regras do ponto</h3>' +
      '<label>Tolerância diária (minutos)</label><input type="number" id="cTol" min="0" max="30" value="' + (cfg.tolerancia_min || 0) + '" style="max-width:140px">' +
      '<small class="muted">Diferenças de até esse tempo, para mais ou para menos, não geram hora extra nem devida.</small>' +
      '<label>Dias úteis</label><div class="dias">' + dow.map(function (n, i) { return '<label class="chk"><input type="checkbox" data-dw="' + i + '"' + (uteis.indexOf(i) >= 0 ? " checked" : "") + "> " + n + "</label>"; }).join(" ") + "</div>" +
      '<label class="chk" style="margin-top:12px"><input type="checkbox" id="cPin"' + (cfg.exigir_pin !== false ? " checked" : "") + "> Exigir PIN na recepção (recomendado)</label>" +
      '<div id="cMsg"></div>' + (podeEditar() ? '<div class="acts"><button class="btn" id="cSalvar">Salvar regras</button></div>' : "") + "</div>" +
      '<div class="card" style="margin-bottom:14px"><h3>Feriados e dias sem aula</h3><div class="sub">Dias que não contam como falta para ninguém.</div>' +
      (podeEditar() ? '<div class="bar-tools"><input type="date" id="fD"><input id="fDesc" placeholder="Descrição (ex.: Natal)" style="max-width:260px"><button class="btn" id="fAdd"><i data-lucide="plus"></i> Adicionar</button></div>' : "") +
      ((fer.data || []).length ? '<div class="scroll"><table><tr><th>Data</th><th>Descrição</th><th></th></tr>' + fer.data.map(function (x) {
        return "<tr><td>" + dataBR(x.data) + "</td><td>" + esc(x.descricao) + '</td><td class="act">' + (podeEditar() ? '<button class="btn danger sm" data-fd="' + esc(x.data) + '"><i data-lucide="trash-2"></i></button>' : "") + "</td></tr>";
      }).join("") + "</table></div>" : '<div class="empty">Nenhum feriado cadastrado.</div>') + "</div>" +
      (adm ? '<div class="card" style="margin-bottom:14px"><h3>Terminais (leitor de digital)</h3><div class="sub">Cada computador de recepção com leitor precisa de um código próprio. O código aparece uma única vez: cole-o em "Configurar terminal" na tela da recepção.</div>' +
        '<div class="bar-tools"><input id="tNome" placeholder="Nome (ex.: Recepção)" style="max-width:260px"><button class="btn" id="tAdd"><i data-lucide="plus"></i> Criar terminal</button></div>' +
        ((tr.data || []).length ? '<div class="scroll"><table><tr><th>Nome</th><th>Situação</th><th>Último uso</th><th></th></tr>' + terms + "</table></div>" : '<div class="empty">Nenhum terminal criado.</div>') + "</div>" +
        '<div class="card"><h3>Backup</h3><div class="sub">Baixa um arquivo com todos os dados (funcionários, batidas, ocorrências, escalas, feriados, auditoria). PINs e digitais nunca entram no backup.</div>' + avisoB + '<button class="btn sec" id="bkp"><i data-lucide="download"></i> Baixar backup agora</button></div>' : "");

    if ($("cSalvar")) $("cSalvar").addEventListener("click", async function () {
      var dias = []; $("main").querySelectorAll("[data-dw]").forEach(function (x) { if (x.checked) dias.push(Number(x.getAttribute("data-dw"))); });
      var tol = Number($("cTol").value);
      if (!(tol >= 0 && tol <= 30)) { $("cMsg").innerHTML = msgHtml("Tolerância entre 0 e 30 minutos."); return; }
      if (!dias.length) { $("cMsg").innerHTML = msgHtml("Marque ao menos um dia útil."); return; }
      var r = await db.from("configuracoes").update({ tolerancia_min: tol, dias_uteis: dias, exigir_pin: $("cPin").checked }).eq("id", 1);
      if (r.error) { $("cMsg").innerHTML = msgHtml(r.error.message); return; }
      await db.from("auditoria").insert({ acao: "configuracoes.alterar", detalhe: { tolerancia_min: tol, dias_uteis: dias, exigir_pin: $("cPin").checked } });
      cfg.tolerancia_min = tol; cfg.dias_uteis = dias; cfg.exigir_pin = $("cPin").checked;
      toast("Regras salvas.");
    });
    if ($("fAdd")) $("fAdd").addEventListener("click", async function () {
      var d = $("fD").value, t = $("fDesc").value.trim();
      if (!d || t.length < 2) { toast("Informe a data e a descrição.", true); return; }
      var r = await db.from("feriados").insert({ data: d, descricao: t });
      if (r.error) { toast(r.error.code === "23505" ? "Esse dia já está cadastrado." : r.error.message, true); return; }
      ir("cfg"); toast("Feriado adicionado.");
    });
    $("main").querySelectorAll("[data-fd]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Remover este feriado?")) return;
        var r = await db.from("feriados").delete().eq("data", b.getAttribute("data-fd"));
        if (r.error) { toast(r.error.message, true); return; }
        ir("cfg");
      });
    });
    if ($("tAdd")) $("tAdd").addEventListener("click", async function () {
      var r = await db.rpc("criar_terminal", { p_nome: $("tNome").value });
      if (r.error || !r.data || !r.data.ok) { toast((r.data && r.data.erro) || (r.error && r.error.message), true); return; }
      modal("<h2>Código do terminal</h2><p>Copie agora. Por segurança, <b>ele não será mostrado de novo</b>.</p>" +
        '<input id="tk" readonly value="' + esc(r.data.token) + '" style="font-family:monospace" onclick="this.select()">' +
        '<div class="acts"><button class="btn sec" id="tkC"><i data-lucide="copy"></i> Copiar</button><button class="btn" data-fechar>Já guardei</button></div>',
        function (root) {
          root.querySelector("#tkC").addEventListener("click", function () { var i = root.querySelector("#tk"); i.select(); try { navigator.clipboard.writeText(i.value); toast("Copiado."); } catch (e) { document.execCommand("copy"); } });
          var o = new MutationObserver(function () { if (!$("modalRoot").innerHTML) { o.disconnect(); ir("cfg"); } }); o.observe($("modalRoot"), { childList: true });
        });
    });
    $("main").querySelectorAll("[data-td]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Desativar este terminal? A digital deixa de funcionar nele.")) return;
        var r = await db.rpc("desativar_terminal", { p_id: Number(b.getAttribute("data-td")) });
        if (r.error || !r.data || !r.data.ok) { toast((r.data && r.data.erro) || (r.error && r.error.message), true); return; }
        ir("cfg");
      });
    });
    if ($("bkp")) $("bkp").addEventListener("click", async function () {
      this.disabled = true;
      try {
        var out = { gerado_em: new Date().toISOString(), escola: C.escola }, tabelas = ["funcionarios", "escalas", "escala_versoes", "alteracoes", "batidas", "batidas_invalidadas", "ocorrencias", "feriados", "configuracoes", "auditoria"];
        for (var i = 0; i < tabelas.length; i++) { out[tabelas[i]] = await buscarTudo(function () { return db.from(tabelas[i]).select("*"); }); }
        baixar("backup-ponto-" + hoje() + ".json", JSON.stringify(out, null, 1), "application/json");
        await db.from("auditoria").insert({ acao: "backup.baixar", detalhe: {} });
        toast("Backup baixado. Guarde em local seguro.");
      } catch (e) { toast("Falha no backup: " + (e.message || e), true); }
      this.disabled = false;
    });
  }

  iniciarSessao();
})();
