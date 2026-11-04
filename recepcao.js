(function () {
  var C = window.CONFIG;
  var db = supabase.createClient(C.supabaseUrl, C.supabaseKey);
  var bio = Bio.criar(C.agente);
  var $ = function (id) { return document.getElementById(id); };
  var TZ = "America/Sao_Paulo";
  var NOMES = { entrada: "Entrada", almoco_saida: "Saída para o almoço", almoco_retorno: "Retorno do almoço", saida: "Saída" };
  var CHAVE = "ec_terminal_token";
  var etapa = "cpf";           // cpf -> pin -> confirmar
  var cpfAtual = "", pinAtual = "", proxima = null, timer = null;
  var tela = "s1", bioLigada = false, bioRodando = false, templatesTimer = null;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function icones() { try { if (window.lucide) lucide.createIcons(); } catch (e) {} }
  function lerToken() { try { return localStorage.getItem(CHAVE) || ""; } catch (e) { return ""; } }

  /* ---------- relógio ---------- */
  function relogio() {
    var d = new Date();
    $("clock").textContent = d.toLocaleTimeString("pt-BR", { timeZone: TZ });
    $("date").textContent = d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  relogio(); setInterval(relogio, 1000);

  function msg(t, tipo) {
    $("msg").innerHTML = "";
    if (!t) return;
    var d = document.createElement("div");
    d.className = "msg " + (tipo || "err");
    d.textContent = t;
    $("msg").appendChild(d);
  }
  function mostrar(qual) {
    tela = qual;
    ["s1", "s2", "s3"].forEach(function (s) { $(s).classList.toggle("hidden", s !== qual); });
    icones();
  }

  /* ---------- CPF e PIN ---------- */
  function mascara(v) {
    v = v.replace(/\D/g, "").slice(0, 11);
    return v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  function ajustar(valor) {
    var el = $("cpf");
    el.value = etapa === "pin" ? valor.replace(/\D/g, "").slice(0, 6) : mascara(valor);
  }
  $("cpf").addEventListener("input", function () { ajustar(this.value); });
  $("cpf").addEventListener("keydown", function (e) { if (e.key === "Enter") avancar(); });

  var pad = $("pad");
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "C"].forEach(function (k) {
    var b = document.createElement("button");
    b.type = "button"; b.textContent = k;
    b.addEventListener("click", function () {
      var el = $("cpf");
      if (k === "⌫") ajustar(el.value.slice(0, -1));
      else if (k === "C") el.value = "";
      else ajustar(el.value + k);
    });
    pad.appendChild(b);
  });

  function etapaCpf() {
    etapa = "cpf"; pinAtual = "";
    var el = $("cpf");
    el.type = "text"; el.value = ""; el.maxLength = 14; el.placeholder = "000.000.000-00";
    $("cpfLabel").textContent = "Digite o seu CPF";
    $("voltar").classList.add("hidden");
  }
  function etapaPin() {
    etapa = "pin";
    var el = $("cpf");
    el.type = "password"; el.value = ""; el.maxLength = 6; el.placeholder = "••••";
    $("cpfLabel").textContent = "Digite o seu PIN";
    $("voltar").classList.remove("hidden");
    el.focus();
  }

  function reiniciar() {
    clearTimeout(timer);
    cpfAtual = ""; proxima = null;
    etapaCpf(); mostrar("s1"); msg("");
  }

  function falha(e, ctx) {
    msg("Não foi possível falar com o sistema. Verifique a internet e tente de novo. Nada foi registrado.");
    try { db.rpc("ponto_log", { p_detalhe: ctx + ": " + (e && e.message ? e.message : String(e)), p_terminal: C.terminal }); } catch (x) {}
  }

  async function avancar() {
    msg("");
    if (etapa === "cpf") {
      var cpf = $("cpf").value.replace(/\D/g, "");
      if (cpf.length !== 11) { msg("Digite os 11 números do CPF."); return; }
      cpfAtual = cpf; etapaPin(); return;
    }
    var pin = $("cpf").value.replace(/\D/g, "");
    if (pin.length < 4) { msg("O PIN tem de 4 a 6 números."); return; }
    $("ok").disabled = true;
    try {
      var r = await db.rpc("ponto_identificar_pin", { p_cpf: cpfAtual, p_pin: pin, p_terminal: C.terminal });
      if (r.error) throw r.error;
      var d = r.data;
      if (!d.ok) { var e = d.erro; etapaCpf(); msg(e); return; }
      if (!d.proxima) { etapaCpf(); msg(d.nome + ", as 4 batidas de hoje já foram registradas.", "warn"); return; }
      pinAtual = pin; proxima = d.proxima;
      $("who").textContent = "Olá, " + d.nome + "!";
      $("next").textContent = "Registrar: " + (NOMES[d.proxima] || d.proxima) + " (batida " + (d.qtd + 1) + " de 4)";
      mostrar("s2");
      timer = setTimeout(reiniciar, 30000);
    } catch (e) { falha(e, "identificar"); }
    finally { $("ok").disabled = false; }
  }

  function sucesso(d) {
    var h = new Date(d.momento).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    $("done").textContent = (NOMES[d.tipo] || d.tipo) + " registrada";
    $("doneSub").textContent = d.nome + " · " + h;
    mostrar("s3");
    clearTimeout(timer);
    timer = setTimeout(reiniciar, 5000);
  }

  async function registrar() {
    $("confirm").disabled = true; msg("");
    try {
      var r = await db.rpc("ponto_registrar_pin", { p_cpf: cpfAtual, p_pin: pinAtual, p_tipo: proxima, p_terminal: C.terminal });
      if (r.error) throw r.error;
      if (!r.data.ok) { var e = r.data.erro; reiniciar(); msg(e); return; }
      pinAtual = ""; sucesso(r.data);
    } catch (e) { falha(e, "registrar"); }
    finally { $("confirm").disabled = false; }
  }

  /* ---------- biometria ---------- */
  function pill(estado) {
    var el = $("pill");
    var t = {
      nao_config: ["Leitor: não configurado", ""],
      procurando: ["Leitor: procurando…", ""],
      on: ["Leitor de digital: pronto", "ok"],
      off: ["Leitor: desconectado (use CPF e PIN)", "warn"],
      erro: ["Leitor: terminal não autorizado", "err"]
    }[estado];
    el.textContent = t[0]; el.className = "pill " + t[1];
    $("bioBox").classList.toggle("hidden", estado !== "on");
  }

  async function sincronizar() {
    var r = await db.rpc("bio_listar_templates", { p_token: lerToken() });
    if (r.error || !r.data || !r.data.ok) return false;
    var j = await bio.enviarTemplates(r.data.templates);
    return !!(j && j.ok);
  }

  async function iniciarBio() {
    if (!lerToken()) { pill("nao_config"); return; }
    pill("procurando");
    var st = await bio.status();
    if (!st.conectado) { pill("off"); setTimeout(iniciarBio, 15000); return; }
    var ok = await sincronizar();
    if (!ok) { pill("erro"); setTimeout(iniciarBio, 30000); return; }
    pill("on"); bioLigada = true;
    clearInterval(templatesTimer);
    templatesTimer = setInterval(sincronizar, 5 * 60 * 1000);
    laco();
  }

  async function laco() {
    if (bioRodando) return;
    bioRodando = true;
    while (bioLigada) {
      if (tela !== "s1") { await sleep(500); continue; }
      var r = await bio.identificar(25000);
      if (!bioLigada || tela !== "s1") continue;
      if (r.ok) { await registrarBio(r.id); continue; }
      if (r.erro === "nao_reconhecida") { msg("Digital não reconhecida. Tente de novo ou use CPF e PIN.", "warn"); await sleep(1500); msg(""); continue; }
      if (r.erro === "tempo_esgotado") continue;
      // leitor sumiu ou agente caiu
      bioLigada = false; pill("off"); setTimeout(iniciarBio, 10000);
    }
    bioRodando = false;
  }

  async function registrarBio(id) {
    try {
      var r = await db.rpc("ponto_registrar_bio", { p_funcionario_id: id, p_token: lerToken(), p_terminal: C.terminal });
      if (r.error) throw r.error;
      if (!r.data.ok) { msg(r.data.erro); setTimeout(function () { msg(""); }, 4000); return; }
      sucesso(r.data);
    } catch (e) { falha(e, "registrar_bio"); }
  }

  $("cfgTerminal").addEventListener("click", function (ev) {
    ev.preventDefault();
    var atual = lerToken();
    var t = window.prompt("Cole aqui o código do terminal (gerado no painel, em Configurações › Terminais).\nDeixe em branco para remover.", atual ? "(já configurado)" : "");
    if (t === null) return;
    t = t.trim();
    try {
      if (!t || t === "(já configurado)") { if (!t) localStorage.removeItem(CHAVE); }
      else localStorage.setItem(CHAVE, t);
    } catch (e) { msg("Este navegador não permite guardar a configuração."); return; }
    location.reload();
  });

  $("ok").addEventListener("click", avancar);
  $("voltar").addEventListener("click", function () { etapaCpf(); msg(""); });
  $("confirm").addEventListener("click", registrar);
  $("cancel").addEventListener("click", reiniciar);
  etapaCpf(); icones(); iniciarBio();
})();
