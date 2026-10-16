<template>
  <div class="min-h-screen bg-slate-50 p-6 font-sans">
    <div class="max-w-7xl mx-auto mb-8">
      <h1 class="text-3xl font-bold text-slate-800 tracking-tight">Hub de Conciliação TIM</h1>
      <p class="text-slate-500 mt-1">Importe o espelho oficial da TIM e audite o pagamento.</p>

      <div class="mt-4 flex items-center gap-3">
        <label class="text-sm font-medium text-slate-700">Competência:</label>
        <input type="month" v-model="mesCompetencia"
               class="rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm px-3 py-2 border">
      </div>
    </div>

    <!-- Upload -->
    <div v-if="!arquivoCarregado"
      @dragover.prevent @drop.prevent="processarDrop"
      class="max-w-4xl mx-auto bg-white rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center hover:bg-slate-50 transition-colors cursor-pointer"
      :class="{'opacity-50 pointer-events-none': isProcessingUpload}">
      <input type="file" ref="fileInput" @change="processarSelecaoArquivo"
             accept=".xlsx,.xls,.csv" class="hidden" />

      <div v-if="isProcessingUpload" class="flex flex-col items-center">
        <svg class="animate-spin h-10 w-10 text-indigo-600 mb-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <h3 class="text-lg font-semibold">Cruzando com o VEXO...</h3>
        <p class="text-sm text-slate-500">Isso pode levar alguns segundos.</p>
      </div>
      <div v-else>
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50 text-indigo-600 mb-4">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
          </svg>
        </div>
        <h3 class="text-lg font-semibold text-slate-800 mb-1">Importar Espelho TIM</h3>
        <p class="text-sm text-slate-500 mb-4">Arraste o arquivo .xlsx enviado pela TIM para este mês.</p>
        <button @click="fileInput.click()"
                class="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">
          Selecionar Arquivo
        </button>
      </div>
    </div>

    <!-- Dashboard -->
    <div v-else class="max-w-7xl mx-auto">
      <!-- Cards -->
      <div class="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <div class="bg-white rounded-2xl p-4 border border-slate-200 border-l-4 border-l-blue-500 shadow-sm">
          <p class="text-xs font-medium text-slate-500 uppercase">Linhas</p>
          <h3 class="text-2xl font-bold text-slate-800">{{ resumo.processado }}</h3>
        </div>
        <div class="bg-white rounded-2xl p-4 border border-slate-200 border-l-4 border-l-emerald-500 shadow-sm">
          <p class="text-xs font-medium text-slate-500 uppercase">Match</p>
          <h3 class="text-2xl font-bold text-emerald-600">{{ resumo.match }}</h3>
        </div>
        <div class="bg-white rounded-2xl p-4 border border-slate-200 border-l-4 border-l-amber-500 shadow-sm">
          <p class="text-xs font-medium text-slate-500 uppercase">Divergência</p>
          <h3 class="text-2xl font-bold text-amber-600">{{ resumo.divergencia }}</h3>
        </div>
        <div class="bg-white rounded-2xl p-4 border border-slate-200 border-l-4 border-l-red-500 shadow-sm">
          <p class="text-xs font-medium text-slate-500 uppercase">Glosa / Não Enc.</p>
          <h3 class="text-2xl font-bold text-red-600">{{ resumo.glosas }}</h3>
        </div>
        <div class="bg-slate-800 rounded-2xl p-4 shadow-lg">
          <p class="text-xs font-medium text-slate-300 uppercase">Total Pago TIM</p>
          <h3 class="text-2xl font-bold text-white">R$ {{ formatar(resumo.totalPago) }}</h3>
        </div>
      </div>

      <!-- Ações -->
      <div class="flex flex-wrap gap-3 mb-6">
        <button @click="resetar"
                class="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 text-sm font-medium">
          ↺ Nova Conciliação
        </button>
        <button v-if="!competenciaFechada" @click="fecharCompetencia" :disabled="fechandoCompetencia"
                class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-bold disabled:opacity-50">
          {{ fechandoCompetencia ? 'Fechando...' : '🔒 Fechar Competência' }}
        </button>
        <span v-else class="px-4 py-2 bg-emerald-100 text-emerald-800 rounded-lg text-sm font-bold">
          ✅ Competência Fechada
        </span>
      </div>

      <!-- Tabela -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b bg-slate-50">
          <h3 class="text-lg font-semibold text-slate-800">Auditoria {{ mesCompetencia }}</h3>
        </div>
        <div class="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table class="w-full text-left text-sm">
            <thead class="sticky top-0 bg-white z-10">
              <tr class="text-xs uppercase tracking-wider bg-slate-100 text-slate-600">
                <th class="px-4 py-3 font-semibold">Consultor</th>
                <th class="px-4 py-3 font-semibold">GSM / Plano</th>
                <th class="px-4 py-3 font-semibold text-right">Valor TIM (R$)</th>
                <th class="px-4 py-3 font-semibold">Tipo Comissão</th>
                <th class="px-4 py-3 font-semibold text-center">Auditoria</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="linha in linhasAuditoria" :key="linha.id"
                  :class="{
                    'bg-red-50/30': linha.auditoria === 'RETIDO',
                    'bg-amber-50/30': linha.auditoria === 'DIVERGE'
                  }">
                <td class="px-4 py-3 font-medium text-slate-800">{{ linha.consultor }}</td>
                <td class="px-4 py-3">
                  <div class="font-medium text-slate-800">{{ linha.gsm }}</div>
                  <div class="text-xs text-slate-400">{{ linha.plano }}</div>
                </td>
                <td class="px-4 py-3 text-right font-bold"
                    :class="{
                      'text-emerald-600': linha.auditoria === 'OK',
                      'text-red-600': linha.auditoria === 'RETIDO',
                      'text-amber-600': linha.auditoria === 'DIVERGE'
                    }">
                  {{ formatar(linha.pago) }}
                </td>
                <td class="px-4 py-3 text-xs text-slate-500">{{ linha.status }}</td>
                <td class="px-4 py-3 text-center">
                  <span v-if="linha.auditoria === 'OK'"
                        class="inline-flex px-2 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-700">MATCH</span>
                  <span v-if="linha.auditoria === 'RETIDO'"
                        class="inline-flex px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-700">GLOSA</span>
                  <span v-if="linha.auditoria === 'DIVERGE'"
                        class="inline-flex px-2 py-1 rounded text-xs font-bold bg-amber-100 text-amber-700">DIVERGÊNCIA</span>
                </td>
              </tr>
              <tr v-if="linhasAuditoria.length === 0">
                <td colspan="5" class="px-6 py-12 text-center text-slate-500">
                  Nenhuma linha processada.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabaseClient'

