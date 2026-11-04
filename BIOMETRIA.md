# Leitor de digital (Nitgen Fingkey Hamster DX, USB)

O navegador não consegue falar com um leitor USB. Por isso o sistema usa um **programa local ("agente")**
no computador da recepção. O site já está pronto para conversar com ele; falta só o agente, que depende do
leitor e do SDK da Nitgen (eNBioBSP) em mãos para ser escrito e testado.
O contrato abaixo vale para qualquer marca: trocar de leitor só muda o agente, não o site.

## Como funciona
1. Painel › Configurações › Terminais: criar o terminal e copiar o código (aparece uma única vez).
2. Na recepção, clicar em "Configurar terminal" e colar o código.
3. Painel › Funcionários › Digital: o agente captura 3 leituras e o site guarda o modelo no banco.
4. Na recepção, o site envia os modelos ao agente, que compara (1:N) e devolve o `id` do funcionário.
   O site então registra a batida (`ponto_registrar_bio`). Se o leitor falhar, CPF + PIN continua funcionando.

## Contrato do agente (HTTP em `http://127.0.0.1:8765`, ver `config.js` › `agente`)
Todas as respostas são JSON. Precisa de CORS (`Access-Control-Allow-Origin` para o site) e do cabeçalho
`Access-Control-Allow-Private-Network: true` nas respostas de preflight.

| Rota | Corpo | Resposta |
|---|---|---|
| GET `/status` | – | `{ok:true, conectado:true, leitor:"ZK9500", templates:N}` |
| POST `/enroll` | `{}` | `{ok:true, template:"<base64>"}` após 3 leituras do mesmo dedo; ou `{ok:false, erro}` |
| POST `/templates` | `{templates:[{funcionario_id, template}]}` | `{ok:true}` (guarda só em memória) |
| POST `/identify` | `{timeout_ms}` | `{ok:true, id, score}` · `{ok:false, erro:"nao_reconhecida"}` · `{ok:false, erro:"tempo_esgotado"}` |
| POST `/cancel` | `{}` | `{ok:true}` |

## Segurança e LGPD
- O código do terminal fica só no navegador da recepção; o banco guarda apenas o hash.
- Digitais são dado sensível: ficam fora do backup, só são lidas com o código do terminal e são apagadas ao desligar alguém
  (rode `sql/pendente-digitais.sql` uma vez no Supabase).
- Obter consentimento por escrito de cada funcionário para uso da digital.
