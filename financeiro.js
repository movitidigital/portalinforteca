/* ============================================================
   MÓDULO FINANCEIRO — Conciliação TIM + Espelho + Políticas
   ============================================================ */

const finState = {
  conciliacao: { mes: new Date().toISOString().slice(0,7), arquivo: null, resumo: null, linhas: [] },
  espelho:     { competencia: new Date().toISOString().slice(0,7), dados: null, itens: [] },
  politicas:   { lista: [] }
};

/* ============================================================
   CONCILIAÇÃO TIM
   ============================================================ */

function inicializarConciliacao() {
  const inputMes = document.getElementById('concMes');
  if (inputMes) {
    const mesAtual = new Date().toISOString().slice(0, 7);
    if (!inputMes.value) inputMes.value = mesAtual;
    finState.conciliacao.mes = inputMes.value;

    // Listener: atualiza o finState quando o usuário muda o mês
    if (!inputMes._binded) {
      inputMes._binded = true;
      inputMes.addEventListener('change', (e) => {
        finState.conciliacao.mes = e.target.value;
        console.log('[Conciliação] Mês alterado para:', e.target.value);
        carregarConciliacaoExistente();
      });
    }
  }

  // Bind drag & drop
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

  // Carrega conciliação já existente ao abrir a tela
  carregarConciliacaoExistente();
}

/* Carrega conciliação existente do banco (sem precisar reimportar) */
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

  // Nada importado ainda → mostra a drop zone
  if (!linhas || linhas.length === 0) {
    drop.style.display = 'block';
    cards.style.display = 'none';
    status.innerHTML = '';
    return;
  }

  // Reconstrói o resumo
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

  // Busca vendedores
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

    // ── HELPERS ──
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

    // ── MAPEAMENTO ──
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

    // ── CHAMA RPC ──
    const mes = document.getElementById('concMes').value;
    finState.conciliacao.mes = mes;

    const { data: rpc, error: rpcErr } = await supabaseClient.rpc('processar_conciliacao_tim', {
      p_mes_competencia: `${mes}-01`,
      p_dados_espelho: payload
    });
    if (rpcErr) throw rpcErr;

    // ── RESUMO ──
    finState.conciliacao.resumo = {
      processado: rpc.linhas_processadas || 0,
      match:      rpc.matches_perfeitos || 0,
      divergencia: rpc.divergencias || 0,
      glosas:     (rpc.glosas || 0) + (rpc.nao_encontrados || 0),
      totalPago:  rpc.total_pago || 0
    };

    // ── DETALHES ──
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
    const cls = l.auditoria === 'RETIDO'
      ? 'bg-red-50/40'
      : l.auditoria === 'ESTORNO'
        ? 'bg-blue-50/30'
        : '';

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

/* ============================================================
   ESPELHO DE COMISSÃO
   ============================================================ */

