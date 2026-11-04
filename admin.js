(function () {
  var C = window.CONFIG;
  var db = supabase.createClient(C.supabaseUrl, C.supabaseKey);
  var $ = function (id) { return document.getElementById(id); };
  var TZ = "America/Sao_Paulo";
  var TIPOS = ["entrada", "almoco_saida", "almoco_retorno", "saida"];
  var NOMES = { entrada: "Entrada", almoco_saida: "Saída almoço", almoco_retorno: "Retorno almoço", saida: "Saída" };
  var perfil = null, meuEmail = "", escalas = [], cfg = { tolerancia_min: 5, dias_uteis: [1, 2, 3, 4, 5] };
  var aba = "dash";
  var mostrarDesligados = false;

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
    var e = await db.from("escalas").select("id,nome").order("id");
    var v = await db.from("escala_versoes").select("escala_id,entrada,saida,vigencia_inicio").order("vigencia_inicio");
    escalas = (e.data || []).map(function (x) {
      var vs = (v.data || []).filter(function (y) { return y.escala_id === x.id; });
      var ult = vs[vs.length - 1];
      return { id: x.id, nome: x.nome, entrada: ult ? ult.entrada.slice(0, 5) : "", saida: ult ? ult.saida.slice(0, 5) : "" };
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
    var f = { dash: telaDash, func: telaFunc, reg: telaReg, rel: telaRel }[t];
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

    var barras = dias.map(function (dt) {
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

    function kpi(ic, cor, valor, rot) { return '<div class="card kpi"><div class="ic ' + cor + '"><i data-lucide="' + ic + '"></i></div><div><b>' + valor + "</b><span>" + rot + "</span></div></div>"; }
    var aviso = hojeUtil ? "" : '<div class="msg warn"><i data-lucide="calendar-off"></i><div>Hoje não é dia útil' + (ferMap[d] ? " (" + esc(ferMap[d]) + ")" : "") + ": faltas e taxa de presença não são calculadas.</div></div>";
    $("main").innerHTML =
      pageHead("layout-dashboard", "Dashboard", "Situação do ponto hoje, " + dataBR(d) + ".") + aviso +
      '<div class="kpis">' +
      kpi("users", "blue", ativos, "Funcionários ativos") +
      kpi("user-check", "green", presentes, "Presentes hoje") +
      kpi("user-x", "red", semBatida, "Sem batida até agora") +
      kpi("alarm-clock", "amber", atrasos, "Atrasos hoje") +
      kpi("gauge", "navy", taxa, "Taxa de presença") +
      kpi("clock", "blue", batidasHoje, "Registros de ponto hoje") + "</div>" +
      (ativos ? '<div class="two"><div class="card"><h3>Frequência dos últimos 7 dias</h3><div class="sub">Funcionários ativos com ao menos uma batida no dia. Dias não úteis em cinza.</div><div class="chart">' + barras + '</div></div>' +
        '<div class="card"><h3>Últimos registros</h3><div class="sub">Batidas mais recentes da equipe.</div>' + ultHtml + "</div></div>"
        : vazio("users", "Nenhum funcionário ativo ainda. Vá em Funcionários › Novo funcionário."));
  }

  /* ---------- Funcionários ---------- */
  async function telaFunc() {
    var q = db.from("funcionarios").select("*").order("nome");
    if (!mostrarDesligados) q = q.eq("ativo", true);
    var r = await q;
    if (r.error) throw r.error;
    var linhas = r.data.map(function (p) {
      var e = escalas.filter(function (x) { return x.id === p.escala_id; })[0];
      var st = p.ativo ? '<span class="tag ok">Ativo</span>'
        : '<span class="tag off">Desligado' + (p.desligamento ? " em " + dataBR(p.desligamento) : "") + "</span>";
      var acoes = "";
      if (podeEditar()) {
        if (p.ativo) acoes += '<button class="btn sec sm" data-a="edit" data-id="' + p.id + '"><i data-lucide="pencil"></i> Editar</button> <button class="btn danger sm" data-a="rem" data-id="' + p.id + '"><i data-lucide="user-minus"></i> Remover</button>';
        else acoes += '<button class="btn sec sm" data-a="react" data-id="' + p.id + '"><i data-lucide="user-check"></i> Reativar</button>';
      }
      if (perfil === "admin") acoes += ' <button class="btn sec sm" data-a="del" data-id="' + p.id + '" title="Só funciona se nunca bateu ponto"><i data-lucide="trash-2"></i> Excluir cadastro</button>';
      return "<tr><td>" + esc(p.nome) + "</td><td>" + maskCpf(p.cpf) + "</td><td>" + esc(p.cargo || "") + "</td><td>" +
        esc(e ? e.nome + " (" + e.entrada + ")" : "") + "</td><td>" + st + (p.motivo_desligamento ? '<br><small class="muted">' + esc(p.motivo_desligamento) + "</small>" : "") + '</td><td class="act">' + acoes + "</td></tr>";
    }).join("");
    $("main").innerHTML =
      pageHead("users", "Funcionários", "Cadastro da equipe. Quem sai da escola é removido (desligado) e o histórico de ponto continua guardado.",
        (podeEditar() ? '<button class="btn" id="novo"><i data-lucide="user-plus"></i> Novo funcionário</button>' : "")) +
      '<div class="bar-tools"><div class="grow muted">' + r.data.length + (r.data.length === 1 ? " funcionário" : " funcionários") + '</div>' +
      '<label class="chk"><input type="checkbox" id="chkDes"' + (mostrarDesligados ? " checked" : "") + "> Mostrar desligados</label></div>" +
      (r.data.length ? '<div class="scroll"><table><tr><th>Nome</th><th>CPF</th><th>Cargo</th><th>Escala</th><th>Situação</th><th></th></tr>' + linhas + "</table></div>"
        : vazio("users", "Nenhum funcionário" + (mostrarDesligados ? "" : " ativo") + " por aqui."));
    $("chkDes").addEventListener("change", function () { mostrarDesligados = this.checked; ir("func"); });
    if ($("novo")) $("novo").addEventListener("click", function () { formFunc(null); });
    var porId = {}; r.data.forEach(function (p) { porId[p.id] = p; });
    $("main").querySelectorAll("[data-a]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = porId[b.getAttribute("data-id")], a = b.getAttribute("data-a");
        if (a === "edit") formFunc(p);
        if (a === "rem") formRemover(p);
        if (a === "react") reativar(p);
        if (a === "del") excluir(p);
      });
    });
  }

  function opcoesEscala(sel) {
    return escalas.map(function (e) {
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
      (novo ? "" : '<div id="boxMotivo" class="hidden"><label>Motivo da troca de escala (obrigatório)</label><input id="fMot"></div>') +
      '<div id="fMsg"></div><div class="acts"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="fSalvar">Salvar</button></div>',
      function (root, fechar) {
        var cpfEl = root.querySelector("#fCpf");
        cpfEl.addEventListener("input", function () { if (!cpfEl.disabled) cpfEl.value = maskCpf(cpfEl.value.replace(/\D/g, "").slice(0, 11)).replace(/[.-]$/, ""); });
        if (!novo) root.querySelector("#fEsc").addEventListener("change", function () {
          root.querySelector("#boxMotivo").classList.toggle("hidden", Number(this.value) === p.escala_id);
        });
        root.querySelector("#fSalvar").addEventListener("click", async function () {
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
          fechar(); ir("func"); toast(novo ? "Funcionário cadastrado." : "Alterações salvas.");
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
    var f = await db.from("funcionarios").select("id,nome").order("nome");
    var inv = await db.from("batidas_invalidadas").select("*");
    if (b.error || f.error) throw (b.error || f.error);
    var nomes = {}; f.data.forEach(function (x) { nomes[x.id] = x.nome; });
    var invMap = {}; (inv.data || []).forEach(function (i) { invMap[i.batida_id] = i; });
    var linhas = b.data.map(function (x) {
      var i = invMap[x.id];
      return "<tr" + (i ? ' style="opacity:.55"' : "") + "><td>" + esc(nomes[x.funcionario_id] || "?") + "</td><td>" + NOMES[x.tipo] + "</td><td>" + hora(x.momento) + "</td><td>" +
        (x.origem === "ajuste" ? '<span class="tag warn">Ajuste</span>' : '<span class="tag">Recepção</span>') + "</td><td>" +
        (i ? '<span class="tag err">Invalidada</span><br><small>' + esc(i.motivo) + "</small>" : (x.motivo ? "<small>" + esc(x.motivo) + "</small>" : "")) + '</td><td class="act">' +
        (podeEditar() && !i ? '<button class="btn sec sm" data-inv="' + x.id + '"><i data-lucide="ban"></i> Invalidar</button>' : "") + "</td></tr>";
    }).join("");
    $("main").innerHTML =
      pageHead("clock", "Registros de ponto", "Batidas de cada dia. Para corrigir, invalide a batida com motivo e lance um ajuste.",
        (podeEditar() ? '<button class="btn" id="rgAj"><i data-lucide="plus"></i> Lançar batida de ajuste</button>' : "")) +
      '<div class="bar-tools"><label class="chk" for="rgD"><i data-lucide="calendar"></i> Dia</label><input type="date" id="rgD" value="' + regData + '"></div>' +
      (b.data.length ? '<div class="scroll"><table><tr><th>Funcionário</th><th>Tipo</th><th>Hora</th><th>Origem</th><th>Observação</th><th></th></tr>' + linhas + "</table></div>"
        : vazio("clock", "Nenhuma batida em " + dataBR(regData) + "."));
    $("rgD").addEventListener("change", function () { regData = this.value || hoje(); ir("reg"); });
    if ($("rgAj")) $("rgAj").addEventListener("click", function () { formAjuste(f.data); });
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
  function formAjuste(funcs) {
    modal("<h2>Lançar batida de ajuste</h2>" +
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

  /* ---------- Relatórios ---------- */
  async function telaRel() {
    var f = await db.from("funcionarios").select("id,nome,cpf,cargo,admissao,ativo,desligamento").order("nome");
    if (f.error) throw f.error;
    var mes = hoje().slice(0, 7);
    $("main").innerHTML =
      pageHead("file-text", "Relatórios", "Horas trabalhadas, extras, devidas, faltas e saldo por mês, em PDF ou impressão.") +
      '<div class="bar-tools">' +
      '<input type="month" id="rM" value="' + mes + '">' +
      '<select id="rF" style="max-width:280px"><option value="0">Todos (consolidado)</option>' +
      f.data.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nome) + (x.ativo ? "" : " (desligado)") + "</option>"; }).join("") + "</select>" +
      '<button class="btn" id="rG"><i data-lucide="play"></i> Gerar</button><button class="btn sec hidden" id="rP"><i data-lucide="printer"></i> Imprimir / PDF</button></div>' +
      '<div id="rOut"></div>';
    $("rG").addEventListener("click", function () { gerar(f.data); });
    $("rP").addEventListener("click", function () { window.print(); });
  }

  function diasDoMes(ym) {
    var p = ym.split("-"), ano = Number(p[0]), m = Number(p[1]);
    var n = new Date(ano, m, 0).getDate(), out = [];
    for (var d = 1; d <= n; d++) out.push(ym + "-" + String(d).padStart(2, "0"));
    return out;
  }
  function minutosDia(m) {
    var t = {}; m.forEach(function (x) { t[x.tipo] = new Date(x.momento).getTime(); });
    var tot = 0;
    if (t.entrada && t.almoco_saida) tot += (t.almoco_saida - t.entrada) / 60000;
    if (t.almoco_retorno && t.saida) tot += (t.saida - t.almoco_retorno) / 60000;
    if (t.entrada && t.saida && !t.almoco_saida && !t.almoco_retorno) tot += (t.saida - t.entrada) / 60000;
    return tot;
  }

  async function gerar(funcs) {
    var ym = $("rM").value, fid = Number($("rF").value);
    if (!ym) return;
    $("rOut").innerHTML = '<div class="skel" style="height:160px"></div>';
    var dias = diasDoMes(ym), ini = dias[0], fim = dias[dias.length - 1];
    var bs = await buscarTudo(function () { return db.from("batidas").select("id,funcionario_id,tipo,data,momento").gte("data", ini).lte("data", fim).order("momento"); });
    var inv = await buscarTudo(function () { return db.from("batidas_invalidadas").select("batida_id"); });
    var fer = await db.from("feriados").select("data,descricao").gte("data", ini).lte("data", fim);
    var invSet = {}; inv.forEach(function (i) { invSet[i.batida_id] = 1; });
    var ferMap = {}; (fer.data || []).forEach(function (x) { ferMap[x.data] = x.descricao; });
    var h = hoje(), tol = cfg.tolerancia_min || 0, uteis = cfg.dias_uteis || [1, 2, 3, 4, 5];
    var lista = fid ? funcs.filter(function (x) { return x.id === fid; }) : funcs;

    var resultados = lista.map(function (p) {
      var meus = bs.filter(function (b) { return b.funcionario_id === p.id && !invSet[b.id]; });
      var res = { p: p, dias: [], trab: 0, extra: 0, dev: 0, faltas: 0, diasTrab: 0 };
      dias.forEach(function (d) {
        if (d > h) return;
        if (p.admissao && d < p.admissao) return;
        if (p.desligamento && d > p.desligamento) return;
        var dow = new Date(d + "T12:00:00").getDay();
        var util = uteis.indexOf(dow) >= 0 && !ferMap[d];
        var bd = meus.filter(function (b) { return b.data === d; });
        var trab = minutosDia(bd), completo = bd.some(function (x) { return x.tipo === "saida"; });
        var extra = 0, dev = 0, obs = ferMap[d] || (util ? "" : "Não útil");
        if (bd.length === 0) {
          if (util) { dev = C.jornadaMin; res.faltas++; obs = "Falta"; }
        } else {
          res.diasTrab++;
          if (!completo) { obs = d === h ? "Em andamento" : "Batidas incompletas"; }
          else {
            var diff = util ? trab - C.jornadaMin : trab;
            if (Math.abs(diff) <= tol && util) diff = 0;
            if (diff > 0) extra = diff; else dev = -diff;
          }
        }
        res.trab += trab; res.extra += extra; res.dev += dev;
        res.dias.push({ d: d, bd: bd, trab: trab, extra: extra, dev: dev, obs: obs });
      });
      return res;
    });

    var cab = '<div class="printonly"><img src="img/logo.png" alt=""><h2>Relatório de ponto — ' + esc(C.escola) + "</h2></div>";
    var html = cab + "<p class=\"muted\">Período: " + dataBR(ini) + " a " + dataBR(fim) + " · Jornada: " + hm(C.jornadaMin) + " · Tolerância: " + tol + " min</p>";
    if (!fid) {
      html += '<div class="scroll"><table><tr><th>Funcionário</th><th>Dias trabalhados</th><th>Horas trabalhadas</th><th>Extras</th><th>Devidas</th><th>Faltas</th><th>Saldo</th></tr>' +
        resultados.map(function (r) {
          var s = r.extra - r.dev;
          return "<tr><td>" + esc(r.p.nome) + (r.p.ativo ? "" : ' <span class="tag off">desligado</span>') + "</td><td>" + r.diasTrab + "</td><td>" + hm(r.trab) + "</td><td class=\"pos\">" + hm(r.extra) + "</td><td class=\"neg\">" + hm(r.dev) + "</td><td>" + r.faltas + "</td><td class=\"" + (s < 0 ? "neg" : "pos") + "\">" + hm(s) + "</td></tr>";
        }).join("") + "</table></div>";
    } else {
      var r = resultados[0], s = r.extra - r.dev;
      html += "<h3>" + esc(r.p.nome) + " <small class=\"muted\">CPF " + maskCpf(r.p.cpf) + (r.p.cargo ? " · " + esc(r.p.cargo) : "") + "</small></h3>" +
        '<div class="scroll"><table><tr><th>Data</th><th>Entrada</th><th>Saída almoço</th><th>Retorno</th><th>Saída</th><th>Trabalhado</th><th>Extra</th><th>Devido</th><th>Obs.</th></tr>' +
        r.dias.map(function (x) {
          var m = {}; x.bd.forEach(function (b) { m[b.tipo] = b.momento; });
          return "<tr><td>" + dataBR(x.d) + "</td>" + TIPOS.map(function (t) { return "<td>" + (m[t] ? hora(m[t]) : "") + "</td>"; }).join("") +
            "<td>" + (x.trab ? hm(x.trab) : "") + "</td><td class=\"pos\">" + (x.extra ? hm(x.extra) : "") + "</td><td class=\"neg\">" + (x.dev ? hm(x.dev) : "") + "</td><td>" + esc(x.obs) + "</td></tr>";
        }).join("") + "</table></div>" +
        '<p><b>Totais:</b> trabalhadas ' + hm(r.trab) + " · extras " + hm(r.extra) + " · devidas " + hm(r.dev) + " · faltas " + r.faltas + " · <b>saldo " + hm(s) + "</b></p>";
    }
    html += '<p class="muted" style="font-size:.8rem">Controle interno, não é registro de ponto homologado (Portaria MTP 671/2021). Ocorrências e abonos ainda não são considerados neste cálculo.</p>';
    $("rOut").innerHTML = html;
    $("rP").classList.remove("hidden");
    icones();
  }

  iniciarSessao();
})();
