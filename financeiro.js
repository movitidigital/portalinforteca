/* ============================================================
   MÓDULO FINANCEIRO — Conciliação TIM + Espelho + Políticas
   ============================================================ */

const finState = {
  conciliacao: { mes: new Date().toISOString().slice(0,7), arquivo: null, resumo: null, linhas: [] },
  espelho:     { competencia: new Date().toISOString().slice(0,7), dados: null, itens: [], metaInfo: null, vendedor: null },
  politicas:   { lista: [] }
};

/* ============================================================
   POLÍTICAS DE COMISSÃO — leitura com cache + resolução de tier
   ============================================================ */

const _politicasCache = {
  mapa: null,
  carregadoEm: 0,
  TTL_MS: 5 * 60 * 1000
};

async function obterPoliticas() {
  const agora = Date.now();
  const expirado = (agora - _politicasCache.carregadoEm) > _politicasCache.TTL_MS;

  if (!_politicasCache.mapa || expirado) {
    const hoje = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabaseClient
      .from('financeiro_politicas_b2c')
      .select('categoria, faixa_atingimento, fator_remuneracao, vigencia_inicio, vigencia_fim')
      .lte('vigencia_inicio', hoje)
      .or(`vigencia_fim.is.null,vigencia_fim.gte.${hoje}`)
      .order('categoria')
      .order('faixa_atingimento')
      .order('vigencia_inicio', { ascending: false });

    if (error) {
      console.error('[Políticas] Falha ao carregar:', error);
      return {};
    }

    const mapa = {};
    for (const p of (data || [])) {
      if (!mapa[p.categoria]) mapa[p.categoria] = {};
      if (mapa[p.categoria][p.faixa_atingimento] == null) {
        mapa[p.categoria][p.faixa_atingimento] = Number(p.fator_remuneracao);
      }
    }

    _politicasCache.mapa = mapa;
    _politicasCache.carregadoEm = agora;
    finState.politicas.lista = data || [];
  }

  return _politicasCache.mapa;
}

function invalidarCachePoliticas() {
  _politicasCache.mapa = null;
  _politicasCache.carregadoEm = 0;
}

function resolverTier(metaInfo) {
  if (metaInfo?.bateuLoja)    return 'META_LOJA';
  if (metaInfo?.bateuPessoal) return 'META_PESSOAL';
  return 'ATIVOU_GANHOU';
}

function resolverFator(mapaPoliticas, categoria, tier) {
  const fator = mapaPoliticas?.[categoria]?.[tier];
  if (fator == null) return 0;
  return fator;
}

/* ============================================================
   HELPERS DE DATA
   ============================================================ */

function fmtMes(iso) {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${meses[+m - 1]}/${y}`;
}

function fmtMesExtenso(iso) {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${meses[+m - 1]} / ${y}`;
}

function formatarMesMeta(competencia) {
  const [y, m] = competencia.split('-');
  const meses = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  return `${meses[+m - 1]}/${y}`;
}

/* ============================================================
   CONCILIAÇÃO TIM
   ============================================================ */

function inicializarConciliacao() {
  const inputMes = document.getElementById('concMes');
  if (inputMes) {
    const mesAtual = new Date().toISOString().slice(0, 7);
    if (!inputMes.value) inputMes.value = mesAtual;
    finState.conciliacao.mes = inputMes.value;

    if (!inputMes._binded) {
      inputMes._binded = true;
      inputMes.addEventListener('change', (e) => {
        finState.conciliacao.mes = e.target.value;
        carregarConciliacaoExistente();
      });
    }
  }

  const drop = document.getElementById('concDrop');
  if (drop && !drop._binded) {
    drop._binded = true;
    drop.addEventListener('dragover', e => e.preventDefault());
    drop.addEventListener('drop', e => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) processarArquivoTim(file);
    });
    drop.addEventListener('click', () => {
      document.getElementById('concFileInput').click();
    });
  }

  carregarConciliacaoExistente();
}

async function carregarConciliacaoExistente() {
  const mes = document.getElementById('concMes').value;
  if (!mes) return;

  const drop = document.getElementById('concDrop');
  const cards = document.getElementById('concCards');
  const status = document.getElementById('concStatus');

  const { data: linhas, error } = await supabaseClient
    .from('financeiro_conciliacao_tim')
    .select('*')
    .eq('mes_competencia', `${mes}-01`)
    .order('status_conciliacao');

  if (error) {
    console.error('[Conciliação] Erro ao carregar:', error);
    return;
  }

  if (!linhas || linhas.length === 0) {
    drop.style.display = 'block';
    cards.style.display = 'none';
    status.innerHTML = '';
    return;
  }

  const matches = linhas.filter(l => l.status_conciliacao === 'MATCH_PERFEITO').length;
  const estornos = linhas.filter(l => l.status_conciliacao === 'DIVERGENCIA_VALOR').length;
  const glosas = linhas.filter(l => l.status_conciliacao === 'GLOSADO' || l.status_conciliacao === 'NAO_ENCONTRADO_SISTEMA').length;
  const totalPago = linhas.reduce((s, l) => s + (parseFloat(l.tim_valor_pago) || 0), 0);

  finState.conciliacao.mes = mes;
  finState.conciliacao.resumo = {
    processado: linhas.length,
    match: matches,
    divergencia: estornos,
    glosas: glosas,
    totalPago: totalPago
  };

  const ids = [...new Set(linhas.filter(l => l.interacao_id).map(l => l.interacao_id))];
  const mapaVend = {};
  if (ids.length) {
    const { data: inter } = await supabaseClient
      .from('interacoes').select('id, vendedor').in('id', ids);
    (inter || []).forEach(i => { mapaVend[i.id] = i.vendedor; });
  }

  finState.conciliacao.linhas = linhas.map(d => {
    let tag = 'OK';
    if (d.status_conciliacao === 'GLOSADO' || d.status_conciliacao === 'NAO_ENCONTRADO_SISTEMA') tag = 'RETIDO';
    if (d.status_conciliacao === 'DIVERGENCIA_VALOR') tag = 'ESTORNO';
    return {
      id: d.id,
      consultor: d.interacao_id ? (mapaVend[d.interacao_id] || '—') : 'Não Encontrado',
      gsm: d.tim_gsm || '—',
      plano: d.tim_plano_oferta || '—',
      pago: parseFloat(d.tim_valor_pago || 0),
      tipo: d.tim_motivo_glosa || 'PAGO',
      auditoria: tag
    };
  });

  drop.style.display = 'none';
  cards.style.display = 'block';

  renderizarResultadoConciliacao();
}