async function carregarEspelho() {
  const container = document.getElementById('espelhoConteudo');
  container.innerHTML = `<div class="text-center py-12"><svg class="animate-spin w-8 h-8 text-indigo-600 mx-auto" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>`;

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    // Input de mês
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

    // Vendedor: admin pode escolher, consultor vê o dele
    const isAdmin = state._isAdmin === true;
    const selectVend = document.getElementById('espelhoVendedor');

    let vendedor;
    if (isAdmin) {
      // Mostra dropdown de consultores com espelho nessa competência
      selectVend.style.display = 'inline-block';

      if (!selectVend._binded) {
        selectVend._binded = true;
        selectVend.addEventListener('change', () => {
          finState.espelho.vendedorSelecionado = selectVend.value;
          carregarEspelho();
        });
      }

      // Popula lista de vendedores (se vazio ou se mudou o mês)
      if (selectVend._mesCarregado !== mes) {
        selectVend._mesCarregado = mes;
        const { data: vendedores } = await supabaseClient
          .from('financeiro_espelhos_b2c')
          .select('vendedor_id')
          .eq('mes_competencia_venda', mes)
          .order('vendedor_id');

        const lista = (vendedores || []).map(v => v.vendedor_id);
        selectVend.innerHTML = lista.length
          ? lista.map(v => `<option value="${v}">${v}</option>`).join('')
          : '<option value="">— Nenhum espelho gerado —</option>';

        // Se o vendedor logado estiver na lista, pré-seleciona
        const nomeUser = (state.perfil?.nome_completo || '').toUpperCase();
        if (lista.includes(nomeUser)) selectVend.value = nomeUser;
      }

      vendedor = selectVend.value || (state.perfil?.nome_completo || '').toUpperCase();
    } else {
      selectVend.style.display = 'none';
      vendedor = (state.perfil?.nome_completo || '').toUpperCase();
    }

    // Busca espelho
    const { data: espelho } = await supabaseClient
      .from('financeiro_espelhos_b2c')
      .select('*')
      .eq('vendedor_id', vendedor)
      .eq('mes_competencia_venda', mes)
      .maybeSingle();

    if (!espelho) {
      container.innerHTML = mensagemEspelhoVazio(vendedor, competencia);
      return;
    }

    // Busca itens
    const { data: itens } = await supabaseClient
      .from('financeiro_espelho_itens')
      .select('*')
      .eq('espelho_id', espelho.id)
      .order('valor_comissao_final', { ascending: false });

    // Busca meta do mês (para gamificação)
    const nomeMes = formatarMesMeta(competencia);
    const { data: metaData } = await supabaseClient
      .from('metas_mensais')
      .select('dados')
      .eq('mes', nomeMes)
      .maybeSingle();

    let metaInfo = null;
    if (metaData?.dados) {
      const consultores = metaData.dados.consultores || [];
      const metaCons = metaData.dados.metaConsultor || {};
      const metaLoja = metaData.dados.metaLoja || {};

      const primeiroNome = vendedor.split(' ')[0].toLowerCase();
      const consultor = consultores.find(c =>
        String(c.nome || '').toLowerCase().split(' ')[0] === primeiroNome
      );

      if (consultor) {
        const soma = (arr) => (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
        const d = consultor.diario || {};

        const realizadoPos = soma(d['PÓS']);
        const realizadoControle = soma(d['CONTROLE']);
        const realizadoServicos = realizadoPos + realizadoControle;

        const metaPos = Number(metaCons['PÓS'] || 0);
        const metaControle = Number(metaCons['CONTROLE'] || 0);
        const metaServicos = metaPos + metaControle;

        const pct = metaServicos > 0 ? (realizadoServicos / metaServicos) * 100 : 0;

        // Meta da loja
        const realizadoLojaPos = consultores.reduce((s, c) => s + soma((c.diario || {})['PÓS']), 0);
        const realizadoLojaCtrl = consultores.reduce((s, c) => s + soma((c.diario || {})['CONTROLE']), 0);
        const realizadoLoja = realizadoLojaPos + realizadoLojaCtrl;
        const metaLojaTotal = Number(metaLoja['PÓS'] || 0) + Number(metaLoja['CONTROLE'] || 0);
        const pctLoja = metaLojaTotal > 0 ? (realizadoLoja / metaLojaTotal) * 100 : 0;

        metaInfo = {
          realizadoServicos,
          metaServicos,
          pct,
          bateuPessoal: pct >= 100,
          realizadoLoja,
          metaLoja: metaLojaTotal,
          pctLoja,
          bateuLoja: pctLoja >= 100
        };
      }
    }

    finState.espelho.dados = espelho;
    finState.espelho.itens = itens || [];
    finState.espelho.metaInfo = metaInfo;
    finState.espelho.vendedor = vendedor;
    renderizarEspelho();

  } catch (err) {
    console.error('[Espelho]', err);
    container.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">Erro: ${err.message}</div>`;
  }
}

function mensagemEspelhoVazio(vendedor, competencia) {
  const nome = (vendedor || '').split(' ')[0] || '—';
  const [y, m] = competencia.split('-');
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const mesNome = meses[+m - 1] + '/' + y;

  return `<div class="bg-amber-50 border-2 border-amber-200 p-8 rounded-2xl text-center max-w-2xl mx-auto">
    <div class="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center mb-4">
      <i data-lucide="file-search" class="w-8 h-8 text-amber-600"></i>
    </div>
    <h3 class="text-lg font-black text-amber-900">Nenhum espelho disponível</h3>
    <p class="text-sm text-amber-700 mt-2 leading-relaxed">
      Ainda não foi gerado o espelho de <strong>${nome}</strong> para <strong>${mesNome}</strong>.
    </p>
    <p class="text-xs text-amber-600 mt-3">
      O espelho é gerado após a conciliação TIM da competência. Fale com o gestor.
    </p>
  </div>`;
}

