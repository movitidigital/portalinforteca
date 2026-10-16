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
    // Pega o mês atual como padrão
    const mesAtual = new Date().toISOString().slice(0, 7);
    if (!inputMes.value) inputMes.value = mesAtual;
    finState.conciliacao.mes = inputMes.value;

    // ✅ Listener: atualiza o finState quando o usuário muda o mês
    if (!inputMes._binded) {
      inputMes._binded = true;
      inputMes.addEventListener('change', (e) => {
        finState.conciliacao.mes = e.target.value;
        console.log('[Conciliação] Mês alterado para:', e.target.value);
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
}

async function processarArquivoTim(file) {
  const status = document.getElementById('concStatus');
  const drop = document.getElementById('concDrop');

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
      // DD/MM/YYYY → YYYY-MM-DD
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      // Já está ISO?
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

    // ── MAPEAMENTO (aceita múltiplos nomes de colunas) ──
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
finState.conciliacao.mes = mes; // atualiza também
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
      if (d.status_conciliacao === 'DIVERGENCIA_VALOR') tag = 'DIVERGE';
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
  const mes = finState.conciliacao.mes;

  document.getElementById('concCardLinhas').textContent = r.processado;
  document.getElementById('concCardMatch').textContent = r.match;
  document.getElementById('concCardDiverge').textContent = r.divergencia;
  document.getElementById('concCardGlosa').textContent = r.glosas;
  document.getElementById('concCardTotal').textContent = 'R$ ' + fmt(r.totalPago);

  // Tabela
  tabela.innerHTML = finState.conciliacao.linhas.map(l => {
    const cls = l.auditoria === 'RETIDO' ? 'bg-red-50/40' : l.auditoria === 'DIVERGE' ? 'bg-amber-50/40' : '';
    const tag = l.auditoria === 'OK'
      ? '<span class="px-2 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-700">MATCH</span>'
      : l.auditoria === 'RETIDO'
        ? '<span class="px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-700">GLOSA</span>'
        : '<span class="px-2 py-1 rounded text-xs font-bold bg-amber-100 text-amber-700">DIVERGÊNCIA</span>';
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
  container.innerHTML = '<div class="text-center py-12"><svg class="animate-spin w-8 h-8 text-indigo-600 mx-auto" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>';

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const vendedor = (state.perfil?.nome_completo || '').toUpperCase();
    const mes = finState.espelho.competencia + '-01';

    const { data: espelho } = await supabaseClient
      .from('financeiro_espelhos_b2c')
      .select('*')
      .eq('vendedor_id', vendedor)
      .eq('mes_competencia_venda', mes)
      .maybeSingle();

    if (!espelho) {
      container.innerHTML = `<div class="bg-amber-50 border border-amber-200 text-amber-800 p-6 rounded-2xl text-center">
        <p class="font-bold">Nenhum espelho encontrado para ${finState.espelho.competencia}</p>
        <p class="text-sm mt-1">Peça ao gestor para gerar o espelho da competência.</p>
      </div>`;
      return;
    }

    const { data: itens } = await supabaseClient
      .from('financeiro_espelho_itens')
      .select('*')
      .eq('espelho_id', espelho.id)
      .order('valor_comissao_final', { ascending: false });

    finState.espelho.dados = espelho;
    finState.espelho.itens = itens || [];
    renderizarEspelho();
  } catch (err) {
    container.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">Erro: ${err.message}</div>`;
  }
}

function renderizarEspelho() {
  const e = finState.espelho.dados;
  const itens = finState.espelho.itens;
  const fmt = v => Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});

  const container = document.getElementById('espelhoConteudo');
  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <div class="flex justify-between items-start mb-4">
        <div>
          <h2 class="text-xl font-black text-[#000033]">${e.vendedor_id}</h2>
          <p class="text-sm text-slate-500">Competência: ${fmtMes(e.mes_competencia_venda)}</p>
        </div>
        <button onclick="exportarEspelhoPdf()" class="bg-[#0e8890] hover:bg-[#0b6c72] text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
          📄 Exportar PDF
        </button>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-slate-50 rounded-xl p-4">
          <p class="text-xs font-bold text-slate-400 uppercase">Serviços</p>
          <p class="text-lg font-black text-slate-800">R$ ${fmt(e.total_comissao_servicos)}</p>
        </div>
        <div class="bg-slate-50 rounded-xl p-4">
          <p class="text-xs font-bold text-slate-400 uppercase">Acessórios</p>
          <p class="text-lg font-black text-slate-800">R$ ${fmt(e.total_comissao_acessorios)}</p>
        </div>
        <div class="bg-slate-50 rounded-xl p-4">
          <p class="text-xs font-bold text-slate-400 uppercase">Aparelhos</p>
          <p class="text-lg font-black text-slate-800">R$ ${fmt(e.total_comissao_aparelhos)}</p>
        </div>
        <div class="bg-emerald-50 rounded-xl p-4 border-2 border-emerald-200">
          <p class="text-xs font-bold text-emerald-700 uppercase">Total</p>
          <p class="text-xl font-black text-emerald-700">R$ ${fmt(e.total_liquido_receber)}</p>
        </div>
      </div>
    </div>

    <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th class="px-4 py-3 text-left">Item</th>
            <th class="px-4 py-3 text-right">VR</th>
            <th class="px-4 py-3 text-center">QT</th>
            <th class="px-4 py-3 text-center">Fator</th>
            <th class="px-4 py-3 text-right">Comissão</th>
          </tr>
        </thead>
        <tbody>
          ${itens.map(i => `<tr class="border-b border-slate-100">
            <td class="px-4 py-2 font-medium">${i.tipo_item}</td>
            <td class="px-4 py-2 text-right">R$ ${fmt(i.valor_referencia_base)}</td>
            <td class="px-4 py-2 text-center">${(i.qualidade_aplicada * 100).toFixed(2)}%</td>
            <td class="px-4 py-2 text-center">${(i.fator_remuneracao_aplicado * 100).toFixed(1)}%</td>
            <td class="px-4 py-2 text-right font-bold">R$ ${fmt(i.valor_comissao_final)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
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
   BOOT — chamado quando navegar() troca pra uma view financeira
   ============================================================ */

window.inicializarModuloFinanceiro = function(view) {
  if (view === 'conciliacao') inicializarConciliacao();
  if (view === 'espelho')     carregarEspelho();
  if (view === 'politicas')   carregarPoliticas();
};
