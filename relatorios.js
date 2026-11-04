/* ============================================================
   relatorios.js — geração dos PDFs (jsPDF + AutoTable)
   ============================================================ */
const Relatorios = (function () {
  const cfg = window.PONTO_CONFIG;
  const NAVY = [11, 37, 69], VERDE = [22, 163, 74], VERM = [220, 38, 38], CINZA = [100, 116, 139];
  const t = s => String(s ?? '').replace(/[—–]/g, '-').replace(/[✓✔]/g, '');

  function novo() {
    if (!window.jspdf) throw new Error('Biblioteca de PDF não carregou (verifique a internet).');
    return new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  }
  function cabecalho(doc, titulo, sub) {
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, 20, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text(t(cfg.ESCOLA), 12, 9.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    doc.text(t(titulo), 12, 15.5);
    doc.text(t(sub), W - 12, 15.5, { align: 'right' });
    doc.setTextColor(30);
  }
  function rodapes(doc) {
    const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const quando = new Date().toLocaleString('pt-BR', { timeZone: TZ });
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(7); doc.setTextColor(...CINZA);
      doc.text(t(`Controle interno de jornada. Não constitui registro de ponto homologado (Portaria MTP 671/2021). Gerado em ${quando}.`), 12, H - 6);
      doc.text(`Página ${i} de ${n}`, W - 12, H - 6, { align: 'right' });
    }
  }
  function corSaldo(data, colExtra, colDev, colSaldo) {
    if (data.section !== 'body' && data.section !== 'foot') return;
    if (data.column.index === colExtra && data.cell.raw && data.cell.raw !== '0h00' && data.cell.raw !== '-') data.cell.styles.textColor = VERDE;
    if (data.column.index === colDev && data.cell.raw && data.cell.raw !== '0h00' && data.cell.raw !== '-') data.cell.styles.textColor = VERM;
    if (colSaldo != null && data.column.index === colSaldo) {
      const r = String(data.cell.raw);
      data.cell.styles.textColor = r.startsWith('+') ? VERDE : r.startsWith('-') ? VERM : [30, 30, 30];
      data.cell.styles.fontStyle = 'bold';
    }
  }
  const estilo = { styles: { fontSize: 8, cellPadding: 1.6, lineColor: [226, 232, 240], lineWidth: 0.1 }, headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [246, 248, 251] }, margin: { left: 12, right: 12, bottom: 14 } };

  async function dados(ini, fim) {
    const A = window.ADM;
    const g = A.agrupar(await A.batidasPeriodo(ini, fim));
    return { A, g };
  }

  function secaoIndividual(doc, A, per, ini, fim, primeira) {
    if (!primeira) doc.addPage();
    const f = per.func, S = A.S;
    cabecalho(doc, 'Espelho de ponto individual', `Período: ${fmtData(ini)} a ${fmtData(fim)}`);
    const hr = resolverHorario(f, fim < hojeLocal() ? fim : hojeLocal(), S);
    doc.setFontSize(9);
    const info = [['Funcionário', f.nome], ['CPF', mascaraCPF(f.cpf)], ['Cargo', f.cargo || '-'], ['Escala', hr.rotulo], ['Admissão', fmtData(f.admissao)]];
    let x = 12;
    info.forEach(([k, v], i) => {
      const w = [78, 40, 60, 62, 30][i];
      doc.setTextColor(...CINZA); doc.setFont('helvetica', 'normal'); doc.text(k.toUpperCase(), x, 27);
      doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.text(t(v), x, 32);
      x += w;
    });
    const hm = (d, tipo) => {
      const b = d.todas.filter(b => b.tipo === tipo && !b.invalidada).sort((a, c) => a.momento < c.momento ? -1 : 1)[0];
      return b ? partesLocais(b.momento).hora + (b.origem === 'ajuste' ? '*' : '') : '-';
    };
    const corpo = per.dias.filter(d => d.status !== 'futuro').map(d => [
      fmtData(d.data), DIAS_SEMANA[diaSemana(d.data)],
      hm(d, 'entrada'), hm(d, 'almoco_saida'), hm(d, 'almoco_retorno'), hm(d, 'saida'),
      d.todas.length ? dur(d.trabalhado) : '-', d.prevista ? dur(d.prevista) : '-',
      d.extra ? dur(d.extra) : '-', d.devida ? dur(d.devida) : '-',
      t(d.flags.map(x => x.txt).join('; ') || (['andamento', 'aguardando'].includes(d.status) ? STATUS_LABEL[d.status] : (d.prevista ? '' : 'Sem expediente')))
    ]);
    doc.autoTable({
      ...estilo, startY: 37,
      head: [['Data', 'Dia', 'Entrada', 'Saída alm.', 'Retorno', 'Saída', 'Trabalhado', 'Previsto', 'Extra', 'Devida', 'Ocorrências']],
      body: corpo,
      columnStyles: { 10: { cellWidth: 78 } },
      didParseCell: dd => corSaldo(dd, 8, 9, null)
    });
    let y = doc.lastAutoTable.finalY + 6;
    const H = doc.internal.pageSize.getHeight();
    if (y > H - 60) { doc.addPage(); cabecalho(doc, 'Espelho de ponto individual (continuação)', f.nome); y = 28; }
    const caixas = [['Horas trabalhadas', dur(per.trabalhado), [30, 41, 59]], ['Horas extras', dur(per.extra), VERDE], ['Horas devidas', dur(per.devida), VERM], ['Saldo líquido', durSaldo(per.saldo), per.saldo >= 0 ? VERDE : VERM]];
    caixas.forEach(([k, v, c], i) => {
      const bx = 12 + i * 66;
      doc.setDrawColor(226, 232, 240); doc.roundedRect(bx, y, 62, 16, 2, 2);
      doc.setFontSize(8); doc.setTextColor(...CINZA); doc.setFont('helvetica', 'normal'); doc.text(k.toUpperCase(), bx + 4, y + 5.5);
      doc.setFontSize(14); doc.setTextColor(...c); doc.setFont('helvetica', 'bold'); doc.text(v, bx + 4, y + 13);
    });
    y += 22;
    const faltas = per.dias.filter(d => d.status === 'falta').map(d => [fmtData(d.data), 'Falta', 'Sem registro de ponto', '-']);
    const ocs = A.S.ocorrencias.filter(o => o.funcionario_id == f.id && o.data_inicio <= fim && (o.data_fim || o.data_inicio) >= ini)
      .map(o => [fmtData(o.data_inicio) + (o.data_fim && o.data_fim !== o.data_inicio ? ' a ' + fmtData(o.data_fim) : ''), OCORRENCIA_TIPOS[o.tipo] || o.tipo, o.descricao || '', o.status]);
    doc.setFontSize(10); doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.text('Faltas e justificativas', 12, y);
    doc.autoTable({ ...estilo, startY: y + 2, head: [['Data', 'Tipo', 'Descrição', 'Situação']], body: [...faltas, ...ocs].map(r => r.map(t)), columnStyles: { 2: { cellWidth: 140 } } });
    if (![...faltas, ...ocs].length) { doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.text('Nenhuma no período.', 12, doc.lastAutoTable.finalY + 5); }
    y = doc.lastAutoTable.finalY + 18;
    if (y > H - 22) { doc.addPage(); y = 40; }
    doc.setDrawColor(120); doc.setFontSize(8.5); doc.setTextColor(60); doc.setFont('helvetica', 'normal');
    doc.line(20, y, 110, y); doc.text('Funcionário', 65, y + 4, { align: 'center' });
    doc.line(180, y, 270, y); doc.text('Direção', 225, y + 4, { align: 'center' });
    doc.setFontSize(7); doc.text('* batida lançada por ajuste administrativo', 12, y + 10);
  }

  async function individual(ini, fim, fid) {
    const { A, g } = await dados(ini, fim);
    const lista = fid ? [A.S.funcionarios.find(f => f.id == fid)] : A.S.funcionarios.filter(f => f.ativo);
    if (!lista.length || !lista[0]) throw new Error('Nenhum funcionário para o relatório.');
    const doc = novo();
    lista.forEach((f, i) => secaoIndividual(doc, A, A.calcPeriodo(f, ini, fim, g), ini, fim, i === 0));
    rodapes(doc);
    const nome = fid ? lista[0].nome.split(' ')[0].toLowerCase() : 'todos';
    doc.save(`ponto-individual-${nome}-${ini.slice(0, 7)}.pdf`);
    A.auditar('relatorio.individual', { ini, fim, funcionario_id: fid || 'todos' });
  }

  async function geral(ini, fim) {
    const { A, g } = await dados(ini, fim);
    const pers = A.S.funcionarios.filter(f => f.ativo).map(f => A.calcPeriodo(f, ini, fim, g));
    if (!pers.length) throw new Error('Nenhum funcionário ativo.');
    const doc = novo();
    cabecalho(doc, 'Relatório geral consolidado · banco de horas', `Período: ${fmtData(ini)} a ${fmtData(fim)}`);
    const conta = (p, tp) => p.dias.reduce((n, d) => n + d.flags.filter(x => x.t === tp).length, 0);
    const T = pers.reduce((a, p) => ({ tr: a.tr + p.trabalhado, pr: a.pr + p.prevista, ex: a.ex + p.extra, de: a.de + p.devida }), { tr: 0, pr: 0, ex: 0, de: 0 });
    const hoje = fim < hojeLocal() ? fim : hojeLocal();
    doc.autoTable({
      ...estilo, startY: 27, styles: { ...estilo.styles, fontSize: 8.5, cellPadding: 2 },
      head: [['Funcionário', 'CPF', 'Cargo', 'Escala', 'Trabalhado', 'Previsto', 'Horas extras', 'Horas devidas', 'Saldo líquido', 'Faltas', 'Atrasos']],
      body: pers.map(p => [p.func.nome, mascaraCPF(p.func.cpf), p.func.cargo || '', resolverHorario(p.func, hoje, A.S).rotulo, dur(p.trabalhado), dur(p.prevista), dur(p.extra), dur(p.devida), durSaldo(p.saldo), conta(p, 'falta'), conta(p, 'atraso')].map(t)),
      foot: [['TOTAL', '', '', '', dur(T.tr), dur(T.pr), dur(T.ex), dur(T.de), durSaldo(T.ex - T.de), '', '']],
      footStyles: { fillColor: [232, 237, 245], textColor: 20, fontStyle: 'bold' },
      didParseCell: dd => corSaldo(dd, 6, 7, 8)
    });
    rodapes(doc);
    doc.save(`ponto-consolidado-${ini.slice(0, 7)}.pdf`);
    A.auditar('relatorio.geral', { ini, fim });
  }

  return { individual, geral };
})();
