(function () {
  var C = window.CONFIG;
  var db = supabase.createClient(C.supabaseUrl, C.supabaseKey);
  var $ = function (id) { return document.getElementById(id); };
  var TZ = "America/Sao_Paulo";
  var NOMES = {
    entrada: "Entrada",
    almoco_saida: "Saída para o almoço",
    almoco_retorno: "Retorno do almoço",
    saida: "Saída"
  };
  var cpfAtual = "", proxima = null, timer = null;


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

  function icones() { try { if (window.lucide) lucide.createIcons(); } catch (e) {} }
  function mostrar(qual) {
    ["s1", "s2", "s3"].forEach(function (s) { $(s).classList.toggle("hidden", s !== qual); });
    icones();
  }

  function mascara(v) {
    v = v.replace(/\D/g, "").slice(0, 11);
    return v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  $("cpf").addEventListener("input", function () { this.value = mascara(this.value); });
  $("cpf").addEventListener("keydown", function (e) { if (e.key === "Enter") identificar(); });

  // teclado numérico na tela
  var pad = $("pad");
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "C"].forEach(function (k) {
    var b = document.createElement("button");
    b.type = "button"; b.textContent = k;
    b.addEventListener("click", function () {
      var el = $("cpf");
      if (k === "⌫") el.value = mascara(el.value.slice(0, -1));
      else if (k === "C") el.value = "";
      else el.value = mascara(el.value + k);
    });
    pad.appendChild(b);
  });

  function reiniciar() {
    clearTimeout(timer);
    cpfAtual = ""; proxima = null;
    $("cpf").value = "";
    mostrar("s1"); msg("");
  }

  function falha(e, ctx) {
    msg("Não foi possível falar com o sistema. Verifique a internet e tente de novo. Nada foi registrado.");
    try { db.rpc("ponto_log", { p_detalhe: ctx + ": " + (e && e.message ? e.message : String(e)), p_terminal: C.terminal }); } catch (x) {}
  }

  async function identificar() {
    var cpf = $("cpf").value.replace(/\D/g, "");
    if (cpf.length !== 11) { msg("Digite os 11 números do CPF."); return; }
    msg(""); $("ok").disabled = true;
    try {
      var r = await db.rpc("ponto_identificar", { p_cpf: cpf, p_terminal: C.terminal });
      if (r.error) throw r.error;
      var d = r.data;
      if (!d.ok) { msg(d.erro); return; }
      if (!d.proxima) { msg(d.nome + ", as 4 batidas de hoje já foram registradas.", "warn"); return; }
      cpfAtual = cpf; proxima = d.proxima;
      $("who").textContent = "Olá, " + d.nome + "!";
      $("next").textContent = "Registrar: " + (NOMES[d.proxima] || d.proxima) + " (batida " + (d.qtd + 1) + " de 4)";
      mostrar("s2");
      timer = setTimeout(reiniciar, 30000);
    } catch (e) { falha(e, "identificar"); }
    finally { $("ok").disabled = false; }
  }

  async function registrar() {
    $("confirm").disabled = true; msg("");
    try {
      var r = await db.rpc("ponto_registrar", { p_cpf: cpfAtual, p_tipo: proxima, p_metodo: "cpf", p_terminal: C.terminal });
      if (r.error) throw r.error;
      var d = r.data;
      if (!d.ok) { msg(d.erro); mostrar("s1"); cpfAtual = ""; return; }
      var hora = new Date(d.momento).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      $("done").textContent = (NOMES[d.tipo] || d.tipo) + " registrada";
      $("doneSub").textContent = d.nome + " · " + hora;
      mostrar("s3");
      timer = setTimeout(reiniciar, 5000);
    } catch (e) { falha(e, "registrar"); }
    finally { $("confirm").disabled = false; }
  }

  icones();
  $("ok").addEventListener("click", identificar);
  $("confirm").addEventListener("click", registrar);
  $("cancel").addEventListener("click", reiniciar);
})();