function renderizarEspelho() {
  const e = finState.espelho.dados;
  const itens = finState.espelho.itens;
  const meta = finState.espelho.metaInfo;
  const vendedor = finState.espelho.vendedor || e.vendedor_id;
  const fmt = v => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});

  // Agrupa itens por categoria
  const servicos = itens.filter(i => !['ACESSORIO','APARELHO'].includes(i.tipo_item));
  const acessorios = itens.filter(i => i.tipo_item === 'ACESSORIO');
  const aparelhos = itens.filter(i => i.tipo_item === 'APARELHO');

  // Agrupa serviços por nome do plano
  const servicosAgrupados = {};
  servicos.forEach(i => {
    if (!servicosAgrupados[i.tipo_item]) {
      servicosAgrupados[i.tipo_item] = { qtd: 0, vr: i.valor_referencia_base, qt: i.qualidade_aplicada, fator: i.fator_remuneracao_aplicado, total: 0 };
    }
    servicosAgrupados[i.tipo_item].qtd += 1;
    servicosAgrupados[i.tipo_item].total += Number(i.valor_comissao_final) || 0;
  });

  // Gamificação
  let gamificacaoHTML = '';
  if (meta) {
    const pct = Math.min(100, meta.pct);
    const cor = meta.bateuPessoal ? 'emerald' : meta.pct >= 70 ? 'amber' : 'red';
    const corBg = meta.bateuPessoal ? 'bg-emerald-500' : meta.pct >= 70 ? 'bg-amber-500' : 'bg-red-500';
    const corTexto = meta.bateuPessoal ? 'text-emerald-700' : meta.pct >= 70 ? 'text-amber-700' : 'text-red-700';
    const corBorder = meta.bateuPessoal ? 'border-emerald-200 bg-emerald-50' : meta.pct >= 70 ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50';
    const emoji = meta.bateuPessoal ? '🎉' : meta.pct >= 70 ? '💪' : '📈';
    const msg = meta.bateuPessoal
      ? `Parabéns! Você bateu sua meta pessoal (fator 30%)`
      : `Faltam <strong>${meta.metaServicos - meta.realizadoServicos}</strong> vendas para bater meta pessoal (fator 30%)`;

    gamificacaoHTML = `
      <div class="rounded-2xl border-2 ${corBorder} p-5 mb-6">
        <div class="flex justify-between items-start mb-3">
          <div>
            <p class="text-[10px] font-black ${corTexto} uppercase tracking-widest">${emoji} Meta Pessoal</p>
            <p class="text-sm ${corTexto} font-bold mt-1">${msg}</p>
          </div>
          <div class="text-right">
            <div class="text-3xl font-black ${corTexto}">${meta.pct.toFixed(0)}%</div>
            <div class="text-xs text-slate-500">${meta.realizadoServicos} / ${meta.metaServicos}</div>
          </div>
        </div>
        <div class="w-full bg-white rounded-full h-3 overflow-hidden border border-slate-200">
          <div class="${corBg} h-3 rounded-full transition-all" style="width:${pct}%"></div>
        </div>
        <div class="flex justify-between items-center mt-2 text-xs text-slate-500">
          <span>Fator atual: <strong>${(e.atingiu_meta_pessoal ? '30%' : '20%')}</strong></span>
          <span>Meta loja: <strong>${meta.pctLoja.toFixed(0)}%</strong> ${meta.bateuLoja ? '✅' : ''}</span>
        </div>
      </div>`;
  } else {
    gamificacaoHTML = `
      <div class="rounded-2xl border-2 border-slate-200 bg-slate-50 p-5 mb-6 flex items-center gap-3">
        <div class="p-3 bg-white rounded-xl">
          <i data-lucide="info" class="w-5 h-5 text-slate-400"></i>
        </div>
        <div>
          <p class="text-sm font-bold text-slate-700">Meta pessoal não cadastrada para esta competência</p>
          <p class="text-xs text-slate-500 mt-0.5">Fator aplicado: <strong>20% (ativou ganhou)</strong>. Cadastre a meta em "Acompanhamento de Metas" para ativar a gamificação.</p>
        </div>
      </div>`;
  }

  // HTML dos itens agrupados
  const linhasServicos = Object.entries(servicosAgrupados)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([nome, d]) => `
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
    <!-- HEADER -->
    <div class="bg-gradient-to-r from-[#000033] to-[#0e8890] rounded-2xl p-6 mb-6 text-white shadow-lg">
      <div class="flex justify-between items-start flex-wrap gap-4">
        <div>
          <p class="text-[10px] font-black uppercase tracking-widest opacity-70">Espelho de Comissão</p>
          <h2 class="text-2xl font-black mt-1">${vendedor}</h2>
          <p class="text-sm opacity-90 mt-1">Competência: ${fmtMes(e.mes_competencia_venda)}</p>
          <p class="text-[10px] uppercase font-bold mt-1 opacity-70">
            ${e.status_espelho || 'RASCUNHO'}
          </p>
        </div>
        <button onclick="exportarEspelhoPdf()" class="bg-white/20 hover:bg-white/30 backdrop-blur text-white px-5 py-3 rounded-xl text-sm font-black uppercase tracking-wide flex items-center gap-2 transition">
          <i data-lucide="download" class="w-4 h-4"></i>
          Exportar PDF
        </button>
      </div>
    </div>

    <!-- CARDS DE TOTAL -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Serviços TIM</p>
        <p class="text-xl font-black text-slate-800">R$ ${fmt(e.total_comissao_servicos)}</p>
        <p class="text-[10px] text-slate-400 mt-1">${servicos.length} itens</p>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Acessórios</p>
        <p class="text-xl font-black text-slate-800">R$ ${fmt(e.total_comissao_acessorios)}</p>
        <p class="text-[10px] text-slate-400 mt-1">${acessorios.length} itens</p>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Aparelhos</p>
        <p class="text-xl font-black text-slate-800">R$ ${fmt(e.total_comissao_aparelhos)}</p>
        <p class="text-[10px] text-slate-400 mt-1">${aparelhos.length} itens</p>
      </div>
      <div class="bg-emerald-500 rounded-2xl p-5 shadow-lg">
        <p class="text-[10px] font-black text-emerald-100 uppercase tracking-widest mb-1">Total a Receber</p>
        <p class="text-2xl font-black text-white">R$ ${fmt(e.total_liquido_receber)}</p>
        <p class="text-[10px] text-emerald-100 mt-1">Fator: ${e.atingiu_meta_pessoal ? '30%' : '20%'}</p>
      </div>
    </div>

    <!-- GAMIFICAÇÃO -->
    ${gamificacaoHTML}

    <!-- TABELA DE SERVIÇOS -->
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
          <tbody>
            ${linhasServicos || '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400 text-sm">Nenhum serviço no espelho</td></tr>'}
          </tbody>
          <tfoot class="bg-slate-50 border-t-2 border-slate-200">
            <tr>
              <td colspan="5" class="px-4 py-3 text-right text-xs font-black text-slate-600 uppercase">Subtotal Serviços</td>
              <td class="px-4 py-3 text-right font-black text-slate-800">R$ ${fmt(e.total_comissao_servicos)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- ACESSÓRIOS E APARELHOS -->
    ${acessorios.length > 0 ? `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 mb-4 shadow-sm flex justify-between items-center">
      <div>
        <p class="text-sm font-black text-slate-700 uppercase tracking-wide">Acessórios</p>
        <p class="text-xs text-slate-500 mt-0.5">${acessorios.length} itens vendidos · fator ${(acessorios[0].fator_remuneracao_aplicado * 100).toFixed(2)}%</p>
      </div>
      <p class="text-lg font-black text-slate-800">R$ ${fmt(e.total_comissao_acessorios)}</p>
    </div>` : ''}

    ${aparelhos.length > 0 ? `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 mb-6 shadow-sm flex justify-between items-center">
      <div>
        <p class="text-sm font-black text-slate-700 uppercase tracking-wide">Aparelhos</p>
        <p class="text-xs text-slate-500 mt-0.5">${aparelhos.length} itens vendidos · fator ${(aparelhos[0].fator_remuneracao_aplicado * 100).toFixed(2)}%</p>
      </div>
      <p class="text-lg font-black text-slate-800">R$ ${fmt(e.total_comissao_aparelhos)}</p>
    </div>` : ''}

    <!-- TOTAL FINAL -->
    <div class="bg-[#000033] rounded-2xl p-6 shadow-xl flex justify-between items-center mb-6">
      <div>
        <p class="text-[10px] font-black text-slate-300 uppercase tracking-widest">Total Líquido a Receber</p>
        <p class="text-xs text-slate-400 mt-0.5">Competência ${fmtMes(e.mes_competencia_venda)}</p>
      </div>
      <p class="text-3xl font-black text-white">R$ ${fmt(e.total_liquido_receber)}</p>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function formatarMesMeta(competencia) {
  // "2026-08" → "AGOSTO / 2026"
  const [y, m] = competencia.split('-');
  const meses = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  return `${meses[+m - 1]} / ${y}`;
}

function exportarEspelhoPdf() {
  alert('PDF será implementado com html2pdf.js na próxima sprint.');
}

function fmtMes(iso) {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${meses[+m - 1]}/${y}`;
}