const fileInput = ref(null)
const arquivoCarregado = ref(false)
const isProcessingUpload = ref(false)
const mesCompetencia = ref(new Date().toISOString().slice(0, 7))
const fechandoCompetencia = ref(false)
const competenciaFechada = ref(false)

const resumo = ref({
  processado: 0, match: 0, divergencia: 0, glosas: 0, totalPago: 0
})
const linhasAuditoria = ref([])

const formatar = (v) => {
  const n = Number(v || 0)
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const processarDrop = (e) => {
  const file = e.dataTransfer.files[0]
  if (file) manipularArquivo(file)
}
const processarSelecaoArquivo = (e) => {
  const file = e.target.files[0]
  if (file) manipularArquivo(file)
}
const resetar = () => {
  arquivoCarregado.value = false
  linhasAuditoria.value = []
  competenciaFechada.value = false
  if (fileInput.value) fileInput.value.value = null
}

const manipularArquivo = (file) => {
  isProcessingUpload.value = true
  const reader = new FileReader()

  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const linhasExcel = XLSX.utils.sheet_to_json(sheet, { defval: null })

      if (!linhasExcel.length) throw new Error('Planilha vazia')

      // ✅ MAPEAMENTO CORRETO DAS COLUNAS DA TIM
      const payload = linhasExcel
        .filter(l => l['gsm'] || l['GSM'])
        .map(l => ({
          gsm: String(l['gsm'] || l['GSM'] || '').trim(),
          cpf: String(l['cpf_cnpjcliente'] || l['CPF'] || '').trim(),
          plano: String(l['plano'] || '').trim(),
          dt_ativacao: l['dt_ativacao'] || null,
          valor_pago: parseFloat(l['valorpagar'] ?? l['ValorPagar'] ?? 0) || 0,
          motivo_glosa: String(l['desc_tipocomissao'] || l['tipocomissao'] || 'PAGO').trim()
        }))

      if (!payload.length) throw new Error('Nenhuma linha com GSM válido')

      const dataSQL = `${mesCompetencia.value}-01`
      const { data: rpc, error: rpcErr } = await supabase.rpc('processar_conciliacao_tim', {
        p_mes_competencia: dataSQL,
        p_dados_espelho: payload
      })
      if (rpcErr) throw rpcErr

      resumo.value = {
        processado: rpc.linhas_processadas || 0,
        match: rpc.matches_perfeitos || 0,
        divergencia: rpc.divergencias || 0,
        glosas: (rpc.glosas || 0) + (rpc.nao_encontrados || 0),
        totalPago: rpc.total_pago || 0
      }

      const { data: detalhes, error: detErr } = await supabase
        .from('financeiro_conciliacao_tim')
        .select('id, tim_gsm, tim_valor_pago, tim_plano_oferta, tim_motivo_glosa, status_conciliacao, interacao_id')
        .eq('lote_importacao_id', rpc.lote_id)
        .order('status_conciliacao')
      if (detErr) throw detErr

      const ids = [...new Set(detalhes.filter(d => d.interacao_id).map(d => d.interacao_id))]
      const mapaInter = {}
      if (ids.length) {
        const { data: inter } = await supabase
          .from('interacoes').select('id, vendedor').in('id', ids)
        ;(inter || []).forEach(i => { mapaInter[i.id] = i })
      }

      linhasAuditoria.value = detalhes.map(d => {
        let tag = 'OK'
        if (d.status_conciliacao === 'GLOSADO' || d.status_conciliacao === 'NAO_ENCONTRADO_SISTEMA') tag = 'RETIDO'
        if (d.status_conciliacao === 'DIVERGENCIA_VALOR') tag = 'DIVERGE'

        return {
          id: d.id,
          consultor: d.interacao_id ? (mapaInter[d.interacao_id]?.vendedor || '—') : 'Não Encontrado',
          gsm: d.tim_gsm || '—',
          plano: d.tim_plano_oferta || '—',
          pago: parseFloat(d.tim_valor_pago || 0),
          status: d.tim_motivo_glosa || 'PAGO',
          auditoria: tag
        }
      })

      arquivoCarregado.value = true
    } catch (err) {
      console.error('Erro:', err)
      alert('Falha: ' + (err.message || 'verifique o console'))
    } finally {
      isProcessingUpload.value = false
    }
  }

  reader.readAsArrayBuffer(file)
}

const fecharCompetencia = async () => {
  if (!confirm(`Fechar a competência ${mesCompetencia.value}?\n\nApós fechada, o espelho dos consultores só considerará vendas conciliadas.`)) return

  fechandoCompetencia.value = true
  try {
    const { data, error } = await supabase.rpc('fechar_competencia', {
      p_mes_competencia: `${mesCompetencia.value}-01`
    })
    if (error) throw error
    competenciaFechada.value = true
    alert(`✅ Competência fechada!\n\nConciliadas: ${data.conciliadas}\nPendentes: ${data.pendentes}\n\n${data.aviso}`)
  } catch (err) {
    console.error(err)
    alert('Erro ao fechar: ' + err.message)
  } finally {
    fechandoCompetencia.value = false
  }
}
</script>
