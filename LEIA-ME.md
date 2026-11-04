# Ponto Escolar — controle de jornada (modo Caique)

Site estático (HTML + CSS + JavaScript puro) + **Supabase** + **GitHub Pages**.
Sem Node, sem build, sem React: os arquivos ficam soltos na raiz do repositório.

> Troca em relação ao prompt original: React/Vite/Firebase foram substituídos pela
> mesma stack dos seus outros sistemas (checklist/OSD, horas extras, rifa).
> A arquitetura continua modular: cada arquivo tem uma responsabilidade.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `index.html` + `recepcao.js` | Tela da recepção: relógio, CPF, biometria, confirmação |
| `admin.html` + `admin.js` | Painel da direção (8 páginas) |
| `relatorios.js` | PDFs individual e consolidado (jsPDF) |
| `calc.js` | Regras: jornada 8h24, almoço flexível, extras, devidas, atrasos, faltas |
| `db.js` | Banco: Supabase **ou** modo demonstração (localStorage) |
| `bio.js` | Biometria: simulador hoje, ponte ZK9500 depois |
| `config.js` | **Único arquivo que você edita** (nome da escola, Supabase, biometria) |
| `style.css` | Visual azul-marinho / branco / cinza / verde / vermelho |
| `schema.sql` | Tabelas, segurança (RLS), funções da recepção e dados iniciais |

## ETAPA 1 — Testar no seu computador (modo demonstração)

1. Abra a pasta no VS Code e instale a extensão **Live Server**.
2. Botão direito em `index.html` → **Open with Live Server**.
3. Com `config.js` sem Supabase, o sistema roda em **modo demonstração** com 6 funcionários fictícios e 15 dias de batidas.
4. Painel: `admin.html` → qualquer e-mail, senha **demo**.
5. Para pegar um CPF de teste: abra o admin, F12 → Console → `DB.listar('funcionarios').then(console.table)`.

Roteiro de teste (não pule): registrar as 4 batidas de um funcionário → tentar uma 5ª (deve recusar) → bater duas vezes em menos de 1 min (deve recusar) → no admin, invalidar uma batida e lançar um ajuste → criar uma ocorrência e aprovar → alterar o horário de uma escala com data futura → gerar os dois PDFs.

## ETAPA 2 — Banco real (Supabase)

1. Crie o projeto no Supabase (plano free).
2. **SQL Editor** → cole todo o `schema.sql` → **Run**.
3. **Authentication → Users → Add user** (e-mail da direção, marque *Auto Confirm User*).
4. No SQL Editor, cadastre como admin:
   ```sql
   insert into public.admins (user_id, email, nome, perfil)
   select id, email, 'Direção', 'admin' from auth.users where email = 'direcao@suaescola.com.br';
   ```
   Outros perfis: `gestor` (cadastra, ajusta, aprova) e `consulta` (só vê e gera relatórios).
5. **Project Settings → API** → copie *Project URL* e *anon public* para o `config.js`.
6. **Authentication → Sign In / Providers**: desligue o cadastro público (*Allow new users to sign up*), para ninguém criar conta sozinho.

## ETAPA 3 — Publicar (GitHub Pages)

1. Repositório novo, arquivos na raiz → **Settings → Pages → Deploy from branch: main / root**.
2. Recepção: `https://SEU-USUARIO.github.io/REPO/` · Direção: `.../admin.html` (de qualquer computador).

## ETAPA 4 — Computador da recepção

- Atalho em modo quiosque (Chrome):
  `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk https://SEU-USUARIO.github.io/REPO/`
- Coloque o atalho na pasta Inicializar do Windows (`Win+R` → `shell:startup`).
- Ajuste `TERMINAL` no `config.js` se houver mais de um computador.

## ETAPA 5 — Biometria ZKTeco ZK9500 (ainda NÃO implementada)

Hoje existe só o **simulador** (`BIOMETRIA: "simulador"`), que deixa claro na tela que não é leitura real.
**A biometria real não foi testada e não deve ser considerada funcionando.**

Plano da prova de conceito, depois de comprar o leitor:
1. Baixar o **ZKFinger SDK** oficial para Windows (site da ZKTeco) e instalar o driver do ZK9500.
2. Criar a *ponte* local (sugestão: C#/.NET, que é como o SDK é distribuído) rodando como serviço no Windows e ouvindo **somente** `ws://127.0.0.1:8765`.
3. Protocolo que o `bio.js` já espera (JSON):
   - `{"acao":"cadastrar","cpf":"...","funcionario_id":1,"dedo":1}` → `{"ok":true}` ou `{"ok":false,"erro":"..."}`
   - `{"acao":"verificar","cpf":"..."}` → `{"ok":true}` se a digital bater com as do CPF
4. Trocar `BIOMETRIA` para `"zk9500"` e testar.

**LGPD:** os modelos da digital ficam só no computador da recepção, criptografados pela ponte (ex.: Windows DPAPI). O Supabase guarda apenas *quantas* digitais o funcionário tem. Colher consentimento por escrito dos funcionários antes do cadastro.

**Ponto de atenção de segurança:** hoje o navegador informa o método ao servidor. Na versão com leitor real, a ponte deve assinar a confirmação (ou chamar o Supabase ela mesma) para que ninguém consiga registrar ponto só com o CPF de outra pessoa. Enquanto isso não existir, a identificação por CPF depende da recepção estar à vista.

## Regras de negócio implementadas

- Jornada prevista = saída − entrada − 1h (padrão 8h24). Trabalhado = (saída almoço − entrada) + (saída − retorno).
- Almoço sem horário fixo; mostra a duração real e o retorno previsto (saída + 1h).
- Extras, devidas e saldo líquido sempre mostrados separadamente.
- Sequência obrigatória de 4 batidas; bloqueio de batida duplicada (< 1 min); hora sempre do servidor.
- Batidas, alterações, versões de escala e auditoria não podem ser editadas nem apagadas (trigger no banco). Correção = invalidar com motivo + batida de ajuste marcada.
- Mudanças de horário têm vigência (permanente ou temporária), horário anterior, motivo e responsável.
- Feriados, férias, afastamentos e abonos aprovados zeram o previsto do dia; abono parcial desconta minutos devidos.
- Tolerância configurável; opção de aplicar a regra da CLT art. 58 §1º.

## Backup

- Admin → Configurações → **Baixar backup completo** (JSON). Faça mensalmente e guarde fora do PC.
- O plano free do Supabase não tem backup automático diário garantido: o JSON mensal é obrigatório.

## Aviso legal

Sistema de **controle interno**. Não é REP-P homologado (Portaria MTP 671/2021). Para uso oficial seria preciso, entre outros: comprovante de registro ao trabalhador, arquivos AFD/AEJ, assinatura eletrônica e registro do programa no INPI.
