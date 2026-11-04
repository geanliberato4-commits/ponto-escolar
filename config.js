/* ============================================================
   config.js — ÚNICO arquivo que você precisa editar para instalar
   ============================================================
   - Deixe SUPABASE_URL e SUPABASE_ANON_KEY vazios para rodar em
     MODO DEMONSTRAÇÃO (dados ficam só neste navegador).
   - Preencha com os dados do seu projeto Supabase
     (Project Settings > API) para usar o banco real.
   ============================================================ */
window.PONTO_CONFIG = {
  ESCOLA: "Creche Estação Criança",

  SUPABASE_URL: "https://fmcemmbaavgpcbuqytvs.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtY2VtbWJhYXZncGNidXF5dHZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3OTcwMzMsImV4cCI6MjEwOTM3MzAzM30.sm3nmTFUj4MZQNq28TlZhZg0mDzmGSKiumf0OFDGpeA", // chave pública: pode ficar no site, o RLS protege

  // "desligado" = só CPF | "simulador" = testes sem leitor | "zk9500" = ponte local real
  BIOMETRIA: "simulador",
  PONTE_BIO_URL: "ws://127.0.0.1:8765",

  TERMINAL: "RECEPCAO-01"  // nome do computador da recepção (aparece nos registros)
};
