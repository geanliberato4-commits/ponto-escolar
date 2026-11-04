# Ponto Escolar — Creche Estação Criança

Site estático (HTML/CSS/JavaScript puro, sem build) ligado a um projeto Supabase.

- `index.html` + `recepcao.js`: recepção, o funcionário digita o CPF e bate o ponto.
- `admin.html` + `admin.js`: painel da direção (Dashboard, Funcionários, Registros, Relatórios).
- `config.js`: nome da escola, URL e chave pública do Supabase.
- `style.css`: visual.

## Funcionário desligado
No painel, em Funcionários, o botão **Remover** desliga a pessoa (ela deixa de bater ponto) e mantém todo o histórico.
**Mostrar desligados › Reativar** desfaz. **Excluir cadastro** (só admin) só funciona se a pessoa nunca bateu ponto.

## Regras
Jornada de 8h24; 4 batidas por dia em sequência; batidas não são editadas nem apagadas (invalide com motivo e lance um ajuste).
Controle interno, não é registro de ponto homologado (Portaria MTP 671/2021).
