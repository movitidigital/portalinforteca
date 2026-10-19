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
    
    // Esconde o resumo se não tiver dados
    const boxResumo = document.getElementById('concResumoConsolidado');
    if (boxResumo) boxResumo.style.display = 'none';
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

  // Atualiza o estado (importante para manter a lógica, mesmo sem a tabela)
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
  atualizarCardsConciliacao(finState.conciliacao.resumo); 

    renderizarResumoConsolidado(`${mes}-01`);
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
        let gsmRaw = get(l, 'gsm', 'GSM', 'telefone', 'Telefone');
        
        if (gsmRaw === 0 || gsmRaw === '0' || gsmRaw === '-' || String(gsmRaw).trim() === '') {
            gsmRaw = null;
        }

        return {
          gsm: gsmRaw ? String(gsmRaw).trim() : '',
          cpf: String(get(l, 'cpf_cnpjcliente', 'CPF', 'cpf') || '').trim(),
          plano: String(get(l, 'plano', 'Plano') || '').trim(),
          dt_ativacao: convertDate(get(l, 'dt_ativacao', 'Data Ativação')),
          valor_pago: parseMoney(get(l, 'valorpagar', 'ValorPagar', 'valor_pago')),
          motivo_glosa: String(get(l, 'desc_tipocomissao', 'tipocomissao') || 'PAGO').trim()
        };
      })
      .filter(l => {
          const planoMaiusculo = l.plano.toUpperCase();
          const motivoMaiusculo = l.motivo_glosa.toUpperCase();

          if (planoMaiusculo.includes('PRE TOP') || planoMaiusculo.includes('PRÉ-PAGO')) {
              return false;
          }
          if (motivoMaiusculo.includes('SALDO NEGATIVO')) {
              return false;
          }
          if (planoMaiusculo.includes('OUTROS')) {
              return true; 
          }
          if (!l.gsm) {
              return false;
          }
          return true;
      });

    if (!payload.length) throw new Error('Nenhuma linha válida encontrada.');

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

    // Atualiza estado interno
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

    // 🚀 AJUSTES AQUI PARA MOSTRAR A TELA E OS CARDS
    document.getElementById('concDrop').style.display = 'none';
    document.getElementById('concCards').style.display = 'block';
    
    // 1. Preenche os cards la de cima (Linhas, Match, etc)
    atualizarCardsConciliacao(finState.conciliacao.resumo);

    // 2. Preenche o resumo de Canvass e Vendedores la embaixo
    renderizarResumoConsolidado(`${mes}-01`);

    // 3. Limpa a mensagem de "Processando..."
    status.innerHTML = '';

  } catch (err) {
    console.error('[Conciliação]', err);
    status.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm font-bold">
      ❌ ${err.message}
    </div>`;
  }
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
  
  const boxResumo = document.getElementById('concResumoConsolidado');
  if (boxResumo) boxResumo.style.display = 'none';

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
    
    // 🆕 ADICIONADO O CONTADOR DE PENDENTES
    const totalPago = data.filter(d => d.status_pagamento === 'PAGO').length;
    const totalNaoPago = data.filter(d => d.status_pagamento === 'NAO_PAGO').length;
    const totalPendente = data.filter(d => d.status_pagamento === 'PENDENTE').length; 
    const totalGlosado = data.filter(d => d.status_pagamento === 'GLOSADO').length;
    const totalEstornado = data.filter(d => d.status_pagamento === 'ESTORNADO').length;
    const totalRecebidoGeral = data.reduce((s, d) => s + (parseFloat(d.total_recebido) || 0), 0);

    const header = `
      <div class="bg-slate-100 px-6 py-3 flex flex-wrap gap-3 items-center text-xs border-b border-slate-200">
        <span class="font-black text-slate-700">${data.length} linhas vendidas</span>
        <span class="text-emerald-700 font-bold">✅ ${totalPago} pagas</span>
        ${totalNaoPago > 0 ? `<span class="text-red-700 font-bold">❌ ${totalNaoPago} não pagas</span>` : ''}
        ${totalPendente > 0 ? `<span class="text-slate-600 font-bold">⏳ ${totalPendente} pendentes</span>` : ''} <!-- 🆕 -->
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

      // 🆕 AJUSTE NA COR DA BORDA PARA O PENDENTE FICAR CINZA
      const cardBorder = v.status_pagamento === 'NAO_PAGO' ? 'border-l-red-500 bg-red-50/30'
                       : v.status_pagamento === 'GLOSADO'  ? 'border-l-orange-500 bg-orange-50/30'
                       : v.status_pagamento === 'ESTORNADO' ? 'border-l-blue-500 bg-blue-50/30'
                       : v.status_pagamento === 'PENDENTE'  ? 'border-l-slate-300 bg-slate-50/50'
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
            
            <div class="flex items-center gap-4 shrink-0">
              <div class="text-right">
                <div class="text-[10px] text-slate-400 uppercase font-bold">Total</div>
                <div class="text-base font-black ${totalCor}">R$ ${fmt(total)}</div>
              </div>
              ${badge}
              
              <button onclick="cancelarVenda('${v.interacao_id || v.id}', '${v.nome || 'Cliente'}', event)" 
                class="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg border border-red-200 transition-colors font-bold text-xs uppercase" 
                title="Cancelar esta venda">
                <i data-lucide="x" class="w-3 h-3"></i> Cancelar
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
        
        // 1. Tenta buscar dos espelhos já gerados
        const { data: vendedores } = await supabaseClient
          .from('financeiro_espelhos_b2c').select('vendedor_id').eq('mes_competencia_venda', mes).order('vendedor_id');
        let lista = (vendedores || []).map(v => v.vendedor_id);

        // 2. Se não achou espelhos, busca os vendedores que tiveram vendas no mês
        if (lista.length === 0) {
          // 🚀 CORREÇÃO: Calcula o último dia do mês corretamente (ex: Setembro = 30, Fevereiro = 28/29)
          const [anoStr, mesStr] = competencia.split('-');
          const ultimoDia = new Date(Number(anoStr), Number(mesStr), 0).getDate();
          const dataFimMes = `${competencia}-${String(ultimoDia).padStart(2, '0')}`;

          const { data: inter } = await supabaseClient
            .from('interacoes')
            .select('vendedor')
            .gte('data_venda', mes)
            .lte('data_venda', dataFimMes);
            
          lista = [...new Set((inter || []).map(i => i.vendedor))]
            .filter(v => v && !v.includes('CAIXA') && !v.includes('INFORTECA LTDA'))
            .sort();
        }

        if (lista.length) {
          selectVend.innerHTML = lista.map(v => `<option value="${v}">${v}</option>`).join('');
        } else {
          selectVend.innerHTML = '<option value="">— Sem dados —</option>';
        }

        const nomeUser = (state.perfil?.nome_completo || '').toUpperCase();
        if (Array.from(selectVend.options).some(o => o.value === nomeUser)) {
          selectVend.value = nomeUser;
        }
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

        // LÓGICA DE ACESSÓRIOS M+1 (Competência D+2)
        let realizadoAcessorios = 0;
        try {
          const [anoComp, mesComp] = competencia.split('-');
          let proxAno = parseInt(anoComp);
          let proxMes = parseInt(mesComp) + 1;
          if (proxMes > 12) { proxMes = 1; proxAno++; }
          
          const compAcessorios = `${proxAno}-${String(proxMes).padStart(2, '0')}`;
          const nomeMesAcessA = formatarMesMeta(compAcessorios);
          const nomeMesAcessB = nomeMesAcessA.replace('/', ' / ');
          
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
          <div class="mt-1">
            ${portEstado === 'FALTAM_PORT' 
              ? `<p class="text-sm font-bold text-slate-700">Faltaram <strong>${metaPort - realPort}</strong> portabilidade${(metaPort - realPort) > 1 ? 's' : ''} para bater a meta.</p>
                 <p class="text-xs text-red-500 font-medium mt-1">Por este motivo, o Acelerador de 15% não foi aplicado.</p>`
              : portEstado === 'FALTA_FAT' 
                ? `<p class="text-sm font-bold text-white">✅ Portabilidade batida!</p>
                   <p class="text-xs text-white/90 font-medium mt-1">Faltaram <strong>R$ ${fmt(faltaFatPort)}</strong> em faturamento.</p>
                   <p class="text-[11px] text-blue-100 font-medium mt-0.5">Como o acelerador está atrelado ao faturamento, o bônus não foi aplicado.</p>`
                : `<p class="text-sm font-bold text-white">🎉 Meta batida! Acelerador de <strong>15%</strong> aplicado</p>`
            }
          </div>
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
    // 🚀 CORRIGIDO: Usando portEstadoP em vez de portEstado
    if (portEstadoP === 'FALTAM_PORT') {
      portabilidadeHTML = `
        <div class="rounded-2xl p-5 mb-6 shadow-md bg-white border border-slate-200">
          <div class="flex justify-between items-center">
            <div class="flex-1 min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-slate-500">⚡ Portabilidade — ${pctPort.toFixed(0)}% da meta</p>
              <p class="text-sm font-bold mt-1 text-slate-700">Faltaram <strong>${metaPort - realPort}</strong> portabilidade${(metaPort - realPort) > 1 ? 's' : ''} para bater a meta.</p>
              <p class="text-xs text-red-500 font-medium mt-1">Por este motivo, o Acelerador de 15% não foi aplicado.</p>
            </div>
          </div>
        </div>`;
    } else if (portEstadoP === 'FALTA_FAT') {
      portabilidadeHTML = `
        <div class="rounded-2xl p-5 mb-6 shadow-md bg-gradient-to-r from-blue-500 to-blue-600">
          <div class="flex justify-between items-center">
            <div class="flex-1 min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-white/90">⚡ Portabilidade — 🎯 meta batida!</p>
              <p class="text-sm font-bold mt-1 text-white">A portabilidade foi batida, mas faltou <strong>faturamento</strong>.</p>
              <p class="text-[11px] text-white/90 mt-1">Faltaram <strong>${fmtR(faltaFatPortP)}</strong> em faturamento para liberar o Acelerador.</p>
            </div>
          </div>
        </div>`;
    } else if (portEstadoP === 'LIBERADO') {
      portabilidadeHTML = `
        <div class="rounded-2xl p-5 mb-6 shadow-md bg-gradient-to-r from-emerald-500 to-emerald-600">
          <div class="flex justify-between items-center">
            <div class="flex-1 min-w-0">
              <p class="text-[10px] font-black uppercase tracking-widest text-white/90">⚡ Portabilidade — 🎉 ACELERADOR LIBERADO</p>
              <p class="text-sm font-bold mt-1 text-white">Bônus de <strong>15%</strong> aplicado sobre a comissão de serviços.</p>
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

/* ==========================================================
   MÓDULO FINANCEIRO - CONTROLE DE ACESSO E RENDERIZAÇÃO
   ========================================================== */
window.inicializarModuloFinanceiro = function(view) {
  if (view === 'conciliacao') inicializarConciliacao();
  if (view === 'espelho')     carregarEspelho();
  
  if (view === 'politicas') {
    const isAdmin = state._isAdmin === true;
    
    // Alterna a visão baseada no cargo do usuário
    document.getElementById('adminPoliticasView').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('consultorPoliticasView').style.display = isAdmin ? 'none' : 'block';
    
    if (isAdmin) {
      carregarPoliticas(); 
    } else {
      carregarDocumentoPolitica();
    }
  }
};

/* ==========================================================
   ADMIN: POLÍTICAS AGRUPADAS E CRUD
   ========================================================== */
function renderizarPoliticas() {
  const container = document.getElementById('politicasTbody');
  if (!container) return;

  if (finState.politicas.lista.length === 0) {
    container.innerHTML = `<div class="text-center py-12 text-slate-500 bg-white rounded-2xl border border-slate-200">Nenhuma regra cadastrada no banco.</div>`;
    return;
  }

  // Agrupar por vigência
  const grupos = {};
  finState.politicas.lista.forEach(p => {
    const chave = `${p.vigencia_inicio}_${p.vigencia_fim}`;
    if (!grupos[chave]) {
      grupos[chave] = { inicio: p.vigencia_inicio, fim: p.vigencia_fim, regras: [] };
    }
    grupos[chave].regras.push(p);
  });

  // Ordenar as vigências (mais recentes primeiro)
  const gruposOrdenados = Object.values(grupos).sort((a, b) => new Date(b.inicio) - new Date(a.inicio));

  // Renderizar cada caixinha diretamente no container
  container.innerHTML = gruposOrdenados.map(g => {
    const dataVig = g.inicio ? g.inicio.split('-').reverse().join('/') : '—';
    const dataFim = g.fim ? g.fim.split('-').reverse().join('/') : 'Atual';
    const isAtual = !g.fim;

    return `
      <div class="bg-white rounded-2xl border ${isAtual ? 'border-emerald-200 shadow-md' : 'border-slate-200 shadow-sm'} overflow-hidden">
        <div class="px-6 py-4 ${isAtual ? 'bg-emerald-50' : 'bg-slate-50'} border-b border-slate-100 flex justify-between items-center">
          <h3 class="text-sm font-black text-[#000033] flex items-center gap-2 uppercase tracking-wide">
            <i data-lucide="calendar" class="w-4 h-4 ${isAtual ? 'text-emerald-600' : 'text-slate-500'}"></i>
            Vigência: ${dataVig} até ${dataFim}
          </h3>
          ${isAtual ? `<span class="bg-emerald-100 text-emerald-800 text-[10px] font-black px-3 py-1 rounded-full border border-emerald-200 uppercase">Regras Ativas</span>` : ''}
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm text-left whitespace-nowrap">
            <thead class="bg-white text-[10px] uppercase text-slate-400 border-b border-slate-100">
              <tr>
                <th class="px-6 py-3 font-black">Categoria</th>
                <th class="px-6 py-3 font-black">Faixa</th>
                <th class="px-6 py-3 font-black text-right">Fator</th>
                <th class="px-6 py-3 font-black text-center">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${g.regras.map(p => {
                const corCat = {
                  'SERVICO_TIM': 'bg-blue-50 text-blue-700 border-blue-200',
                  'APARELHO': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  'ACESSORIO': 'bg-purple-50 text-purple-700 border-purple-200'
                }[p.categoria] || 'bg-slate-50 text-slate-700 border-slate-200';

                const polString = encodeURIComponent(JSON.stringify(p));

                return `<tr class="hover:bg-slate-50 transition-colors">
                  <td class="px-6 py-4">
                    <span class="px-2 py-1 rounded-md text-[10px] font-black border uppercase tracking-wider ${corCat}">${p.categoria}</span>
                  </td>
                  <td class="px-6 py-4 text-xs font-bold text-slate-700">${p.faixa_atingimento}</td>
                  <td class="px-6 py-4 text-right font-black text-[#0e8890]">${(p.fator_remuneracao * 100).toFixed(2)}%</td>
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
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function salvarPolitica() {
  const btn = document.getElementById('btnSalvarPolitica');
  const id = document.getElementById('pol_id').value;
  const categoria = document.getElementById('pol_categoria').value;
  const faixa = document.getElementById('pol_faixa').value.toUpperCase().trim();
  const fatorInput = parseFloat(document.getElementById('pol_fator').value);
  const inicio = document.getElementById('pol_inicio').value || null;
  const fim = document.getElementById('pol_fim').value || null;

  if (!faixa || isNaN(fatorInput) || !inicio) {
    return alert('Preencha a faixa, o fator e a data de início corretamente.');
  }

  const fator = fatorInput / 100;
  const payload = { categoria, faixa_atingimento: faixa, fator_remuneracao: fator, vigencia_inicio: inicio, vigencia_fim: fim };

  btn.disabled = true;
  btn.innerHTML = '<svg class="animate-spin w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Salvando...';

  try {
    // Se for uma nova política sem data de fim, encerra a anterior
    if (!id && !fim) {
      const dataInicioObj = new Date(inicio + 'T12:00:00');
      dataInicioObj.setDate(dataInicioObj.getDate() - 1);
      const diaAnterior = dataInicioObj.toISOString().split('T')[0];

      const { data: ativa } = await supabaseClient
        .from('financeiro_politicas_b2c')
        .select('id')
        .eq('categoria', categoria)
        .eq('faixa_atingimento', faixa)
        .is('vigencia_fim', null)
        .maybeSingle();

      if (ativa) {
        await supabaseClient.from('financeiro_politicas_b2c').update({ vigencia_fim: diaAnterior }).eq('id', ativa.id);
      }
    }

    if (id) {
      const { error } = await supabaseClient.from('financeiro_politicas_b2c').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabaseClient.from('financeiro_politicas_b2c').insert([payload]);
      if (error) throw error;
    }

    if (typeof invalidarCachePoliticas === 'function') invalidarCachePoliticas(); 
    fecharModalPolitica();
    await carregarPoliticas(); 
    alert('✅ Política salva e vigências atualizadas com sucesso!');

  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Salvar Política';
  }
}

/* ==========================================================
   ADMIN: GERENCIAR TERMO DE POLÍTICA
   ========================================================== */
async function abrirModalDocumento() {
  const { data } = await supabaseClient.from('politicas_documentos').select('*').is('vigencia_fim', null).maybeSingle();

  document.getElementById('doc_titulo').value = data?.titulo || 'Política de Comissionamento - Retail Dealer';
  document.getElementById('doc_inicio').value = data?.vigencia_inicio || new Date().toISOString().split('T')[0];

  // 🚀 PUXA A BASE DE REMUNERAÇÃO DINAMICAMENTE
  const { data: planos } = await supabaseClient
    .from('financeiro_base_remuneracao')
    .select('*')
    .eq('ativo', true)
    .order('nome_plano');

  const listaPlanosFormatada = (planos || []).map(p => 
    `- ${p.nome_plano}: R$ ${Number(p.valor_referencia).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
  ).join('\n');

  const templatePadrao = `1. OBJETIVO
A presente Política de Comissionamento tem por objetivo estabelecer os critérios para remuneração variável dos Consultores de Vendas da Loja TIM Dom José, promovendo transparência, meritocracia e incentivo ao desempenho comercial.

Esta política busca incentivar:
- Atingimento das metas individuais e da loja;
- Comercialização de produtos de maior valor agregado;
- Excelência na qualidade das vendas;
- Crescimento das portabilidades;
- Sustentabilidade dos resultados.

2. ABRANGÊNCIA
Esta política aplica-se aos Consultores de Vendas do Canal Revendas – Retail Dealer da Loja TIM Dom José.

3. BASE DE REMUNERAÇÃO
A comissão será calculada utilizando como base a Tabela Oficial de Referência de Remuneração dos Serviços da TIM:
${listaPlanosFormatada}

4. INDICADORES DE QUALIDADE
O pagamento estará condicionado ao desempenho de qualidade (safra TIM – 6 meses anteriores).
- Qualidade Controle: Índice percentual de qualidade das vendas dos produtos Controle.
- Qualidade Pós: Índice percentual de qualidade das vendas dos produtos Pós-Pago (TIM Black).
Os indicadores serão apurados mensalmente e aplicados sobre o valor da comissão.

5. FAIXAS DE REMUNERAÇÃO
Após a venda, será aplicada uma faixa de remuneração:
- Ativou Ganhou: venda efetivada.
- Meta Pessoal: atingimento da meta individual.
- Meta Loja: atingimento da meta coletiva.
Os percentuais serão aplicados sobre o valor de referência do serviço vendido.

6. CÁLCULO DA COMISSÃO
Etapa 1: Comissão Base = Valor de Referência × Percentual da Faixa
Etapa 2: Comissão Final = Comissão Base × Índice de Qualidade
Exemplo 1 (Controle): TIM Controle Plus (R$ 75,00) × Meta Pessoal (30%) = R$ 22,50. Aplicando qualidade de 85% = R$ 19,13.
Exemplo 2 (Pós): TIM Black Premium (R$ 160,00) × Meta Loja (40%) = R$ 64,00. Aplicando qualidade de 85% = R$ 54,40.

7. ACELERADOR DE PORTABILIDADE
O consultor que atingir a meta mensal de Portabilidade receberá um adicional de 15% sobre o valor total da comissão de faturamento de serviços apurada no período.

8. COMISSÃO PARA VENDAS SMB
Vendas Controle via sistema SMB geram remuneração fixa de R$ 10,00 por venda. Estas vendas não entram no cálculo de metas individuais ou da loja.

9. CRITÉRIOS PARA RECEBIMENTO, ESTORNOS E FRAUDES
Para fazer jus ao pagamento, o consultor deve cumprir os processos, possuir vendas válidas e atender aos indicadores de qualidade.
A empresa poderá realizar estornos em casos de cancelamento, fraude, irregularidade documental ou descumprimento dos processos.
Constatada fraude, o colaborador perderá o direito à comissão referente às vendas envolvidas, sem prejuízo das medidas disciplinares.

10. VIGÊNCIA
Esta Política entra em vigor na data de sua aprovação, revogando quaisquer políticas anteriores relacionadas ao comissionamento.`;

  document.getElementById('doc_conteudo').value = data?.conteudo || templatePadrao;
  document.getElementById('modalDocumento').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

/* ==========================================================
   ADMIN: GERENCIAR BASE DE REMUNERAÇÃO
   ========================================================== */
async function abrirModalBaseRemuneracao() {
  document.getElementById('modalBaseRemuneracao').classList.remove('hidden');
  carregarBaseRemuneracao();
}

function fecharModalBaseRemuneracao() {
  document.getElementById('modalBaseRemuneracao').classList.add('hidden');
}

async function carregarBaseRemuneracao() {
  const tbody = document.getElementById('tabelaBaseRemuneracao');
  tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-slate-400">Carregando...</td></tr>';

  const { data, error } = await supabaseClient
    .from('financeiro_base_remuneracao')
    .select('*')
    .order('nome_plano');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-8 text-center text-red-500">Erro: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-slate-400">Nenhum plano cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(p => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="px-4 py-3 text-sm font-bold text-slate-700">${escapeHTML(p.nome_plano)}</td>
      <td class="px-4 py-3 text-sm font-black text-emerald-700 text-right">
        R$ ${Number(p.valor_referencia).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
      </td>
      <td class="px-4 py-3 text-center">
        <span class="inline-block px-2 py-1 rounded text-[10px] font-bold border uppercase ${p.ativo ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}">
          ${p.ativo ? 'Ativo' : 'Inativo'}
        </span>
      </td>
      <td class="px-4 py-3 text-center">
        <div class="flex justify-center gap-2">
          <button onclick="abrirModalPlanoRemuneracao('${p.id}')" class="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors" title="Editar">
            <i data-lucide="edit-2" class="w-4 h-4"></i>
          </button>
          <button onclick="excluirPlanoRemuneracao('${p.id}')" class="p-1.5 text-red-600 hover:bg-red-100 rounded-lg transition-colors" title="Excluir">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

let _planoEditandoId = null;

async function abrirModalPlanoRemuneracao(id = null) {
  _planoEditandoId = id;
  
  if (id) {
    const { data } = await supabaseClient.from('financeiro_base_remuneracao').select('*').eq('id', id).single();
    if (data) {
      document.getElementById('mpTitulo').textContent = 'Editar Plano';
      document.getElementById('mpId').value = data.id;
      document.getElementById('mpNome').value = data.nome_plano;
      document.getElementById('mpValor').value = data.valor_referencia;
      document.getElementById('mpAtivo').value = data.ativo.toString();
    }
  } else {
    document.getElementById('mpTitulo').textContent = 'Novo Plano';
    document.getElementById('mpId').value = '';
    document.getElementById('mpNome').value = '';
    document.getElementById('mpValor').value = '';
    document.getElementById('mpAtivo').value = 'true';
  }

  document.getElementById('modalPlano').classList.remove('hidden');
  document.getElementById('mpNome').focus();
}

function fecharModalPlano() {
  document.getElementById('modalPlano').classList.add('hidden');
}

async function salvarPlanoRemuneracao() {
  const id = document.getElementById('mpId').value;
  const nome = document.getElementById('mpNome').value.trim();
  const valor = parseFloat(document.getElementById('mpValor').value);
  const ativo = document.getElementById('mpAtivo').value === 'true';

  if (!nome || isNaN(valor)) {
    return alert('Preencha o nome e o valor corretamente.');
  }

  const payload = { nome_plano: nome, valor_referencia: valor, ativo };

  try {
    if (id) {
      const { error } = await supabaseClient.from('financeiro_base_remuneracao').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabaseClient.from('financeiro_base_remuneracao').insert([payload]);
      if (error) throw error;
    }
    
    fecharModalPlano();
    carregarBaseRemuneracao();
  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
  }
}

async function excluirPlanoRemuneracao(id) {
  if (!confirm('⚠️ Excluir este plano da base de remuneração?')) return;

  try {
    const { error } = await supabaseClient.from('financeiro_base_remuneracao').delete().eq('id', id);
    if (error) throw error;
    carregarBaseRemuneracao();
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}

function fecharModalDocumento() {
  document.getElementById('modalDocumento').classList.add('hidden');
}

async function salvarDocumento() {
  const btn = document.getElementById('btnSalvarDoc');
  const titulo = document.getElementById('doc_titulo').value.trim();
  const inicio = document.getElementById('doc_inicio').value;
  const conteudo = document.getElementById('doc_conteudo').value.trim();

  if (!titulo || !inicio || !conteudo) return alert('Preencha todos os campos do termo.');

  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Publicando...';

  try {
    const dataInicioObj = new Date(inicio + 'T12:00:00');
    dataInicioObj.setDate(dataInicioObj.getDate() - 1);
    const diaAnterior = dataInicioObj.toISOString().split('T')[0];

    // Encerra documento ativo anterior
    await supabaseClient.from('politicas_documentos').update({ vigencia_fim: diaAnterior, ativo: false }).is('vigencia_fim', null);

    // Insere novo
    const { error } = await supabaseClient.from('politicas_documentos').insert({ titulo, conteudo, vigencia_inicio: inicio });
    if (error) throw error;

    alert('✅ Termo publicado com sucesso! Os consultores deverão assinar.');
    fecharModalDocumento();
  } catch (err) {
    alert('Erro ao publicar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i> Publicar Termo';
    if (window.lucide) lucide.createIcons();
  }
}

/* ==========================================================
   CONSULTOR: VISUALIZAR, ACEITAR E BAIXAR PDF
   ========================================================== */
async function carregarDocumentoPolitica() {
  const container = document.getElementById('documentoPoliticaConteudo');
  container.innerHTML = '<div class="text-center py-12 text-slate-500"><i data-lucide="loader-2" class="w-6 h-6 animate-spin inline-block"></i> Carregando termo...</div>';

  const { data: doc } = await supabaseClient.from('politicas_documentos').select('*').is('vigencia_fim', null).maybeSingle();

  if (!doc) {
    container.innerHTML = '<div class="text-center py-12 text-slate-500">Nenhuma política ativa no momento.</div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  const { data: aceite } = await supabaseClient.from('politicas_aceites').select('*').eq('politica_id', doc.id).eq('user_id', state.user.id).maybeSingle();
  const dataVig = new Date(doc.vigencia_inicio + 'T12:00:00').toLocaleDateString('pt-BR');

  container.innerHTML = `
    <div id="documentoA4" class="bg-white rounded-2xl border border-slate-300 shadow-xl p-8 md:p-14 relative w-full">
      <!-- Cabeçalho -->
      <div class="text-center border-b-4 border-[#000033] pb-6 mb-8">
        <h2 class="text-3xl font-black text-[#000033] tracking-tighter uppercase">INFORTECA LTDA</h2>
        <p class="text-sm font-bold text-slate-600 mt-1">CNPJ: 45.765.640/0001-20</p>
        <p class="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Loja TIM Dom José</p>
      </div>
      
      <h1 class="text-xl font-black text-center uppercase mb-2">${escapeHTML(doc.titulo)}</h1>
      <p class="text-xs text-center text-slate-500 mb-10 uppercase tracking-widest font-bold">Vigência a partir de: ${dataVig}</p>

      <!-- Conteúdo -->
      <div class="text-sm text-slate-800 leading-relaxed mb-12 text-justify whitespace-pre-wrap font-medium">${escapeHTML(doc.conteudo)}</div>

      <!-- Área de Assinatura -->
      <div class="mt-16 pt-8 border-t-2 border-slate-200">
        <h3 class="text-sm font-black uppercase text-center mb-6">Aceite do Colaborador</h3>
        ${aceite ? `
          <div class="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-6 text-center max-w-lg mx-auto">
            <i data-lucide="check-circle-2" class="w-10 h-10 text-emerald-600 mx-auto mb-3"></i>
            <p class="font-black text-emerald-800 text-lg uppercase">Documento Assinado Digitalmente</p>
            <p class="text-sm text-emerald-700 mt-2">Assinado por <strong>${escapeHTML(aceite.nome_completo)}</strong></p>
            <p class="text-xs text-emerald-600 font-mono mt-1">CPF: ${aceite.cpf}</p>
            <p class="text-xs text-emerald-600 mt-2">Data/Hora: ${new Date(aceite.aceito_em).toLocaleString('pt-BR')}</p>
            <button onclick="exportarPdfAceite()" class="mt-6 bg-[#000033] text-white hover:bg-slate-800 px-6 py-3 rounded-lg text-xs font-black uppercase shadow-lg flex items-center justify-center gap-2 mx-auto transition-transform hover:scale-105">
              <i data-lucide="download" class="w-4 h-4"></i> Baixar PDF Assinado
            </button>
          </div>
        ` : `
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-lg mx-auto">
            <div>
              <label class="block text-[10px] font-black text-slate-500 uppercase mb-1">Nome Completo</label>
              <input type="text" id="aceite_nome" value="${escapeHTML(state.perfil?.nome_completo || '')}" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-[#0e8890]">
            </div>
            <div>
              <label class="block text-[10px] font-black text-slate-500 uppercase mb-1">CPF</label>
              <input type="text" id="aceite_cpf" maxlength="11" placeholder="Somente números" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-[#0e8890]">
            </div>
          </div>
          <div class="max-w-lg mx-auto mt-6">
            <button onclick="registrarAceite('${doc.id}')" id="btnAceitar" class="w-full bg-[#0e8890] hover:bg-[#0b6c72] text-white py-3 rounded-xl font-black uppercase tracking-wide shadow-md transition-colors flex items-center justify-center gap-2">
              <i data-lucide="pen-tool" class="w-5 h-5"></i> Assinar e Aceitar Termo
            </button>
            <p class="text-[10px] text-slate-400 text-center mt-3">Ao clicar, você declara estar de acordo com as regras acima.</p>
          </div>
        `}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

async function registrarAceite(politicaId) {
  const btn = document.getElementById('btnAceitar');
  const nome = document.getElementById('aceite_nome').value.trim();
  const cpf = document.getElementById('aceite_cpf').value.replace(/\D/g, '');

  if (!nome || cpf.length !== 11) return alert('Preencha seu nome completo e um CPF válido (11 dígitos).');

  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Processando...';

  try {
    const { error } = await supabaseClient.from('politicas_aceites').insert({ politica_id: politicaId, user_id: state.user.id, nome_completo: nome, cpf: cpf });
    if (error) {
      if (error.code === '23505') throw new Error('Você já assinou este documento.');
      throw error;
    }
    await carregarDocumentoPolitica();
  } catch (err) {
    alert('Erro: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="pen-tool" class="w-5 h-5"></i> Assinar e Aceitar Termo';
    if (window.lucide) lucide.createIcons();
  }
}

function exportarPdfAceite() {
  const element = document.getElementById('documentoA4');
  if (!element) return;

  const opt = {
    margin:       10,
    filename:     `Politica_Comissao_Inforteca_${new Date().getTime()}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  const btn = element.querySelector('button');
  if (btn) btn.style.display = 'none';

  html2pdf().set(opt).from(element).save().then(() => {
    if (btn) btn.style.display = 'flex';
  });
}


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

  if (!faixa || isNaN(fatorInput) || !inicio) {
    return alert('Preencha a faixa, o fator e a data de início corretamente.');
  }

  const fator = fatorInput / 100;
  const payload = { categoria, faixa_atingimento: faixa, fator_remuneracao: fator, vigencia_inicio: inicio, vigencia_fim: fim };

  btn.disabled = true;
  btn.innerHTML = '<svg class="animate-spin w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Salvando...';

  try {
    // 🚀 LÓGICA DE ENCERRAMENTO AUTOMÁTICO
    // Se estamos criando uma NOVA política (sem ID) e não colocamos data de fim
    if (!id && !fim) {
      // Calcula o dia anterior ao início da nova política
      const dataInicioObj = new Date(inicio + 'T12:00:00'); // T12 evita problemas de fuso
      dataInicioObj.setDate(dataInicioObj.getDate() - 1);
      const diaAnterior = dataInicioObj.toISOString().split('T')[0];

      // Procura a política ativa (vigencia_fim = null) da mesma categoria e faixa
      const { data: ativa, error: errBusca } = await supabaseClient
        .from('financeiro_politicas_b2c')
        .select('id')
        .eq('categoria', categoria)
        .eq('faixa_atingimento', faixa)
        .is('vigencia_fim', null)
        .maybeSingle();

      if (errBusca) throw errBusca;

      // Se achou uma política ativa, encerra ela na data calculada
      if (ativa) {
        const { error: errClose } = await supabaseClient
          .from('financeiro_politicas_b2c')
          .update({ vigencia_fim: diaAnterior })
          .eq('id', ativa.id);
          
        if (errClose) throw errClose;
        console.log(`[Políticas] Política anterior (${ativa.id}) encerrada em ${diaAnterior}`);
      }
    }

    // Agora insere ou atualiza a nova política
    if (id) {
      const { error } = await supabaseClient.from('financeiro_politicas_b2c').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabaseClient.from('financeiro_politicas_b2c').insert([payload]);
      if (error) throw error;
    }

    // Limpa o cache de políticas para o espelho puxar os dados novos
    if (typeof invalidarCachePoliticas === 'function') invalidarCachePoliticas(); 
    
    fecharModalPolitica();
    await carregarPoliticas(); 
    alert('✅ Política salva e vigências atualizadas com sucesso!');

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

    // 🚀 AJUSTE DO TEXTO NO PDF (PASSADO)
    let msgPdf = '';
    if (estadoPdf === 'LIBERADO') {
      msgPdf = `Acelerador de 15% aplicado sobre R$ ${fmt(e.total_comissao_servicos)}`;
    } else if (estadoPdf === 'FALTA_FAT') {
      msgPdf = `Portabilidade batida! Faltaram R$ ${fmt(metaFatPdf - realFatPdf)} em faturamento. Acelerador não aplicado.`;
    } else {
      msgPdf = `Faltaram ${metaPort - realPort} portabilidade${(metaPort - realPort) > 1 ? 's' : ''} para bater a meta. Acelerador não aplicado.`;
    }

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
/* ============================================================
   CANCELAR VENDA (Ocultar do Espelho)
   ============================================================ */
async function cancelarVenda(id, nomeCliente, event) {
  if (!id) {
    alert('Erro: ID da venda não encontrado.');
    return;
  }

  // 🛡️ PROTEÇÃO: Verifica se o ID é um UUID válido (tem 36 caracteres)
  if (id.length < 30) {
    alert(`⚠️ Erro de Integração:\n\nO sistema recebeu o ID "${id}", mas a tabela de vendas usa um código UUID longo.\n\nPrecisamos ajustar a RPC "listar_vendas_consolidadas" no banco para enviar o ID correto.`);
    return;
  }

  if (!confirm(`⚠️ Deseja realmente cancelar a venda de ${nomeCliente}?\n\nEla será mantida no histórico, mas não pagará comissão.`)) {
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('interacoes')
      .update({ conciliacao_status: 'CANCELADO_CLIENTE' })
      .eq('id', id);

    if (error) throw error;

    if (typeof mostrarToastCopy === 'function') {
      mostrarToastCopy('Venda cancelada com sucesso!');
    }

    if (event && event.target) {
      const btn = event.target.closest('button');
      const card = btn.closest('div.border');
      
      if (card) {
        card.style.opacity = '0.6';
        card.style.background = '#f8fafc';
        
        const badgeContainer = card.querySelector('.flex.items-center.gap-4');
        if (badgeContainer) {
          badgeContainer.innerHTML = `<span class="px-2 py-1 rounded text-xs font-black bg-slate-200 text-slate-600 border border-slate-300">🚫 CANCELADO</span>`;
        }

        btn.disabled = true;
        btn.innerHTML = 'Cancelado';
        btn.className = 'flex items-center gap-1 bg-slate-100 text-slate-400 px-3 py-1.5 rounded-lg border border-slate-200 font-bold text-xs uppercase cursor-not-allowed';
      }
    }
    
  } catch (err) {
    console.error('[Cancelar Venda]', err);
    alert('Erro ao cancelar venda: ' + err.message);
  }
}
/* ==========================================================
   RESUMO CONSOLIDADO DA CONCILIAÇÃO TIM (KPIs e Vendedores)
   ========================================================== */
async function renderizarResumoConsolidado(mesCompetencia) {
  const boxResumo = document.getElementById('concResumoConsolidado');
  const listKpi = document.getElementById('concKpiList');
  const listVendedor = document.getElementById('concVendedorList');
  
  if (!boxResumo || !listKpi || !listVendedor || !mesCompetencia) return;

  try {
    // Passa o mês (ex: '2026-08') para o banco
    const { data, error } = await supabaseClient.rpc('obter_resumo_espelho_tim', {
      p_mes_competencia: mesCompetencia
    });

    if (error) throw error;

    // Se não houver dados, esconde o bloco
    if (!data || (!data.kpis?.length && !data.vendedores?.length)) {
      boxResumo.style.display = 'none';
      return;
    }

    boxResumo.style.display = 'grid'; // Mostra os blocos

    const fmtMoeda = (val) => Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const getCor = (val) => val >= 0 ? 'text-emerald-600' : 'text-red-600';

    // 1. Renderiza KPIs (Canvass)
    listKpi.innerHTML = (data.kpis || []).map(k => `
      <div class="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-100 hover:bg-slate-100 transition-colors">
        <span class="text-sm font-semibold text-slate-700">${k.tipo}</span>
        <span class="font-black ${getCor(k.total)}">${fmtMoeda(k.total)}</span>
      </div>
    `).join('');

    // 2. Renderiza Vendedores
    listVendedor.innerHTML = (data.vendedores || []).map(v => `
      <div class="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-100 hover:bg-slate-100 transition-colors">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center text-[10px] font-black text-teal-700 uppercase">
            ${v.vendedor.substring(0, 2)}
          </div>
          <span class="text-sm font-semibold text-slate-700 uppercase">${v.vendedor}</span>
        </div>
        <span class="font-black ${getCor(v.total)}">${fmtMoeda(v.total)}</span>
      </div>
    `).join('');

    lucide.createIcons();

  } catch (err) {
    console.error('[Resumo Consolidado] Erro:', err);
    // 🚨 MOSTRA O ERRO NA TELA SE FALHAR
    boxResumo.style.display = 'block';
    boxResumo.innerHTML = `
      <div class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm font-bold">
        ❌ Erro ao carregar o resumo: ${err.message}
      </div>
    `;
  }
}
function atualizarCardsConciliacao(resumo) {
  if (!resumo) return;
  
  const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const elLinhas = document.getElementById('concCardLinhas');
  const elMatch = document.getElementById('concCardMatch');
  const elDiverge = document.getElementById('concCardDiverge');
  const elGlosa = document.getElementById('concCardGlosa');
  const elTotal = document.getElementById('concCardTotal');

  if (elLinhas) elLinhas.textContent = resumo.processado || 0;
  if (elMatch) elMatch.textContent = resumo.match || 0;
  if (elDiverge) elDiverge.textContent = resumo.divergencia || 0;
  if (elGlosa) elGlosa.textContent = resumo.glosas || 0;
  if (elTotal) elTotal.textContent = 'R$ ' + fmt(resumo.totalPago);
}
/* ==========================================================
   GERAR ESPELHOS DO MÊS (Consolidação Oficial)
   ========================================================== */
async function gerarEspelhosCompetencia() {
  const mes = document.getElementById('concMes').value;
  if (!mes) return alert('Selecione uma competência primeiro.');
  if (!confirm('Gerar espelhos oficiais? Isso salvará a comissão exata de todos os vendedores.')) return;

  const btn = document.getElementById('concBtnGerarEspelhos');
  const original = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Gerando...';
  btn.disabled = true;
  lucide.createIcons();

  try {
    const { data: conc, error: concErr } = await supabaseClient
      .from('financeiro_conciliacao_tim')
      .select('interacao_id')
      .eq('mes_competencia', `${mes}-01`)
      .eq('status_conciliacao', 'MATCH_PERFEITO');

    if (concErr) throw new Error('Erro ao buscar conciliação: ' + concErr.message);
    if (!conc || conc.length === 0) throw new Error('Nenhuma venda com MATCH encontrada para este mês.');

    const interacaoIds = [...new Set(conc.map(c => c.interacao_id).filter(Boolean))];
    if (interacaoIds.length === 0) throw new Error('As vendas conciliadas estão sem vínculo com interações.');

    const { data: interacoes, error: interErr } = await supabaseClient
      .from('interacoes')
      .select('id, vendedor')
      .in('id', interacaoIds);

    if (interErr) throw new Error('Erro ao buscar vendedores: ' + interErr.message);
    const vendedores = [...new Set(interacoes.map(i => i.vendedor).filter(Boolean))];
    if (vendedores.length === 0) throw new Error('Nenhum vendedor encontrado para as vendas conciliadas.');

    const [ano, m] = mes.split('-');
    const nomeMesA = formatarMesMeta(mes);
    const nomeMesB = nomeMesA.replace('/', ' / ');
    let { data: metaData } = await supabaseClient.from('metas_mensais').select('dados').eq('mes', nomeMesA).maybeSingle();
    if (!metaData) {
      const { data: alt } = await supabaseClient.from('metas_mensais').select('dados').eq('mes', nomeMesB).maybeSingle();
      metaData = alt;
    }

    const politicas = await obterPoliticas();

    let metaAcessData = null;
    try {
      let proxAno = parseInt(ano); let proxMes = parseInt(m) + 1;
      if (proxMes > 12) { proxMes = 1; proxAno++; }
      const compAcessorios = `${proxAno}-${String(proxMes).padStart(2, '0')}`;
      
      const nomeMesAcessA = formatarMesMeta(compAcessorios);
      const nomeMesAcessB = nomeMesAcessA.replace('/', ' / ');
      
      let { data: acessA } = await supabaseClient.from('metas_mensais').select('dados').eq('mes', nomeMesAcessA).maybeSingle();
      if (!acessA) {
         const { data: acessB } = await supabaseClient.from('metas_mensais').select('dados').eq('mes', nomeMesAcessB).maybeSingle();
         acessA = acessB;
      }
      metaAcessData = acessA;
    } catch (e) {
      console.warn('[Acessórios M+1] Erro ao buscar:', e);
    }

    for (const vend of vendedores) {
      let bateuPessoal = false;
      let lojaBateu = false;
      let valAparelhos = 0;
      let valAcessorios = 0;

      if (metaData?.dados) {
         const consultores = metaData.dados.consultores || [];
         const metaCons = metaData.dados.metaConsultor || {};
         const metaLoja = metaData.dados.metaLoja || {};
         const primeiroNome = vend.split(' ')[0].toLowerCase();
         const consultor = consultores.find(c => String(c.nome || '').toLowerCase().split(' ')[0] === primeiroNome);

         if (consultor) {
            const soma = (arr) => (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
            const d = consultor.diario || {};
            const realizadoFatTotal = soma(d['PÓS FAT.']) + soma(d['CONTROLE FAT.']);
            const metaFatTotal = Number(metaCons['FAT TOTAL TIM'] || (Number(metaCons['PÓS FAT.'] || 0) + Number(metaCons['CONTROLE FAT.'] || 0)));
            bateuPessoal = metaFatTotal > 0 && (realizadoFatTotal / metaFatTotal) >= 1;

            const realizadoLojaFat = consultores.reduce((s, c) => s + soma((c.diario || {})['PÓS FAT.']) + soma((c.diario || {})['CONTROLE FAT.']), 0);
            const metaLojaFatTotal = Number(metaLoja['FAT TOTAL TIM'] || 0) || (Number(metaLoja['PÓS FAT.'] || 0) + Number(metaLoja['CONTROLE FAT.'] || 0));
            lojaBateu = metaLojaFatTotal > 0 && (realizadoLojaFat / metaLojaFatTotal) >= 1;

            valAparelhos = soma(d['APARELHO']);

            if (metaAcessData?.dados) {
              const consultoresAcess = metaAcessData.dados.consultores || [];
              const consultorAcess = consultoresAcess.find(c => String(c.nome || '').toLowerCase().split(' ')[0] === primeiroNome);
              if (consultorAcess) {
                valAcessorios = soma(consultorAcess.diario?.['ACESSÓRIOS']);
              }
            }
         }
      }

      const { data: p, error: pErr } = await supabaseClient.rpc('calcular_previsao_comissao_b2c', {
        p_mes_competencia: `${mes}-01`, p_vendedor_id: vend, p_vendedor_bateu_meta: bateuPessoal, p_loja_bateu_meta: lojaBateu
      });
      if (pErr) throw new Error(`Erro ao calcular previsão para ${vend}: ${pErr.message}`);

      const tier = resolverTier({ bateuLoja: lojaBateu, bateuPessoal });
      const fatorAparelho = resolverFator(politicas, 'APARELHO', tier);
      const fatorAcessorio = resolverFator(politicas, 'ACESSORIO', tier);

      const comissaoAparelhos = valAparelhos * fatorAparelho;
      const comissaoAcessorios = valAcessorios * fatorAcessorio;
      const totalServicos = Number(p.total_servicos || 0);

      const metaPort = p.portabilidade_meta || 0;
      const realPort = p.portabilidade_realizado || 0;
      const bateuPort = metaPort > 0 && realPort >= metaPort;
      const portEstado = metaPort === 0 ? 'SEM_META' : (!bateuPort ? 'FALTAM_PORT' : (!bateuPessoal ? 'FALTA_FAT' : 'LIBERADO'));
      const aceleradorPort = portEstado === 'LIBERADO' ? (totalServicos * 0.15) : 0;
      const totalFinal = totalServicos + comissaoAparelhos + comissaoAcessorios + aceleradorPort;

      await supabaseClient.from('financeiro_espelhos_b2c').delete().eq('mes_competencia_venda', `${mes}-01`).eq('vendedor_id', vend);

      const { data: espelho, error: espErr } = await supabaseClient.from('financeiro_espelhos_b2c').insert({
        vendedor_id: vend,
        mes_competencia_venda: `${mes}-01`,
        mes_competencia_pagamento: `${mes}-01`,
        status_espelho: 'OFICIAL',
        total_comissao_servicos: totalServicos,
        total_comissao_aparelhos: comissaoAparelhos,
        total_comissao_acessorios: comissaoAcessorios,
        total_liquido_receber: totalFinal
      }).select().single();

      if (espErr || !espelho) throw new Error(`Erro ao salvar espelho de ${vend}: ${espErr?.message || 'Sem permissão.'}`);

      const itens = [];
      
      // 🚀 CORREÇÃO: Adicionando a coluna base_calculo_liquida
      if (p.itens_servicos?.length > 0) {
         p.itens_servicos.forEach(it => {
           const valorPorItem = it.total / it.qtd;
           for (let k = 0; k < it.qtd; k++) {
             itens.push({
               espelho_id: espelho.id, 
               tipo_item: it.plano, 
               valor_referencia_base: it.vr, 
               base_calculo_liquida: it.vr * it.qt, // 👈 ADICIONADO AQUI
               qualidade_aplicada: it.qt, 
               fator_remuneracao_aplicado: it.fator, 
               valor_comissao_final: valorPorItem
             });
           }
         });
      }
      
      if (comissaoAparelhos > 0) {
        itens.push({ 
          espelho_id: espelho.id, 
          tipo_item: 'APARELHO', 
          valor_referencia_base: valAparelhos, 
          base_calculo_liquida: valAparelhos, // 👈 ADICIONADO AQUI
          qualidade_aplicada: 1, 
          fator_remuneracao_aplicado: fatorAparelho, 
          valor_comissao_final: comissaoAparelhos 
        });
      }
      
      if (comissaoAcessorios > 0) {
        itens.push({ 
          espelho_id: espelho.id, 
          tipo_item: 'ACESSORIO', 
          valor_referencia_base: valAcessorios, 
          base_calculo_liquida: valAcessorios, // 👈 ADICIONADO AQUI
          qualidade_aplicada: 1, 
          fator_remuneracao_aplicado: fatorAcessorio, 
          valor_comissao_final: comissaoAcessorios 
        });
      }
      
      if (aceleradorPort > 0) {
        itens.push({ 
          espelho_id: espelho.id, 
          tipo_item: 'ACELERADOR_PORTABILIDADE', 
          valor_referencia_base: totalServicos, 
          base_calculo_liquida: totalServicos, // 👈 ADICIONADO AQUI
          qualidade_aplicada: 1, 
          fator_remuneracao_aplicado: 0.15, 
          valor_comissao_final: aceleradorPort 
        });
      }

      if (itens.length > 0) {
         const { error: itemErr } = await supabaseClient.from('financeiro_espelho_itens').insert(itens);
         if (itemErr) throw new Error(`Erro ao salvar itens de ${vend}: ${itemErr.message}`);
      }
    }

    alert(`✅ Espelhos oficiais gerados com sucesso para ${vendedores.length} vendedores!`);
    if (typeof carregarEspelho === 'function') carregarEspelho();
    
  } catch (err) {
    console.error('[Gerar Espelhos] Falha:', err);
    alert('❌ ' + err.message);
  } finally {
    btn.innerHTML = original;
    btn.disabled = false;
    lucide.createIcons();
  }
}