/* ============================================================
   POLÍTICAS
   ============================================================ */

async function carregarPoliticas() {
  const { data } = await supabaseClient.from('financeiro_politicas_b2c').select('*').order('categoria').order('faixa_atingimento');
  finState.politicas.lista = data || [];
  renderizarPoliticas();
}

function renderizarPoliticas() {
  const tbody = document.getElementById('politicasTbody');
  tbody.innerHTML = finState.politicas.lista.map(p => `<tr class="border-b border-slate-100">
    <td class="px-4 py-2 text-xs font-bold">${p.categoria}</td>
    <td class="px-4 py-2 text-xs">${p.faixa_atingimento}</td>
    <td class="px-4 py-2 text-right font-bold">${(p.fator_remuneracao * 100).toFixed(2)}%</td>
    <td class="px-4 py-2 text-xs text-slate-400">${p.vigencia_inicio || '—'}</td>
  </tr>`).join('');
}

/* ============================================================
   ABAS DA CONCILIAÇÃO
   ============================================================ */

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

/* ============================================================
   MINHAS VENDAS — Auditoria por venda (com portabilidade)
   ============================================================ */

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
    const { data, error } = await supabaseClient.rpc('listar_vendas_consolidadas', {
      p_mes_competencia: `${mes}-01`
    });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = `<div class="px-6 py-12 text-center text-slate-500">
        Nenhuma venda encontrada para ${mes}.
      </div>`;
      return;
    }

    const fmt = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});

    // Contadores
    const totalPago = data.filter(d => d.status_pagamento === 'PAGO').length;
    const totalNaoPago = data.filter(d => d.status_pagamento === 'NAO_PAGO').length;
    const totalGlosado = data.filter(d => d.status_pagamento === 'GLOSADO').length;
    const totalEstornado = data.filter(d => d.status_pagamento === 'ESTORNADO').length;
    const totalRecebidoGeral = data.reduce((s, d) => s + (parseFloat(d.total_recebido) || 0), 0);

    // Header com resumo
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

    // Cards por venda
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

      // Total formatado
      const total = parseFloat(v.total_recebido) || 0;
      const totalCor = total > 0 ? 'text-emerald-700' : total < 0 ? 'text-red-700' : 'text-slate-400';

      // Lista de indicadores
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

      // Info portabilidade
      const provInfo = v.telefone_provisorio
        ? `<div class="font-mono text-[10px] text-amber-600 mt-0.5">⚡ prov: ${v.telefone_provisorio}</div>`
        : '';

      return `
        <div class="border border-slate-200 border-l-4 ${cardBorder} rounded-lg mb-3 overflow-hidden shadow-sm">
          <!-- HEADER -->
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
            </div>
          </div>

          <!-- INDICADORES -->
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
   BOOT — chamado quando navegar() troca pra uma view financeira
   ============================================================ */

window.inicializarModuloFinanceiro = function(view) {
  if (view === 'conciliacao') inicializarConciliacao();
  if (view === 'espelho')     carregarEspelho();
  if (view === 'politicas')   carregarPoliticas();
};

async function gerarEspelhosCompetencia() {
  const mes = document.getElementById('concMes').value;
  
  if (!confirm(`⚡ Gerar espelhos de TODOS os consultores para ${mes}?\n\nIsso recalcula os espelhos com base na conciliação atual.`)) return;

  const btn = document.getElementById('concBtnGerarEspelhos');
  const htmlOrig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<svg class="animate-spin inline-block w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Gerando...';

  try {
    const { data, error } = await supabaseClient.rpc('gerar_espelhos_competencia', {
      p_mes_competencia: `${mes}-01`
    });

    if (error) throw error;
    if (!data.sucesso) throw new Error('Erro ao gerar');

    let msg = `✅ ${data.total_gerado} espelho(s) gerado(s) para ${mes}`;
    if (data.erros && data.erros.length > 0) {
      msg += `\n\n⚠️ ${data.erros.length} erro(s):\n` + data.erros.slice(0, 5).join('\n');
    }
    alert(msg);

  } catch (err) {
    console.error('[Gerar Espelhos]', err);
    alert('❌ Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = htmlOrig;
    if (window.lucide) lucide.createIcons();
  }
}
async function cancelarVenda(interacaoId, nomeCliente) {
  if (!confirm(`⚠️ Cancelar a venda de ${nomeCliente}?\n\nA venda NÃO entrará em nenhum espelho futuro.`)) return;

  try {
    const { error } = await supabaseClient
      .from('interacoes')
      .update({
        conciliacao_status: 'CANCELADO_CLIENTE'
      })
      .eq('id', interacaoId);

    if (error) throw error;

    alert('✅ Venda cancelada. Regenere o espelho do vendedor para refletir.');
    carregarVendasNaoPagas();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}