async function processarArquivoTim(file) {
  const status = document.getElementById('concStatus');

  status.innerHTML = `<div class="flex items-center gap-3 text-indigo-600 font-bold">
    <svg class="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/>
      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
    Processando ${file.name}...
  </div>`;

  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });

    if (!linhas.length) throw new Error('Planilha vazia');

    const convertDate = (v) => {
      if (!v) return null;
      const s = String(v).trim();
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      return null;
    };

    const parseMoney = (v) => {
      if (v == null || v === '') return 0;
      if (typeof v === 'number') return v;
      let s = String(v).trim().replace(/[R$\s]/g, '');
      if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else if (s.includes(',')) {
        s = s.replace(',', '.');
      }
      return parseFloat(s) || 0;
    };

    const get = (l, ...keys) => {
      for (const k of keys) {
        if (l[k] != null && String(l[k]).trim() !== '') return l[k];
      }
      return null;
    };

    const payload = linhas
      .map(l => {
        const gsmRaw = get(l, 'gsm', 'GSM', 'telefone', 'Telefone');
        const gsm = gsmRaw ? String(gsmRaw).trim() : '';
        return {
          gsm,
          cpf: String(get(l, 'cpf_cnpjcliente', 'CPF', 'cpf') || '').trim(),
          plano: String(get(l, 'plano', 'Plano') || '').trim(),
          dt_ativacao: convertDate(get(l, 'dt_ativacao', 'Data Ativação')),
          valor_pago: parseMoney(get(l, 'valorpagar', 'ValorPagar', 'valor_pago')),
          motivo_glosa: String(get(l, 'desc_tipocomissao', 'tipocomissao') || 'PAGO').trim()
        };
      })
      .filter(l => l.gsm);

    if (!payload.length) throw new Error('Nenhuma linha com GSM válido encontrada');

    const mes = document.getElementById('concMes').value;
    finState.conciliacao.mes = mes;

    const { data: rpc, error: rpcErr } = await supabaseClient.rpc('processar_conciliacao_tim', {
      p_mes_competencia: `${mes}-01`,
      p_dados_espelho: payload
    });
    if (rpcErr) throw rpcErr;

    finState.conciliacao.resumo = {
      processado: rpc.linhas_processadas || 0,
      match:      rpc.matches_perfeitos || 0,
      divergencia: rpc.divergencias || 0,
      glosas:     (rpc.glosas || 0) + (rpc.nao_encontrados || 0),
      totalPago:  rpc.total_pago || 0
    };

    const { data: detalhes } = await supabaseClient
      .from('financeiro_conciliacao_tim')
      .select('id, tim_gsm, tim_valor_pago, tim_plano_oferta, tim_motivo_glosa, status_conciliacao, interacao_id')
      .eq('lote_importacao_id', rpc.lote_id)
      .order('status_conciliacao');

    const ids = [...new Set((detalhes || []).filter(d => d.interacao_id).map(d => d.interacao_id))];
    const mapaVend = {};
    if (ids.length) {
      const { data: inter } = await supabaseClient.from('interacoes').select('id, vendedor').in('id', ids);
      (inter || []).forEach(i => { mapaVend[i.id] = i.vendedor; });
    }

    finState.conciliacao.linhas = (detalhes || []).map(d => {
      let tag = 'OK';
      if (d.status_conciliacao === 'GLOSADO' || d.status_conciliacao === 'NAO_ENCONTRADO_SISTEMA') tag = 'RETIDO';
      if (d.status_conciliacao === 'DIVERGENCIA_VALOR') tag = 'ESTORNO';
      return {
        id: d.id,
        consultor: d.interacao_id ? (mapaVend[d.interacao_id] || '—') : 'Não Encontrado',
        gsm: d.tim_gsm || '—',
        plano: d.tim_plano_oferta || '—',
        pago: parseFloat(d.tim_valor_pago || 0),
        tipo: d.tim_motivo_glosa || 'PAGO',
        auditoria: tag
      };
    });

    renderizarResultadoConciliacao();
  } catch (err) {
    console.error('[Conciliação]', err);
    status.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm font-bold">
      ❌ ${err.message}
    </div>`;
  }
}

function renderizarResultadoConciliacao() {
  const r = finState.conciliacao.resumo;
  const drop = document.getElementById('concDrop');
  const status = document.getElementById('concStatus');
  const cards = document.getElementById('concCards');
  const tabela = document.getElementById('concTabela');

  drop.style.display = 'none';
  status.innerHTML = '';
  cards.style.display = 'block';

  const fmt = v => Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});

  document.getElementById('concCardLinhas').textContent = r.processado;
  document.getElementById('concCardMatch').textContent = r.match;
  document.getElementById('concCardDiverge').textContent = r.divergencia;
  document.getElementById('concCardGlosa').textContent = r.glosas;
  document.getElementById('concCardTotal').textContent = 'R$ ' + fmt(r.totalPago);

  tabela.innerHTML = finState.conciliacao.linhas.map(l => {
    const cls = l.auditoria === 'RETIDO' ? 'bg-red-50/40' : l.auditoria === 'ESTORNO' ? 'bg-blue-50/30' : '';
    const tag = l.auditoria === 'OK'
      ? '<span class="px-2 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-700">MATCH</span>'
      : l.auditoria === 'RETIDO'
        ? '<span class="px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-700">GLOSA</span>'
        : '<span class="px-2 py-1 rounded text-xs font-bold bg-blue-100 text-blue-700">ESTORNO</span>';

    return `<tr class="border-b border-slate-100 ${cls}">
      <td class="px-4 py-3 text-sm font-medium">${l.consultor}</td>
      <td class="px-4 py-3"><div class="font-medium text-sm">${l.gsm}</div><div class="text-xs text-slate-400">${l.plano}</div></td>
      <td class="px-4 py-3 text-right text-sm font-bold">${fmt(l.pago)}</td>
      <td class="px-4 py-3 text-xs text-slate-500">${l.tipo}</td>
      <td class="px-4 py-3 text-center">${tag}</td>
    </tr>`;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function fecharCompetencia() {
  const mes = finState.conciliacao.mes;
  if (!confirm(`Fechar a competência ${mes}?\n\nApós fechar, o espelho só considerará as vendas conciliadas.`)) return;

  try {
    const { data, error } = await supabaseClient.rpc('fechar_competencia', {
      p_mes_competencia: `${mes}-01`
    });
    if (error) throw error;

    document.getElementById('concBtnFechar').style.display = 'none';
    document.getElementById('concSeloFechada').style.display = 'inline-flex';
    alert(`✅ Competência fechada!\n\nConciliadas: ${data.conciliadas}\nPendentes: ${data.pendentes}\n\n${data.aviso}`);
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

function resetarConciliacao() {
  finState.conciliacao = { mes: finState.conciliacao.mes, arquivo: null, resumo: null, linhas: [] };
  document.getElementById('concDrop').style.display = 'block';
  document.getElementById('concCards').style.display = 'none';
  document.getElementById('concStatus').innerHTML = '';
  const fi = document.getElementById('concFileInput');
  if (fi) fi.value = '';
}

async function excluirConciliacaoMes() {
  const mes = finState.conciliacao.mes;
  if (!mes) return;

  // Primeira trava de segurança
  if (!confirm(`⚠️ ATENÇÃO: Você está prestes a apagar TUDO de ${fmtMes(mes + '-01')}.\n\nIsso removerá todas as linhas importadas do banco de dados. Tem certeza?`)) {
    return;
  }

  // Segunda trava (à prova de cliques errados)
  if (!confirm(`🚨 ÚLTIMA CHANCE!\n\nEssa ação NÃO PODE ser desfeita. Deseja realmente limpar a conciliação deste mês?`)) {
    return;
  }

  try {
    // Pega o botão para mostrar o feedback visual
    const btn = event.target.closest('button');
    const htmlOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<svg class="animate-spin w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Apagando...';

    // 1. Deleta as linhas da conciliação
    const { error: errConc } = await supabaseClient
      .from('financeiro_conciliacao_tim')
      .delete()
      .eq('mes_competencia', `${mes}-01`);

    if (errConc) throw errConc;

    // 2. (Opcional) Deleta o lote de importação, se essa tabela existir no seu banco
    try {
      await supabaseClient
        .from('financeiro_lotes_importacao')
        .delete()
        .eq('mes_competencia', `${mes}-01`);
    } catch (e) {
      console.warn('Aviso: Tabela de lotes não encontrada ou erro ao apagar.', e);
    }

    // 3. Limpa o estado local e reseta a tela
    finState.conciliacao.resumo = null;
    finState.conciliacao.linhas = [];
    resetarConciliacao();

    alert('✅ Importação excluída com sucesso! O mês está limpo.');

  } catch (err) {
    console.error('[Conciliação] Erro ao excluir:', err);
    
    // Se o banco bloquear a exclusão (Foreign Key), avisa o usuário
    if (err.message.includes('foreign key')) {
      alert('❌ Não foi possível excluir pois existem Espelhos ou Comissões geradas para este mês.\n\nVocê precisa apagar os espelhos gerados primeiro.');
    } else {
      alert('❌ Erro ao excluir: ' + err.message);
    }
  }
}

function trocarAbaConc(aba) {
  const tabTim = document.getElementById('concTabTim');
  const tabVendas = document.getElementById('concTabVendas');
  const viewTim = document.getElementById('concDrop');
  const viewCards = document.getElementById('concCards');
  const viewVendas = document.getElementById('concVendasView');

  if (aba === 'tim') {
    tabTim.className = 'px-5 py-3 text-sm font-black uppercase tracking-wide border-b-2 border-[#0e8890] text-[#0e8890]';
    tabVendas.className = 'px-5 py-3 text-sm font-black uppercase tracking-wide border-b-2 border-transparent text-slate-400 hover:text-slate-600';
    viewVendas.style.display = 'none';
    if (finState.conciliacao.resumo) {
      viewTim.style.display = 'none';
      viewCards.style.display = 'block';
    } else {
      viewTim.style.display = 'block';
      viewCards.style.display = 'none';
    }
  } else {
    tabTim.className = 'px-5 py-3 text-sm font-black uppercase tracking-wide border-b-2 border-transparent text-slate-400 hover:text-slate-600';
    tabVendas.className = 'px-5 py-3 text-sm font-black uppercase tracking-wide border-b-2 border-[#0e8890] text-[#0e8890]';
    viewTim.style.display = 'none';
    viewCards.style.display = 'none';
    viewVendas.style.display = 'block';
    carregarVendasNaoPagas();
  }
}

async function carregarVendasNaoPagas() {
  const container = document.getElementById('concVendasTbody');
  const mes = document.getElementById('concMes').value;

  container.innerHTML = `<div class="text-center py-12 text-slate-500">
    <svg class="animate-spin w-5 h-5 text-indigo-600 inline-block" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/>
      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
    Carregando...
  </div>`;

  try {
    const { data, error } = await supabaseClient.rpc('listar_vendas_consolidadas', { p_mes_competencia: `${mes}-01` });
    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = `<div class="px-6 py-12 text-center text-slate-500">Nenhuma venda encontrada para ${mes}.</div>`;
      return;
    }

    const fmt = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    const totalPago = data.filter(d => d.status_pagamento === 'PAGO').length;
    const totalNaoPago = data.filter(d => d.status_pagamento === 'NAO_PAGO').length;
    const totalGlosado = data.filter(d => d.status_pagamento === 'GLOSADO').length;
    const totalEstornado = data.filter(d => d.status_pagamento === 'ESTORNADO').length;
    const totalRecebidoGeral = data.reduce((s, d) => s + (parseFloat(d.total_recebido) || 0), 0);

    const header = `
      <div class="bg-slate-100 px-6 py-3 flex flex-wrap gap-3 items-center text-xs border-b border-slate-200">
        <span class="font-black text-slate-700">${data.length} linhas vendidas</span>
        <span class="text-emerald-700 font-bold">✅ ${totalPago} pagas</span>
        <span class="text-red-700 font-bold">❌ ${totalNaoPago} não pagas</span>
        <span class="text-orange-700 font-bold">⚠️ ${totalGlosado} glosadas</span>
        <span class="text-blue-700 font-bold">↩️ ${totalEstornado} estornadas</span>
        <span class="ml-auto font-black text-slate-900">Total TIM: R$ ${fmt(totalRecebidoGeral)}</span>
      </div>
    `;

    const cards = data.map(v => {
      const badge = {
        'PAGO':       '<span class="px-2 py-1 rounded text-xs font-black bg-emerald-100 text-emerald-700">✅ PAGO</span>',
        'NAO_PAGO':   '<span class="px-2 py-1 rounded text-xs font-black bg-red-100 text-red-700">❌ NÃO PAGO</span>',
        'GLOSADO':    '<span class="px-2 py-1 rounded text-xs font-black bg-orange-100 text-orange-700">⚠️ GLOSADO</span>',
        'ESTORNADO':  '<span class="px-2 py-1 rounded text-xs font-black bg-blue-100 text-blue-700">↩️ ESTORNADO</span>',
        'PENDENTE':   '<span class="px-2 py-1 rounded text-xs font-black bg-slate-100 text-slate-600">⏳ PENDENTE</span>'
      }[v.status_pagamento] || '—';

      const cardBorder = v.status_pagamento === 'NAO_PAGO' ? 'border-l-red-500 bg-red-50/30'
                       : v.status_pagamento === 'GLOSADO'  ? 'border-l-orange-500 bg-orange-50/30'
                       : v.status_pagamento === 'ESTORNADO' ? 'border-l-blue-500 bg-blue-50/30'
                       : 'border-l-emerald-500 bg-white';

      const total = parseFloat(v.total_recebido) || 0;
      const totalCor = total > 0 ? 'text-emerald-700' : total < 0 ? 'text-red-700' : 'text-slate-400';

      const itens = Array.isArray(v.itens) ? v.itens : [];
      const itensHTML = itens.length === 0
        ? `<div class="text-xs text-slate-400 italic py-2">Nenhum pagamento registrado pela TIM</div>`
        : itens.map(it => {
            const valor = parseFloat(it.valor) || 0;
            const corValor = valor >= 0 ? 'text-emerald-700' : 'text-red-600';
            const qtdTxt = it.qtd > 1 ? `<span class="ml-1 text-[10px] text-slate-400">(×${it.qtd})</span>` : '';
            return `
              <div class="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                <span class="text-xs text-slate-600 flex-1">${it.tipo || '—'}${qtdTxt}</span>
                <span class="text-sm font-bold ${corValor} ml-3">R$ ${fmt(valor)}</span>
              </div>`;
          }).join('');

      // 🟢 VARIÁVEL RESTAURADA AQUI
      const provInfo = v.telefone_provisorio
        ? `<div class="font-mono text-[10px] text-amber-600 mt-0.5">⚡ prov: ${v.telefone_provisorio}</div>`
        : '';

      return `
        <div class="border border-slate-200 border-l-4 ${cardBorder} rounded-lg mb-3 overflow-hidden shadow-sm">
          <div class="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div class="flex-1 min-w-0">
              <div class="font-bold text-sm text-slate-800 truncate">${v.nome || '—'}</div>
              <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                <span class="font-mono text-xs text-slate-500">${v.telefone || '—'}</span>
                <span class="text-xs text-slate-400">${v.plano || '—'}</span>
                <span class="text-[10px] font-bold text-slate-500 uppercase">${v.consultor || '—'}</span>
              </div>
              ${provInfo}
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <div class="text-right">
                <div class="text-[10px] text-slate-400 uppercase font-bold">Total</div>
                <div class="text-base font-black ${totalCor}">R$ ${fmt(total)}</div>
              </div>
              ${badge}
              
              <!-- 🆕 BOTÃO DE CANCELAR VENDA -->
              <button onclick="cancelarVenda('${v.interacao_id || v.id}', '${v.nome || 'Cliente'}')" 
                class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200" 
                title="Cancelar esta venda (Ela sumirá dos espelhos)">
                <i data-lucide="x-circle" class="w-4 h-4"></i>
              </button>
            </div>
          </div>

          <div class="px-4 py-2 bg-slate-50/50 border-t border-slate-100">
            ${itensHTML}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="rounded-lg overflow-hidden border border-slate-200">${header}<div class="p-3">${cards}</div></div>`;
  } catch (err) {
    console.error('[Vendas]', err);
    container.innerHTML = `<div class="px-6 py-12 text-center text-red-500">Erro: ${err.message}</div>`;
  }
}
/* ============================================================
   ESPELHO DE COMISSÃO
   ============================================================ */

async function carregarEspelho() {
  const container = document.getElementById('espelhoConteudo');
  container.innerHTML = `<div class="text-center py-12"><svg class="animate-spin w-8 h-8 text-indigo-600 mx-auto" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>`;

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const inputMes = document.getElementById('espelhoMes');
    if (inputMes && !inputMes.value) {
      inputMes.value = new Date().toISOString().slice(0, 7);
      if (!inputMes._binded) {
        inputMes._binded = true;
        inputMes.addEventListener('change', () => {
          finState.espelho.competencia = inputMes.value;
          carregarEspelho();
        });
      }
    }
    const competencia = inputMes?.value || finState.espelho.competencia;
    finState.espelho.competencia = competencia;
    const mes = competencia + '-01';

    const isAdmin = state._isAdmin === true;
    const selectVend = document.getElementById('espelhoVendedor');

    let vendedor;
    if (isAdmin) {
      selectVend.style.display = 'inline-block';
      if (!selectVend._binded) {
        selectVend._binded = true;
        selectVend.addEventListener('change', () => {
          finState.espelho.vendedorSelecionado = selectVend.value;
          carregarEspelho();
        });
      }
      if (selectVend._mesCarregado !== mes) {
        selectVend._mesCarregado = mes;
        const { data: vendedores } = await supabaseClient
          .from('financeiro_espelhos_b2c').select('vendedor_id').eq('mes_competencia_venda', mes).order('vendedor_id');
        const lista = (vendedores || []).map(v => v.vendedor_id);
        if (lista.length) {
          selectVend.innerHTML = lista.map(v => `<option value="${v}">${v}</option>`).join('');
        } else {
          const { data: inter } = await supabaseClient
            .from('interacoes').select('vendedor').gte('data_venda', mes).lte('data_venda', competencia + '-31');
          const unicos = [...new Set((inter || []).map(i => i.vendedor))].filter(v => v && !v.includes('CAIXA') && !v.includes('INFORTECA LTDA')).sort();
          selectVend.innerHTML = unicos.length ? unicos.map(v => `<option value="${v}">${v}</option>`).join('') : '<option value="">— Sem dados —</option>';
        }
        const nomeUser = (state.perfil?.nome_completo || '').toUpperCase();
        if (Array.from(selectVend.options).some(o => o.value === nomeUser)) selectVend.value = nomeUser;
      }
      vendedor = selectVend.value || (state.perfil?.nome_completo || '').toUpperCase();
    } else {
      selectVend.style.display = 'none';
      vendedor = (state.perfil?.nome_completo || '').toUpperCase();
    }

    const nomeMesA = formatarMesMeta(competencia);
    const nomeMesB = nomeMesA.replace('/', ' / ');
    let { data: metaData } = await supabaseClient.from('metas_mensais').select('dados').eq('mes', nomeMesA).maybeSingle();
    if (!metaData) {
      const { data: alt } = await supabaseClient.from('metas_mensais').select('dados').eq('mes', nomeMesB).maybeSingle();
      metaData = alt;
    }

    let metaInfo = null;
    let bateuPessoal = false;
    let lojaBateu = false;

    if (metaData?.dados) {
      const consultores = metaData.dados.consultores || [];
      const metaCons = metaData.dados.metaConsultor || {};
      const metaLoja = metaData.dados.metaLoja || {};
      const parametros = metaData.dados.parametros || {};

      const primeiroNome = vendedor.split(' ')[0].toLowerCase();
      const consultor = consultores.find(c => String(c.nome || '').toLowerCase().split(' ')[0] === primeiroNome);

      if (consultor) {
        const soma = (arr) => (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
        const d = consultor.diario || {};

        const realizadoPos = soma(d['PÓS']);
        const realizadoControle = soma(d['CONTROLE']);
        const realizadoGross = realizadoPos + realizadoControle;
        const metaPos = Number(metaCons['PÓS'] || 0);
        const metaControle = Number(metaCons['CONTROLE'] || 0);
        const metaGross = metaPos + metaControle;

        const realizadoFatPos = soma(d['PÓS FAT.']);
        const realizadoPortabilidade = soma(d['PORTABILIDADE']);
        const realizadoFatControle = soma(d['CONTROLE FAT.']);
        const realizadoFatTotal = realizadoFatPos + realizadoFatControle;
        const metaFatPos = Number(metaCons['PÓS FAT.'] || 0);
        const metaFatControle = Number(metaCons['CONTROLE FAT.'] || 0);
        const metaFatTotal = Number(metaCons['FAT TOTAL TIM'] || (metaFatPos + metaFatControle));

        const realizadoAparelho = soma(d['APARELHO']);

        // 🆕 LÓGICA DE ACESSÓRIOS M+1 (Competência D+2)
        let realizadoAcessorios = 0;
        try {
          const [anoComp, mesComp] = competencia.split('-');
          let proxAno = parseInt(anoComp);
          let proxMes = parseInt(mesComp) + 1;
          if (proxMes > 12) { proxMes = 1; proxAno++; }
          
          const compAcessorios = `${proxAno}-${String(proxMes).padStart(2, '0')}`;
          const nomeMesAcessA = formatarMesMeta(compAcessorios);
          const nomeMesAcessB = nomeMesAcessA.replace('/', ' / ');
          
          // Busca a meta do mês seguinte
          let { data: metaAcessData } = await supabaseClient
            .from('metas_mensais').select('dados').eq('mes', nomeMesAcessA).maybeSingle();
            
          if (!metaAcessData) {
            const { data: altAcess } = await supabaseClient
              .from('metas_mensais').select('dados').eq('mes', nomeMesAcessB).maybeSingle();
            metaAcessData = altAcess;
          }
          
          if (metaAcessData?.dados) {
            const consultoresAcess = metaAcessData.dados.consultores || [];
            const consultorAcess = consultoresAcess.find(c => String(c.nome || '').toLowerCase().split(' ')[0] === primeiroNome);
            if (consultorAcess) {
              realizadoAcessorios = soma(consultorAcess.diario?.['ACESSÓRIOS']);
            }
          }
        } catch (e) {
          console.warn('[Acessórios M+1] Erro ao buscar mês seguinte:', e);
        }

        // Percentual pelo FATURAMENTO (principal)

        const pctFat = metaFatTotal > 0 ? (realizadoFatTotal / metaFatTotal) * 100 : 0;
        bateuPessoal = pctFat >= 100;

        const realizadoLojaFatPos = consultores.reduce((s, c) => s + soma((c.diario || {})['PÓS FAT.']), 0);
        const realizadoLojaFatCtrl = consultores.reduce((s, c) => s + soma((c.diario || {})['CONTROLE FAT.']), 0);
        const realizadoLojaFat = realizadoLojaFatPos + realizadoLojaFatCtrl;
        const metaLojaFatTotal = Number(metaLoja['FAT TOTAL TIM'] || 0) || (Number(metaLoja['PÓS FAT.'] || 0) + Number(metaLoja['CONTROLE FAT.'] || 0));
        const pctLoja = metaLojaFatTotal > 0 ? (realizadoLojaFat / metaLojaFatTotal) * 100 : 0;
        lojaBateu = pctLoja >= 100;

        metaInfo = {
          realizadoFatTotal, metaFatTotal, pctFat,
          realizadoFatPos, realizadoFatControle, metaFatPos, metaFatControle,
          realizadoServicos: realizadoGross, metaServicos: metaGross,
          metaPos, realizadoPos, metaControle, realizadoControle,
          pct: pctFat, bateuPessoal,
          metaPortabilidade: Number(metaCons['PORTABILIDADE'] || 0),
          realizadoPortabilidade,
          metaAparelho: Number(metaCons['APARELHO'] || 0), realizadoAparelho,
          metaAcessorios: Number(metaCons['ACESSÓRIOS'] || 0), realizadoAcessorios,
          realizadoLoja: realizadoLojaFat, metaLoja: metaLojaFatTotal, pctLoja, bateuLoja: lojaBateu,
          diasTrabalhados: Number(parametros.diasTrabalhados) || 0,
          diasRestantes: Number(parametros.diasRestantes) || 0,
          qtControle: Number(parametros.qt_controle ?? metaData.dados.qt_controle) || 0.7308,
          qtPos: Number(parametros.qt_pos ?? metaData.dados.qt_pos) || 1.0
        };
      }
    }

    const portCount = metaInfo?.realizadoPortabilidade || 0;

    const { data: espelho } = await supabaseClient.from('financeiro_espelhos_b2c').select('*').eq('vendedor_id', vendedor).eq('mes_competencia_venda', mes).maybeSingle();

    if (espelho) {
      const { data: itens } = await supabaseClient.from('financeiro_espelho_itens').select('*').eq('espelho_id', espelho.id).order('valor_comissao_final', { ascending: false });
      finState.espelho.dados = espelho;
      finState.espelho.itens = itens || [];
      finState.espelho.metaInfo = metaInfo;
      finState.espelho.vendedor = vendedor;
      finState.espelho.portCount = portCount;
      finState.espelho.modo = 'OFICIAL';
      finState.espelho.previsao = null;
      await renderizarEspelho();
      return;
    }

    const { data: previsao, error: preErr } = await supabaseClient.rpc('calcular_previsao_comissao_b2c', {
      p_mes_competencia: mes, p_vendedor_id: vendedor, p_vendedor_bateu_meta: bateuPessoal, p_loja_bateu_meta: lojaBateu
    });
    if (preErr) throw preErr;

    finState.espelho.modo = 'PREVISAO';
    finState.espelho.previsao = previsao;
    finState.espelho.metaInfo = metaInfo;
    finState.espelho.vendedor = vendedor;
    finState.espelho.portCount = portCount;
    finState.espelho.dados = null;
    finState.espelho.itens = [];
    await renderizarEspelho();

  } catch (err) {
    container.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">Erro: ${err.message}</div>`;
  }
}

