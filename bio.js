/* Cliente do leitor de digital.
   O navegador não fala direto com o leitor USB: quem fala é um programa local (o "agente") no computador
   da recepção, que responde em HTTP no endereço de config.js (agente). O contrato está em BIOMETRIA.md. */
(function (root) {
  function criar(base) {
    base = String(base || "").replace(/\/$/, "");

    async function chamar(caminho, opcoes, limiteMs) {
      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); }, limiteMs || 4000);
      try {
        var r = await fetch(base + caminho, Object.assign({ signal: ctrl.signal, headers: { "Content-Type": "application/json" } }, opcoes || {}));
        var j = await r.json();
        return j;
      } catch (e) {
        return { ok: false, erro: "agente_indisponivel" };
      } finally { clearTimeout(t); }
    }

    return {
      // {conectado, leitor, templates}
      status: async function () {
        var j = await chamar("/status", null, 2000);
        return { conectado: !!(j && j.ok && j.conectado), leitor: (j && j.leitor) || "", templates: (j && j.templates) || 0, erro: j && j.erro };
      },
      // Envia ao agente as digitais cadastradas para a comparação 1:N
      enviarTemplates: function (lista) {
        return chamar("/templates", { method: "POST", body: JSON.stringify({ templates: lista || [] }) }, 20000);
      },
      // Cadastro: o agente pede 3 leituras do mesmo dedo e devolve o modelo (base64)
      cadastrar: function () {
        return chamar("/enroll", { method: "POST", body: "{}" }, 60000);
      },
      // Espera um dedo no leitor. {ok:true, id, score} ou {ok:false, erro}
      identificar: function (timeoutMs) {
        var ms = timeoutMs || 25000;
        return chamar("/identify", { method: "POST", body: JSON.stringify({ timeout_ms: ms }) }, ms + 5000);
      },
      cancelar: function () { return chamar("/cancel", { method: "POST", body: "{}" }, 2000); }
    };
  }
  root.Bio = { criar: criar };
})(typeof window !== "undefined" ? window : globalThis);