async function renderizarEspelho() {
  if (finState.espelho.modo === 'PREVISAO') {
    await renderizarPrevisao();
    return;
  }

  const e = finState.espelho.dados;
  const itens = finState.espelho.itens;
  const meta = finState.espelho.metaInfo;
  const vendedor = finState.espelho.vendedor || e.vendedor_id;
  const fmt = v => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});

  const servicos = itens.filter(i => !['ACESSORIO','APARELHO','ACELERADOR_PORTABILIDADE'].includes(i.tipo_item));
  const acessorios = itens.filter(i => i.tipo_item === 'ACESSORIO');
  const aparelhos = itens.filter(i => i.tipo_item === 'APARELHO');

  // 🆕 CÁLCULO DA BASE PARA MOSTRAR NO CARD (ACESSÓRIOS E APARELHOS)
  const baseAcessorios = acessorios.reduce((s, i) => s + Number(i.valor_referencia_base || 0), 0);
  const fatorAcessorios = acessorios.length > 0 ? acessorios[0].fator_remuneracao_aplicado : 0;

  const baseAparelhos = aparelhos.reduce((s, i) => s + Number(i.valor_referencia_base || 0), 0);
  const fatorAparelhos = aparelhos.length > 0 ? aparelhos[0].fator_remuneracao_aplicado : 0;
  // =========================================================

  const metaPort = meta?.metaPortabilidade || 0;
  const realPort = finState.espelho.portCount || meta?.portCount || 0;
  const pctPort = metaPort > 0 ? (realPort / metaPort) * 100 : 0;
  const bateuPort = realPort >= metaPort && metaPort > 0;

  const metaFatA = meta?.metaFatTotal || 0;
  const realFatA = meta?.realizadoFatTotal || 0;
  const bateuFatA = metaFatA > 0 && realFatA >= metaFatA;
  const faltaFatPort = Math.max(0, metaFatA - realFatA);
  
  let portEstado;
  if (metaPort === 0) portEstado = 'SEM_META';
  else if (!bateuPort) portEstado = 'FALTAM_PORT';
  else if (bateuPort && !bateuFatA) portEstado = 'FALTA_FAT';
  else portEstado = 'LIBERADO';

  const aceleradorPort = portEstado === 'LIBERADO' ? (e.total_comissao_servicos || 0) * 0.15 : 0;
  const totalFinalEspelho = (e.total_liquido_receber || 0) + aceleradorPort;

  const servicosAgrupados = {};
  servicos.forEach(i => {
    if (!servicosAgrupados[i.tipo_item]) {
      servicosAgrupados[i.tipo_item] = { qtd: 0, vr: i.valor_referencia_base, qt: i.qualidade_aplicada, fator: i.fator_remuneracao_aplicado, total: 0 };
    }
    servicosAgrupados[i.tipo_item].qtd += 1;
    servicosAgrupados[i.tipo_item].total += Number(i.valor_comissao_final) || 0;
  });

  let gamificacaoHTML = '';
  if (meta) {
    const pct = Math.min(100, meta.pctFat);
    const corBg = meta.bateuPessoal ? 'bg-emerald-500' : meta.pctFat >= 70 ? 'bg-amber-500' : 'bg-red-500';
    const corTexto = meta.bateuPessoal ? 'text-emerald-700' : meta.pctFat >= 70 ? 'text-amber-700' : 'text-red-700';
    const corBorder = meta.bateuPessoal ? 'border-emerald-200 bg-emerald-50' : meta.pctFat >= 70 ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50';
    const emoji = meta.bateuPessoal ? '🎉' : meta.pctFat >= 70 ? '💪' : '📈';
    const fmtR = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    const faltaFat = Math.max(0, meta.metaFatTotal - meta.realizadoFatTotal);

    const msg = meta.bateuPessoal
      ? `Parabéns! Você bateu sua meta de faturamento (fator 30%)`
      : `Faltam <strong>${fmtR(faltaFat)}</strong> em faturamento para bater a meta (fator 30%)`;

    gamificacaoHTML = `
      <div class="rounded-2xl border-2 ${corBorder} p-5 mb-6">
        <div class="flex justify-between items-start mb-3">
          <div>
            <p class="text-[10px] font-black ${corTexto} uppercase tracking-widest">${emoji} Meta Pessoal — Faturamento</p>
            <p class="text-sm ${corTexto} font-bold mt-1">${msg}</p>
          </div>
          <div class="text-right">
            <div class="text-3xl font-black ${corTexto}">${meta.pctFat.toFixed(0)}%</div>
            <div class="text-xs text-slate-500">${fmtR(meta.realizadoFatTotal)} / ${fmtR(meta.metaFatTotal)}</div>
          </div>
        </div>
        <div class="w-full bg-white rounded-full h-3 overflow-hidden border border-slate-200">
          <div class="${corBg} h-3 rounded-full transition-all" style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  let performanceHTML = '';
  if (meta && meta.metaFatTotal > 0) {
    const linhas = [
      { label: 'Faturamento TIM', meta: meta.metaFatTotal, real: meta.realizadoFatTotal, tipo: 'moeda' },
      { label: 'Portabilidade', meta: meta.metaPortabilidade, real: realPort, tipo: 'numero' },
      { label: 'Aparelhos (R$)', meta: meta.metaAparelho, real: meta.realizadoAparelho, tipo: 'moeda' },
      { label: 'Acessórios (R$)', meta: meta.metaAcessorios, real: meta.realizadoAcessorios, tipo: 'moeda' }
    ].filter(l => l.meta > 0);

    const fmtV = (v, tipo) => tipo === 'moeda' ? 'R$ ' + Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) : Math.round(v||0);
    const linhasHTML = linhas.map(l => {
      const pctL = l.meta > 0 ? (l.real / l.meta) * 100 : 0;
      const corBg = pctL >= 100 ? 'bg-emerald-500' : pctL >= 70 ? 'bg-amber-500' : 'bg-red-500';
      const corTexto = pctL >= 100 ? 'text-emerald-700' : pctL >= 70 ? 'text-amber-700' : 'text-red-700';
      const emoji = pctL >= 100 ? '✅' : pctL >= 70 ? '⚠️' : '❌';
      return `
        <div class="py-3 border-b border-slate-100 last:border-0">
          <div class="flex justify-between items-center mb-1.5">
            <span class="text-xs font-bold text-slate-700">${l.label}</span>
            <span class="text-xs font-black ${corTexto}">${emoji} ${pctL.toFixed(0)}%</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
              <div class="${corBg} h-2 rounded-full" style="width:${Math.min(100, pctL)}%"></div>
            </div>
            <span class="text-[11px] text-slate-500 min-w-[110px] text-right">
              <strong class="${corTexto}">${fmtV(l.real, l.tipo)}</strong> / ${fmtV(l.meta, l.tipo)}
            </span>
          </div>
        </div>`;
    }).join('');

    performanceHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-5 mb-6 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-black text-[#000033] uppercase tracking-wide">📊 Sua Performance</h3>
          <span class="text-[10px] text-slate-400 font-bold">${meta.diasTrabalhados} dias trabalhados · faltam ${meta.diasRestantes}</span>
        </div>
        ${linhasHTML}
      </div>`;
  }

  const linhasServicos = Object.entries(servicosAgrupados).sort(([, a], [, b]) => b.total - a.total).map(([nome, d]) => `
      <tr class="border-b border-slate-100 hover:bg-slate-50">
        <td class="px-4 py-3 text-sm font-medium text-slate-800">${nome}</td>
        <td class="px-4 py-3 text-center text-sm text-slate-600">${d.qtd}</td>
        <td class="px-4 py-3 text-right text-sm text-slate-600">R$ ${fmt(d.vr)}</td>
        <td class="px-4 py-3 text-center text-xs text-slate-500">${(d.qt * 100).toFixed(2)}%</td>
        <td class="px-4 py-3 text-center text-xs text-slate-500">${(d.fator * 100).toFixed(1)}%</td>
        <td class="px-4 py-3 text-right text-sm font-bold text-slate-800">R$ ${fmt(d.total)}</td>
      </tr>`).join('');

  const container = document.getElementById('espelhoConteudo');
  container.innerHTML = `
    <div class="bg-gradient-to-r from-[#000033] to-[#0e8890] rounded-2xl p-6 mb-6 text-white shadow-lg">
      <div class="flex justify-between items-start flex-wrap gap-4">
        <div>
          <p class="text-[10px] font-black uppercase tracking-widest opacity-70">Espelho de Comissão</p>
          <h2 class="text-2xl font-black mt-1">${vendedor}</h2>
          <p class="text-sm opacity-90 mt-1">Competência: ${fmtMes(e.mes_competencia_venda)}</p>
          <p class="text-[10px] uppercase font-bold mt-1 opacity-70">${e.status_espelho || 'RASCUNHO'}</p>
        </div>
        
        <div class="flex items-center gap-3">
          <!-- 🆕 BOTÃO EXCLUSIVO PARA ADMIN -->
          ${state._isAdmin ? `
          <button onclick="reabrirCompetenciaEspelho('${e.mes_competencia_venda}')" class="bg-red-500/80 hover:bg-red-600 backdrop-blur text-white px-4 py-3 rounded-xl text-xs font-black uppercase tracking-wide flex items-center gap-2 transition shadow-lg">
            <i data-lucide="unlock" class="w-4 h-4"></i>
            Reabrir Mês
          </button>
          ` : ''}

          <button onclick="exportarEspelhoPdf()" class="bg-white/20 hover:bg-white/30 backdrop-blur text-white px-5 py-3 rounded-xl text-sm font-black uppercase tracking-wide flex items-center gap-2 transition">
            <i data-lucide="download" class="w-4 h-4"></i>
            Exportar PDF
          </button>
        </div>
      </div>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Serviços TIM</p>
        <p class="text-xl font-black text-slate-800">R$ ${fmt(e.total_comissao_servicos)}</p>
        <p class="text-[10px] text-slate-400 mt-1">${servicos.length} itens</p>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Acessórios</p>
        <p class="text-xl font-black text-slate-800">R$ ${fmt(e.total_comissao_acessorios)}</p>
        <p class="text-[10px] text-slate-400 mt-1">
          ${acessorios.length > 0 
            ? `Base R$ ${fmt(baseAcessorios)} × ${(fatorAcessorios * 100).toFixed(2)}%` 
            : `0 itens`}
        </p>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Aparelhos</p>
        <p class="text-xl font-black text-slate-800">R$ ${fmt(e.total_comissao_aparelhos)}</p>
        <p class="text-[10px] text-slate-400 mt-1">
          ${aparelhos.length > 0 
            ? `Base R$ ${fmt(baseAparelhos)} × ${(fatorAparelhos * 100).toFixed(2)}%` 
            : `0 itens`}
        </p>
      </div>
      <div class="bg-emerald-500 rounded-2xl p-5 shadow-lg">
        <p class="text-[10px] font-black text-emerald-100 uppercase tracking-widest mb-1">Total a Receber</p>
        <p class="text-2xl font-black text-white">R$ ${fmt(e.total_liquido_receber)}</p>
      </div>
    </div>

    ${gamificacaoHTML}${performanceHTML}

    <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-6 shadow-sm">
      <div class="px-6 py-4 border-b bg-slate-50">
        <h3 class="text-sm font-black text-[#000033] uppercase tracking-wide">Serviços TIM</h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th class="px-4 py-3 text-left font-black">Plano</th>
              <th class="px-4 py-3 text-center font-black">Qtd</th>
              <th class="px-4 py-3 text-right font-black">VR</th>
              <th class="px-4 py-3 text-center font-black">QT</th>
              <th class="px-4 py-3 text-center font-black">Fator</th>
              <th class="px-4 py-3 text-right font-black">Comissão</th>
            </tr>
          </thead>
          <tbody>${linhasServicos}</tbody>
          <tfoot class="bg-slate-50 border-t-2 border-slate-200">
            <tr>
              <td colspan="5" class="px-4 py-3 text-right text-xs font-black text-slate-600 uppercase">Subtotal Serviços</td>
              <td class="px-4 py-3 text-right font-black text-slate-800">R$ ${fmt(e.total_comissao_servicos)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    ${metaPort > 0 ? `
    <div class="rounded-2xl p-5 mb-6 shadow-md ${
      portEstado === 'LIBERADO'  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' :
      portEstado === 'FALTA_FAT' ? 'bg-gradient-to-r from-blue-500 to-blue-600' :
                                   'bg-white border border-slate-200'
    }">
      <div class="flex justify-between items-center">
        <div class="flex-1 min-w-0">
          <p class="text-[10px] font-black uppercase tracking-widest ${portEstado === 'LIBERADO' || portEstado === 'FALTA_FAT' ? 'text-white/90' : 'text-slate-500'}">
            ⚡ Portabilidade — ${pctPort.toFixed(0)}% da meta
          </p>
          <p class="text-sm font-bold mt-1 ${portEstado === 'LIBERADO' || portEstado === 'FALTA_FAT' ? 'text-white' : 'text-slate-700'}">
            ${portEstado === 'FALTAM_PORT' ? `Faltam <strong>${metaPort - realPort}</strong> portabilidades para bater a meta` :
              portEstado === 'FALTA_FAT' ? `✅ Portabilidade batida! Falta <strong>R$ ${fmt(faltaFatPort)}</strong> em faturamento` :
                `🎉 Meta batida! Acelerador de <strong>15%</strong> aplicado`}
          </p>
        </div>
        <div class="text-right shrink-0 ml-4">
          <div class="text-sm font-bold ${portEstado === 'LIBERADO' || portEstado === 'FALTA_FAT' ? 'text-white/90' : 'text-slate-500'} mb-1">${realPort} / ${metaPort}</div>
          <div class="text-xl font-black ${portEstado === 'LIBERADO' || portEstado === 'FALTA_FAT' ? 'text-white' : 'text-slate-400'}">${portEstado === 'LIBERADO' ? '+ R$ ' + fmt(aceleradorPort) : '—'}</div>
        </div>
      </div>
    </div>` : ''}
    
    <div class="bg-[#000033] rounded-2xl p-6 shadow-xl mb-6">
      ${aceleradorPort > 0 ? `
      <div class="flex justify-between items-center pb-3 mb-3 border-b border-white/10">
        <p class="text-[10px] font-black text-slate-300 uppercase tracking-widest">Subtotal base</p>
        <p class="text-lg font-black text-white">R$ ${fmt(e.total_liquido_receber)}</p>
      </div>
      <div class="flex justify-between items-center pb-3 mb-3 border-b border-white/10">
        <p class="text-[10px] font-black text-emerald-300 uppercase tracking-widest">⚡ Acelerador Portabilidade (15%)</p>
        <p class="text-lg font-black text-emerald-300">+ R$ ${fmt(aceleradorPort)}</p>
      </div>` : ''}
      <div class="flex justify-between items-center">
        <div>
          <p class="text-[10px] font-black text-slate-300 uppercase tracking-widest">Total Líquido a Receber</p>
        </div>
        <p class="text-3xl font-black text-white">R$ ${fmt(totalFinalEspelho)}</p>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

async function renderizarPrevisao() {
  const p = finState.espelho.previsao;
  const meta = finState.espelho.metaInfo;
  const vendedor = finState.espelho.vendedor;
  const competencia = finState.espelho.competencia;
  const fmt = v => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  const fmtR = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});

  const politicas = await obterPoliticas();
  const tier = resolverTier(meta);

  const fatorAparelho   = resolverFator(politicas, 'APARELHO',    tier);
  const fatorAcessorio  = resolverFator(politicas, 'ACESSORIO',   tier);
  const fatorServico    = resolverFator(politicas, 'SERVICO_TIM', tier);
  const fatorAcelerador = politicas?.SERVICO_TIM?.ACELERADOR_PORTABILIDADE ?? 0.15;

  const metaPort = p.portabilidade_meta || meta?.metaPortabilidade || 0;
  const realPort = meta?.realizadoPortabilidade || p.portabilidade_realizado || 0;
  const pctPort = metaPort > 0 ? (realPort / metaPort) * 100 : 0;
  const bateuPort = metaPort > 0 && realPort >= metaPort;

  const metaFatP = meta?.metaFatTotal || 0;
  const realFatP = meta?.realizadoFatTotal || 0;
  const bateuFatP = metaFatP > 0 && realFatP >= metaFatP;
  const faltaFatPortP = metaFatP > 0 ? Math.max(0, metaFatP - realFatP) : 0;

  let portEstadoP;
  if (metaPort === 0) portEstadoP = 'SEM_META';
  else if (!bateuPort) portEstadoP = 'FALTAM_PORT';
  else if (bateuPort && !bateuFatP) portEstadoP = 'FALTA_FAT';
  else portEstadoP = 'LIBERADO';

  const valorAparelhosVendidos  = Number(meta?.realizadoAparelho)   || 0;
  const valorAcessoriosVendidos = Number(meta?.realizadoAcessorios) || 0;

  const comissaoAparelhos  = Number((valorAparelhosVendidos  * fatorAparelho ).toFixed(2));
  const comissaoAcessorios = Number((valorAcessoriosVendidos * fatorAcessorio).toFixed(2));

  // Agora confiamos no SQL que já arrumamos
  const comissaoServicos = Number(p.total_servicos || 0);
  const totalGeralComExtras = comissaoServicos + comissaoAcessorios + comissaoAparelhos;

  const aceleradorPortP = portEstadoP === 'LIBERADO'
    ? Number((comissaoServicos * fatorAcelerador).toFixed(2))
    : 0;

  const totalFinalP = totalGeralComExtras + aceleradorPortP;

  let gamificacaoHTML = '';
  if (meta) {
    const pct = Math.min(100, meta.pctFat);
    const corBg = meta.bateuPessoal ? 'bg-emerald-500' : meta.pctFat >= 70 ? 'bg-amber-500' : 'bg-red-500';
    const corTexto = meta.bateuPessoal ? 'text-emerald-700' : meta.pctFat >= 70 ? 'text-amber-700' : 'text-red-700';
    const corBorder = meta.bateuPessoal ? 'border-emerald-200 bg-emerald-50' : meta.pctFat >= 70 ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50';
    const emoji = meta.bateuPessoal ? '🎉' : meta.pctFat >= 70 ? '💪' : '📈';
    const faltaFat = Math.max(0, meta.metaFatTotal - meta.realizadoFatTotal);
    const pctFatFmt = (fatorServico * 100).toFixed(0);

    const msg = meta.bateuPessoal
      ? `Parabéns! Você bateu sua meta de faturamento (fator ${pctFatFmt}%)`
      : `Faltam <strong>${fmtR(faltaFat)}</strong> em faturamento para bater a meta (fator ${pctFatFmt}%)`;

    gamificacaoHTML = `
      <div class="rounded-2xl border-2 ${corBorder} p-5 mb-6">
        <div class="flex justify-between items-start mb-3">
          <div>
            <p class="text-[10px] font-black ${corTexto} uppercase tracking-widest">${emoji} Meta Pessoal — Faturamento</p>
            <p class="text-sm ${corTexto} font-bold mt-1">${msg}</p>
          </div>
          <div class="text-right">
            <div class="text-3xl font-black ${corTexto}">${meta.pctFat.toFixed(0)}%</div>
            <div class="text-xs text-slate-500">${fmtR(meta.realizadoFatTotal)} / ${fmtR(meta.metaFatTotal)}</div>
          </div>
        </div>
        <div class="w-full bg-white rounded-full h-3 overflow-hidden border border-slate-200">
          <div class="${corBg} h-3 rounded-full transition-all" style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  let performanceHTML = '';
  if (meta) {
    const linhas = [
      { label: 'Faturamento TIM', meta: meta.metaFatTotal, real: meta.realizadoFatTotal, tipo: 'moeda' },
      { label: 'Portabilidade', meta: meta.metaPortabilidade, real: realPort, tipo: 'numero' },
      { label: 'Aparelhos (R$)', meta: meta.metaAparelho, real: meta.realizadoAparelho, tipo: 'moeda' },
      { label: 'Acessórios (R$)', meta: meta.metaAcessorios, real: meta.realizadoAcessorios, tipo: 'moeda' }
    ].filter(l => l.meta > 0);

    const fmtV = (v, tipo) => tipo === 'moeda' ? 'R$ ' + Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) : Math.round(v||0);

    const linhasHTML = linhas.map(l => {
      const pctL = l.meta > 0 ? (l.real / l.meta) * 100 : 0;
      const corBg = pctL >= 100 ? 'bg-emerald-500' : pctL >= 70 ? 'bg-amber-500' : 'bg-red-500';
      const corTexto = pctL >= 100 ? 'text-emerald-700' : pctL >= 70 ? 'text-amber-700' : 'text-red-700';
      const emoji = pctL >= 100 ? '✅' : pctL >= 70 ? '⚠️' : '❌';
      return `
        <div class="py-3 border-b border-slate-100 last:border-0">
          <div class="flex justify-between items-center mb-1.5">
            <span class="text-xs font-bold text-slate-700">${l.label}</span>
            <span class="text-xs font-black ${corTexto}">${emoji} ${pctL.toFixed(0)}%</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
              <div class="${corBg} h-2 rounded-full" style="width:${Math.min(100, pctL)}%"></div>
            </div>
            <span class="text-[11px] text-slate-500 min-w-[110px] text-right">
              <strong class="${corTexto}">${fmtV(l.real, l.tipo)}</strong> / ${fmtV(l.meta, l.tipo)}
            </span>
          </div>
        </div>`;
    }).join('');

    performanceHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-5 mb-6 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-black text-[#000033] uppercase tracking-wide">📊 Sua Performance (Projeção)</h3>
        </div>
        ${linhasHTML}
      </div>`;
  }

  const linhasServicos = (p.itens_servicos || []).map(it => `
    <tr class="border-b border-slate-100 hover:bg-slate-50">
      <td class="px-4 py-3 text-sm font-medium text-slate-800">${it.plano}</td>
      <td class="px-4 py-3 text-center text-sm text-slate-600">${it.qtd}</td>
      <td class="px-4 py-3 text-right text-sm text-slate-600">R$ ${fmt(it.vr)}</td>
      <td class="px-4 py-3 text-center text-xs text-slate-500">${(it.qt * 100).toFixed(2)}%</td>
      <td class="px-4 py-3 text-center text-xs text-slate-500">${(it.fator * 100).toFixed(1)}%</td>
      <td class="px-4 py-3 text-right text-sm font-bold text-slate-800">R$ ${fmt(it.total)}</td>
    </tr>`).join('');

  let portabilidadeHTML = '';
  if (metaPort > 0) {
    if (portEstadoP === 'FALTAM_PORT') {
      portabilidadeHTML = `
        <div class="rounded-2xl p-5 mb-6 shadow-md bg-white border border-slate-200">
          <div class="flex justify-between items-center">
            <div class="flex-1 min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-slate-500">⚡ Portabilidade — ${pctPort.toFixed(0)}% da meta</p>
              <p class="text-sm font-bold mt-1 text-slate-700">Faltam <strong>${metaPort - realPort}</strong> portabilidade${(metaPort - realPort) > 1 ? 's' : ''} para bater a meta</p>
            </div>
          </div>
        </div>`;
    } else if (portEstadoP === 'FALTA_FAT') {
      portabilidadeHTML = `
        <div class="rounded-2xl p-5 mb-6 shadow-md bg-gradient-to-r from-blue-500 to-blue-600">
          <div class="flex justify-between items-center">
            <div class="flex-1 min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-white/90">⚡ Portabilidade — 🎯 meta batida!</p>
              <p class="text-sm font-bold mt-1 text-white">Falta bater a <strong>meta de faturamento</strong> para liberar o Acelerador.</p>
              <p class="text-[11px] text-white/80 mt-1">${metaFatP > 0 ? `Faltam <strong>${fmtR(faltaFatPortP)}</strong> em faturamento` : 'Cadastre a meta de faturamento'}</p>
            </div>
          </div>
        </div>`;
    } else {
      portabilidadeHTML = `
        <div class="rounded-2xl p-5 mb-6 shadow-md bg-gradient-to-r from-emerald-500 to-emerald-600">
          <div class="flex justify-between items-center">
            <div class="flex-1 min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-white/90">⚡ Portabilidade — 🎉 ACELERADOR LIBERADO</p>
              <p class="text-sm font-bold mt-1 text-white">Bônus de <strong>${(fatorAcelerador * 100).toFixed(0)}%</strong> aplicado sobre a comissão de serviços.</p>
              <p class="text-[11px] text-white/90 mt-1">Acelerador: <strong>R$ ${fmt(aceleradorPortP)}</strong> sobre R$ ${fmt(comissaoServicos)}</p>
            </div>
          </div>
        </div>`;
    }
  }

  const container = document.getElementById('espelhoConteudo');
  container.innerHTML = `
    <div class="bg-gradient-to-r from-[#000033] to-[#0e8890] rounded-2xl p-6 mb-4 text-white shadow-lg">
      <div class="flex justify-between items-start flex-wrap gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="px-2 py-0.5 bg-amber-400 text-amber-900 text-[10px] font-black rounded uppercase tracking-wider">Prévia</span>
            <p class="text-[10px] font-black uppercase tracking-widest opacity-70">Espelho de Comissão</p>
          </div>
          <h2 class="text-2xl font-black mt-1">${vendedor}</h2>
          <p class="text-sm opacity-90 mt-1">Competência: ${fmtMes(competencia + '-01')}</p>
        </div>
      </div>
    </div>

    <div class="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
      <div class="p-2 bg-amber-100 rounded-lg shrink-0">
        <i data-lucide="info" class="w-5 h-5 text-amber-600"></i>
      </div>
      <div>
        <p class="text-sm font-black text-amber-900">Valores sujeitos a alteração</p>
        <p class="text-xs text-amber-700 mt-1 leading-relaxed">
          Esta é uma <strong>projeção</strong> com base nas vendas do mês. Após a conciliação TIM e fechamento da competência, o espelho oficial substitui automaticamente esses valores.
        </p>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Serviços TIM</p>
        <p class="text-xl font-black text-slate-800">R$ ${fmt(comissaoServicos)}</p>
        <p class="text-[10px] text-slate-400 mt-1">${p.qtd_servicos} itens</p>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Acessórios</p>
        <p class="text-xl font-black text-slate-800">R$ ${fmt(comissaoAcessorios)}</p>
        <p class="text-[10px] text-slate-400 mt-1">
          ${valorAcessoriosVendidos > 0 ? `Base R$ ${fmt(valorAcessoriosVendidos)} × ${(fatorAcessorio * 100).toFixed(2)}%` : `${p.qtd_acessorios || 0} itens`}
        </p>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Aparelhos</p>
        <p class="text-xl font-black text-slate-800">R$ ${fmt(comissaoAparelhos)}</p>
        <p class="text-[10px] text-slate-400 mt-1">
          ${valorAparelhosVendidos > 0 ? `Base R$ ${fmt(valorAparelhosVendidos)} × ${(fatorAparelho * 100).toFixed(2)}%` : `${p.qtd_aparelhos || 0} itens`}
        </p>
      </div>
      <div class="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-5 shadow-lg">
        <p class="text-[10px] font-black text-white/90 uppercase tracking-widest mb-1">Projeção a Receber</p>
        <p class="text-2xl font-black text-white">R$ ${fmt(totalGeralComExtras)}</p>
        <p class="text-[10px] text-white/80 mt-1">Sujeito a glosa</p>
      </div>
    </div>

    ${gamificacaoHTML}${performanceHTML}

    <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-6 shadow-sm">
      <div class="px-6 py-4 border-b bg-slate-50">
        <h3 class="text-sm font-black text-[#000033] uppercase tracking-wide">Serviços TIM (Projeção)</h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th class="px-4 py-3 text-left font-black">Plano</th>
              <th class="px-4 py-3 text-center font-black">Qtd</th>
              <th class="px-4 py-3 text-right font-black">VR</th>
              <th class="px-4 py-3 text-center font-black">QT</th>
              <th class="px-4 py-3 text-center font-black">Fator</th>
              <th class="px-4 py-3 text-right font-black">Comissão</th>
            </tr>
          </thead>
          <tbody>${linhasServicos}</tbody>
          <tfoot class="bg-slate-50 border-t-2 border-slate-200">
            <tr>
              <td colspan="5" class="px-4 py-3 text-right text-xs font-black text-slate-600 uppercase">Subtotal Serviços</td>
              <td class="px-4 py-3 text-right font-black text-slate-800">R$ ${fmt(comissaoServicos)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    ${portabilidadeHTML}

    <div class="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-6 shadow-xl mb-6">
      ${aceleradorPortP > 0 ? `
      <div class="flex justify-between items-center pb-3 mb-3 border-b border-white/20">
        <div>
          <p class="text-[10px] font-black text-white/80 uppercase tracking-widest">Subtotal base</p>
        </div>
        <p class="text-lg font-black text-white">R$ ${fmt(totalGeralComExtras)}</p>
      </div>
      <div class="flex justify-between items-center pb-3 mb-3 border-b border-white/20">
        <div>
          <p class="text-[10px] font-black text-white/80 uppercase tracking-widest">⚡ Acelerador Portabilidade (${(fatorAcelerador * 100).toFixed(0)}%)</p>
        </div>
        <p class="text-lg font-black text-white">+ R$ ${fmt(aceleradorPortP)}</p>
      </div>` : ''}
      <div class="flex justify-between items-center">
        <div>
          <p class="text-[10px] font-black text-white/80 uppercase tracking-widest">Projeção Total a Receber</p>
          <p class="text-xs text-white/70 mt-0.5">Sujeito a alterações após conciliação</p>
        </div>
        <p class="text-3xl font-black text-white">R$ ${fmt(totalFinalP)}</p>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

window.inicializarModuloFinanceiro = function(view) {
  if (view === 'conciliacao') inicializarConciliacao();
  if (view === 'espelho')     carregarEspelho();
  if (view === 'politicas')   carregarPoliticas();
};



/* ============================================================
   POLÍTICAS DE COMISSÃO — CRUD COMPLETO
   ============================================================ */

async function carregarPoliticas() {
  const tbody = document.getElementById('politicasTbody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-slate-500">
      <svg class="animate-spin w-5 h-5 text-indigo-600 inline-block" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
      Carregando políticas...
    </td></tr>`;
  }

  try {
    // Busca TODAS as políticas (sem filtro de vigência) para exibir no painel
    const { data, error } = await supabaseClient
      .from('financeiro_politicas_b2c')
      .select('*')
      .order('categoria')
      .order('faixa_atingimento');

    if (error) throw error;

    finState.politicas.lista = data || [];
    renderizarPoliticas();
    
  } catch (err) {
    console.error('[Políticas]', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-red-500">Erro ao carregar: ${err.message}</td></tr>`;
    }
  }
}

function renderizarPoliticas() {
  const tbody = document.getElementById('politicasTbody');
  if (!tbody) return;

  if (finState.politicas.lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-slate-500">Nenhuma política cadastrada no banco.</td></tr>`;
    return;
  }

  tbody.innerHTML = finState.politicas.lista.map(p => {
    const dataVig = p.vigencia_inicio ? p.vigencia_inicio.split('-').reverse().join('/') : '—';
    const dataFim = p.vigencia_fim ? p.vigencia_fim.split('-').reverse().join('/') : 'Atual';
    
    // Transforma o objeto em string para passar no botão de editar com segurança
    const polString = encodeURIComponent(JSON.stringify(p));

    // Cores por categoria para ficar mais visual
    const corCat = {
      'SERVICO_TIM': 'bg-blue-50 text-blue-700 border-blue-200',
      'APARELHO': 'bg-emerald-50 text-emerald-700 border-emerald-200',
      'ACESSORIO': 'bg-purple-50 text-purple-700 border-purple-200'
    }[p.categoria] || 'bg-slate-50 text-slate-700 border-slate-200';

    return `<tr class="hover:bg-slate-50 transition-colors">
      <td class="px-6 py-4">
        <span class="px-2 py-1 rounded-md text-[10px] font-black border uppercase tracking-wider ${corCat}">
          ${p.categoria}
        </span>
      </td>
      <td class="px-6 py-4 text-xs font-bold text-slate-700">${p.faixa_atingimento}</td>
      <td class="px-6 py-4 text-right font-black text-[#0e8890]">${(p.fator_remuneracao * 100).toFixed(2)}%</td>
      <td class="px-6 py-4 text-xs text-slate-500">${dataVig} até ${dataFim}</td>
      <td class="px-6 py-4 text-center">
        <div class="flex justify-center gap-2">
          <button onclick="abrirModalPolitica(JSON.parse(decodeURIComponent('${polString}')))" class="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors" title="Editar">
            <i data-lucide="edit-2" class="w-4 h-4"></i>
          </button>
          <button onclick="excluirPolitica('${p.id}')" class="p-1.5 text-red-600 hover:bg-red-100 rounded-lg transition-colors" title="Excluir">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function abrirModalPolitica(politica = null) {
  document.getElementById('modalPolitica').classList.remove('hidden');
  document.getElementById('modalPoliticaContent').classList.replace('scale-95', 'scale-100');

  if (politica) {
    document.getElementById('pol_id').value = politica.id;
    document.getElementById('pol_categoria').value = politica.categoria;
    document.getElementById('pol_faixa').value = politica.faixa_atingimento;
    document.getElementById('pol_fator').value = (politica.fator_remuneracao * 100).toFixed(2);
    document.getElementById('pol_inicio').value = politica.vigencia_inicio || '';
    document.getElementById('pol_fim').value = politica.vigencia_fim || '';
  } else {
    document.getElementById('pol_id').value = '';
    document.getElementById('pol_categoria').value = 'SERVICO_TIM';
    document.getElementById('pol_faixa').value = '';
    document.getElementById('pol_fator').value = '';
    document.getElementById('pol_inicio').value = new Date().toISOString().slice(0, 10);
    document.getElementById('pol_fim').value = '';
  }
}

function fecharModalPolitica() {
  document.getElementById('modalPoliticaContent').classList.replace('scale-100', 'scale-95');
  setTimeout(() => document.getElementById('modalPolitica').classList.add('hidden'), 200);
}

async function salvarPolitica() {
  const btn = document.getElementById('btnSalvarPolitica');
  const id = document.getElementById('pol_id').value;
  const categoria = document.getElementById('pol_categoria').value;
  const faixa = document.getElementById('pol_faixa').value.toUpperCase().trim();
  const fatorInput = parseFloat(document.getElementById('pol_fator').value);
  const inicio = document.getElementById('pol_inicio').value || null;
  const fim = document.getElementById('pol_fim').value || null;

  if (!faixa || isNaN(fatorInput)) {
    return alert('Preencha a faixa e o fator corretamente.');
  }

  // Converte 15.5 (na tela) para 0.155 (no banco)
  const fator = fatorInput / 100;

  const payload = {
    categoria,
    faixa_atingimento: faixa,
    fator_remuneracao: fator,
    vigencia_inicio: inicio,
    vigencia_fim: fim
  };

  btn.disabled = true;
  btn.innerHTML = '<svg class="animate-spin w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Salvando...';

  try {
    if (id) {
      // Atualizar
      const { error } = await supabaseClient.from('financeiro_politicas_b2c').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      // Criar
      const { error } = await supabaseClient.from('financeiro_politicas_b2c').insert([payload]);
      if (error) throw error;
    }

    // Limpa o cache de políticas para o espelho puxar os dados novos
    if (typeof invalidarCachePoliticas === 'function') invalidarCachePoliticas(); 
    
    fecharModalPolitica();
    await carregarPoliticas(); 
    alert('✅ Política salva com sucesso!');

  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Salvar Política';
  }
}

async function excluirPolitica(id) {
  if (!confirm('Tem certeza que deseja excluir esta política?\n\nOs espelhos futuros não usarão mais este fator.')) return;

  try {
    const { error } = await supabaseClient.from('financeiro_politicas_b2c').delete().eq('id', id);
    if (error) throw error;

    if (typeof invalidarCachePoliticas === 'function') invalidarCachePoliticas();
    await carregarPoliticas();
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}
/* ============================================================
   EXPORTAR PDF DO ESPELHO
   ============================================================ */

async function exportarEspelhoPdf() {
  const e = finState.espelho.dados;
  const itens = finState.espelho.itens;
  const vendedor = finState.espelho.vendedor || e?.vendedor_id;

  if (!e || !vendedor) {
    alert('Nada para exportar. Abra um espelho oficial primeiro.');
    return;
  }

  const fmt = v => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  const competencia = fmtMesExtenso(e.mes_competencia_venda);

  const servicos = itens.filter(i => !['ACESSORIO','APARELHO','ACELERADOR_PORTABILIDADE'].includes(i.tipo_item));
  const acessorios = itens.filter(i => i.tipo_item === 'ACESSORIO');
  const aparelhos = itens.filter(i => i.tipo_item === 'APARELHO');
  const portabilidade = itens.filter(i => i.tipo_item === 'ACELERADOR_PORTABILIDADE');

  const meta = finState.espelho.metaInfo;
  const metaPort = meta?.metaPortabilidade || 0;
  const realPort = meta?.realizadoPortabilidade || finState.espelho.portCount || 0;
  const pctPort = metaPort > 0 ? (realPort / metaPort) * 100 : 0;
  const bateuPort = realPort >= metaPort && metaPort > 0;

  const metaFatPdf = meta?.metaFatTotal || 0;
  const realFatPdf = meta?.realizadoFatTotal || 0;
  const bateuFatPdf = metaFatPdf > 0 && realFatPdf >= metaFatPdf;
  const aceleradorPortPdf = (bateuPort && bateuFatPdf) ? (e.total_comissao_servicos || 0) * 0.15 : 0;
  const totalFinalPdf = (e.total_liquido_receber || 0) + aceleradorPortPdf;

  const agrupados = {};
  servicos.forEach(i => {
    if (!agrupados[i.tipo_item]) {
      agrupados[i.tipo_item] = {
        qtd: 0, vr: i.valor_referencia_base, qt: i.qualidade_aplicada,
        fator: i.fator_remuneracao_aplicado, total: 0
      };
    }
    agrupados[i.tipo_item].qtd += 1;
    agrupados[i.tipo_item].total += Number(i.valor_comissao_final) || 0;
  });

  const linhasServicos = Object.entries(agrupados)
    .sort(([,a], [,b]) => b.total - a.total)
    .map(([nome, d]) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;">${nome}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:11px;">${d.qtd}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:11px;">R$ ${fmt(d.vr)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:11px;">${(d.qt * 100).toFixed(2)}%</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:11px;">${(d.fator * 100).toFixed(1)}%</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:11px;font-weight:700;">R$ ${fmt(d.total)}</td>
      </tr>
    `).join('');

  let performancePdf = '';
  if (meta && meta.metaFatTotal > 0) {
    const linhas = [
      { label: 'Faturamento TIM', meta: meta.metaFatTotal, real: meta.realizadoFatTotal, tipo: 'moeda' },
      { label: 'Portabilidade', meta: meta.metaPortabilidade, real: realPort, tipo: 'numero' },
      { label: 'Aparelhos (R$)', meta: meta.metaAparelho, real: meta.realizadoAparelho, tipo: 'moeda' },
      { label: 'Acessórios (R$)', meta: meta.metaAcessorios, real: meta.realizadoAcessorios, tipo: 'moeda' }
    ].filter(l => l.meta > 0);

    const fmtL = (v, tipo) => tipo === 'moeda'
      ? 'R$ ' + Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})
      : Math.round(v||0);

    const linhasPdf = linhas.map(l => {
      const pctL = l.meta > 0 ? (l.real / l.meta) * 100 : 0;
      const cor = pctL >= 100 ? '#10b981' : pctL >= 70 ? '#f59e0b' : '#dc2626';
      const emoji = pctL >= 100 ? '✅' : pctL >= 70 ? '⚠️' : '❌';
      return `
        <tr>
          <td style="padding:6px 8px;font-size:11px;color:#334155;">${l.label}</td>
          <td style="padding:6px 8px;font-size:11px;text-align:right;color:#64748b;">${fmtL(l.meta, l.tipo)}</td>
          <td style="padding:6px 8px;font-size:11px;text-align:right;color:#0f172a;font-weight:700;">${fmtL(l.real, l.tipo)}</td>
          <td style="padding:6px 8px;font-size:11px;text-align:right;color:${cor};font-weight:900;">${emoji} ${pctL.toFixed(0)}%</td>
        </tr>`;
    }).join('');

    performancePdf = `
      <div style="font-size:12px; font-weight:900; color:#000033; text-transform:uppercase; margin-bottom:8px;">📊 Sua Performance</div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:16px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px;text-align:left;font-size:9px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">Indicador</th>
            <th style="padding:8px;text-align:right;font-size:9px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">Meta</th>
            <th style="padding:8px;text-align:right;font-size:9px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">Realizado</th>
            <th style="padding:8px;text-align:right;font-size:9px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">Ating.</th>
          </tr>
        </thead>
        <tbody>${linhasPdf}</tbody>
      </table>
    `;
  }

  let portabilidadePdf = '';
  if (metaPort > 0 || realPort > 0) {
    const estadoPdf = (bateuPort && bateuFatPdf) ? 'LIBERADO' : (!bateuPort ? 'FALTAM_PORT' : 'FALTA_FAT');
    const cores = {
      LIBERADO:    { bg: '#d1fae5', borda: '#10b981', texto: '#065f46', textoSub: '#047857' },
      FALTA_FAT:   { bg: '#dbeafe', borda: '#3b82f6', texto: '#1e40af', textoSub: '#1d4ed8' },
      FALTAM_PORT: { bg: '#f1f5f9', borda: '#cbd5e1', texto: '#475569', textoSub: '#64748b' }
    };
    const c = cores[estadoPdf];

    let msgPdf = estadoPdf === 'LIBERADO' ? `Acelerador de 15% sobre R$ ${fmt(e.total_comissao_servicos)}` : 
                 estadoPdf === 'FALTA_FAT' ? `Portabilidade batida! Falta R$ ${fmt(metaFatPdf - realFatPdf)} em faturamento` :
                 `Faltam ${metaPort - realPort} portabilidades para bater a meta`;

    portabilidadePdf = `
      <table style="width:100%; margin-top:12px; margin-bottom:6px;">
        <tr>
          <td style="background:${c.bg};padding:10px 12px;border-radius:6px;border-left:4px solid ${c.borda};">
            <div style="font-size:11px;font-weight:900;color:${c.texto};text-transform:uppercase;">⚡ Portabilidade — ${pctPort.toFixed(0)}% da meta</div>
            <div style="font-size:9px;color:${c.textoSub};margin-top:2px;">${msgPdf}</div>
          </td>
          <td style="background:${c.bg};padding:10px 12px;border-radius:6px;text-align:right;width:180px;border-right:4px solid ${c.borda};">
            <div style="font-size:9px;color:${c.textoSub};">${realPort} / ${metaPort}</div>
            <div style="font-size:15px;font-weight:900;color:${c.texto};">${estadoPdf === 'LIBERADO' ? '+ R$ ' + fmt(aceleradorPortPdf) : '—'}</div>
          </td>
        </tr>
      </table>
    `;
  }

  const hoje = new Date();
  const dataEmissao = `${String(hoje.getDate()).padStart(2,'0')}/${String(hoje.getMonth()+1).padStart(2,'0')}/${hoje.getFullYear()}`;

  const html = `
    <div style="padding:30px 40px; font-family: Arial, sans-serif; color:#1e293b; background:#fff; width:100%; box-sizing:border-box;">
      <table style="width:100%; border-bottom:3px solid #0e8890; padding-bottom:14px; margin-bottom:22px;">
        <tr>
          <td style="vertical-align:middle;">
            <img src="/LOGOINFORTECATIM2026.png" alt="Inforteca" style="height:60px; width:auto;">
          </td>
          <td style="text-align:right; vertical-align:middle;">
            <div style="font-size:10px; font-weight:bold; color:#64748b; text-transform:uppercase;">Espelho de Comissão</div>
            <div style="font-size:20px; font-weight:900; color:#000033; margin-top:4px;">${vendedor}</div>
            <div style="font-size:11px; color:#64748b; margin-top:3px;">Competência: <strong>${competencia}</strong></div>
          </td>
        </tr>
      </table>

      <table style="width:100%; margin-bottom:24px; border-collapse:separate; border-spacing:6px;">
        <tr>
          <td style="background:#f1f5f9; padding:12px; border-radius:6px; width:25%;">
            <div style="font-size:9px; color:#64748b; text-transform:uppercase; font-weight:700;">Serviços TIM</div>
            <div style="font-size:15px; font-weight:900; color:#0f172a; margin-top:4px;">R$ ${fmt(e.total_comissao_servicos)}</div>
          </td>
          <td style="background:#f1f5f9; padding:12px; border-radius:6px; width:25%;">
            <div style="font-size:9px; color:#64748b; text-transform:uppercase; font-weight:700;">Acessórios</div>
            <div style="font-size:15px; font-weight:900; color:#0f172a; margin-top:4px;">R$ ${fmt(e.total_comissao_acessorios)}</div>
          </td>
          <td style="background:#f1f5f9; padding:12px; border-radius:6px; width:25%;">
            <div style="font-size:9px; color:#64748b; text-transform:uppercase; font-weight:700;">Aparelhos</div>
            <div style="font-size:15px; font-weight:900; color:#0f172a; margin-top:4px;">R$ ${fmt(e.total_comissao_aparelhos)}</div>
          </td>
          <td style="background:#0e8890; padding:12px; border-radius:6px; width:25%;">
            <div style="font-size:9px; color:#d1fae5; text-transform:uppercase; font-weight:700;">Total a Receber</div>
            <div style="font-size:17px; font-weight:900; color:#fff; margin-top:4px;">R$ ${fmt(totalFinalPdf)}</div>
          </td>
        </tr>
      </table>

      ${performancePdf}

      <div style="font-size:12px; font-weight:900; color:#000033; text-transform:uppercase; margin-bottom:8px;">Serviços TIM</div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:16px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px;text-align:left;font-size:9px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">Plano</th>
            <th style="padding:8px;text-align:center;font-size:9px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">Qtd</th>
            <th style="padding:8px;text-align:right;font-size:9px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">VR</th>
            <th style="padding:8px;text-align:center;font-size:9px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">QT</th>
            <th style="padding:8px;text-align:center;font-size:9px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">Fator</th>
            <th style="padding:8px;text-align:right;font-size:9px;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">Comissão</th>
          </tr>
        </thead>
        <tbody>${linhasServicos}</tbody>
        <tfoot>
          <tr>
            <td colspan="5" style="padding:9px;text-align:right;font-size:10px;font-weight:900;color:#475569;border-top:2px solid #e2e8f0;">Subtotal Serviços</td>
            <td style="padding:9px;text-align:right;font-size:13px;font-weight:900;color:#0f172a;border-top:2px solid #e2e8f0;">R$ ${fmt(e.total_comissao_servicos)}</td>
          </tr>
        </tfoot>
      </table>

      ${portabilidadePdf}

      <table style="width:100%; margin-top:16px; margin-bottom:36px;">
        <tr>
          <td style="background:#000033;padding:14px 20px;border-radius:8px;">
            <table style="width:100%;">
              <tr>
                <td style="vertical-align:middle;">
                  <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;">Total Líquido a Receber</div>
                </td>
                <td style="text-align:right;vertical-align:middle;">
                  <div style="font-size:24px;font-weight:900;color:#fff;">R$ ${fmt(totalFinalPdf)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <div style="margin-top:32px; padding-top:14px; border-top:1px solid #cbd5e1; text-align:center;">
        <div style="font-size:9px; color:#64748b; line-height:1.7;">
          <strong style="color:#0f172a;">INFORTECA LTDA</strong> · CNPJ 45.765.640/0001-20<br>
          Documento gerado eletronicamente em ${dataEmissao}
        </div>
      </div>
    </div>
  `;

  const wrapper = document.createElement('div');
  wrapper.id = 'pdf-wrapper';
  wrapper.style.cssText = 'position:fixed; top:0; left:-10000px; width:210mm; background:#ffffff; padding:0; margin:0; z-index:99999;';
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  try {
    const img = wrapper.querySelector('img');
    if (img && !img.complete) {
      await new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 2000); });
    }
    await new Promise(r => setTimeout(r, 400));

    const canvas = await html2canvas(wrapper, {
      scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff', logging: false,
      width: wrapper.scrollWidth, height: wrapper.scrollHeight
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgWidth = 210;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (imgHeight <= 297) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, imgWidth, imgHeight);
    } else {
      const totalPages = Math.ceil(imgHeight / 297);
      const pxPerMm = canvas.height / imgHeight;
      for (let p = 0; p < totalPages; p++) {
        if (p > 0) pdf.addPage();
        const yStartPx = p * (297 * pxPerMm);
        const currentSliceHeightPx = Math.min(297 * pxPerMm, canvas.height - yStartPx);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = currentSliceHeightPx;
        const ctx = sliceCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, yStartPx, canvas.width, currentSliceHeightPx, 0, 0, sliceCanvas.width, sliceCanvas.height);
        pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, imgWidth, currentSliceHeightPx / pxPerMm);
      }
    }
    const nomeArquivo = `espelho-${vendedor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g, '-')}-${e.mes_competencia_venda.slice(0,7)}.pdf`;
    pdf.save(nomeArquivo);
  } catch (err) {
    console.error('[PDF]', err);
    alert('Erro ao gerar PDF: ' + err.message);
  } finally {
    if (document.body.contains(wrapper)) document.body.removeChild(wrapper);
  }
}

/* ============================================================
   REABRIR COMPETÊNCIA (Para Admin)
   ============================================================ */

async function reabrirCompetenciaEspelho(mesISO) {
  const mes = mesISO.slice(0, 7);
  if (!confirm(`⚠️ ATENÇÃO: Reabrir a competência ${fmtMes(mesISO)}?\n\nIsso APAGARÁ todos os espelhos oficiais gerados e voltará o mês para o modo "Prévia" (Aberto).\n\nVocê poderá corrigir a conciliação TIM e gerar os espelhos novamente.`)) return;

  if (!confirm(`🚨 ÚLTIMA CHANCE!\n\nTem certeza que deseja apagar os espelhos oficiais de ${fmtMes(mesISO)}?`)) return;

  try {
    const btn = event.target.closest('button');
    const htmlOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<svg class="animate-spin w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Reabrindo...';

    const { data, error } = await supabaseClient.rpc('reabrir_competencia', {
      p_mes_competencia: `${mes}-01`
    });

    if (error) throw error;

    alert(`✅ Competência reaberta com sucesso!\n\n${data.espelhos_deletados} espelho(s) oficial(is) apagado(s).\nO mês voltou para o modo de prévia.`);
    
    // Recarrega a tela do espelho para mostrar o Modo Previsão
    await carregarEspelho();

  } catch (err) {
    console.error(err);
    alert('Erro ao reabrir: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = htmlOriginal;
  }
}
