<template>
  <div class="min-h-screen bg-slate-50 p-6 font-sans">
    
    <div class="max-w-7xl mx-auto mb-8">
      <h1 class="text-3xl font-bold text-slate-800 tracking-tight">Hub de Conciliação TIM</h1>
      <p class="text-slate-500 mt-1">Faça o upload do espelho da operadora e audite os pagamentos lado a lado.</p>
      
      <!-- Seletor de Mês -->
      <div class="mt-4 flex items-center gap-3">
        <label class="text-sm font-medium text-slate-700">Competência:</label>
        <input type="month" v-model="mesCompetencia" class="rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm">
      </div>
    </div>

    <!-- Upload Area (Drag & Drop Real) -->
    <div 
      v-if="!arquivoCarregado" 
      @dragover.prevent 
      @dragenter.prevent 
      @drop.prevent="processarDrop"
      class="max-w-4xl mx-auto bg-white rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center hover:bg-slate-50 transition-colors cursor-pointer group"
      :class="{'opacity-50 pointer-events-none': isProcessingUpload}"
    >
      <input type="file" ref="fileInput" @change="processarSelecaoArquivo" accept=".xlsx, .xls, .csv" class="hidden" />

      <div v-if="isProcessingUpload" class="flex flex-col items-center justify-center">
        <svg class="animate-spin h-10 w-10 text-indigo-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <h3 class="text-lg font-semibold text-slate-800">Processando espelho...</h3>
        <p class="text-sm text-slate-500">Cruzando linhas com a base de dados Inforteca.</p>
      </div>

      <div v-else>
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50 text-indigo-600 mb-4 group-hover:scale-110 transition-transform">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
        </div>
        <h3 class="text-lg font-semibold text-slate-800 mb-1">Importar Espelho de Pagamento</h3>
        <p class="text-sm text-slate-500 mb-4">Arraste o arquivo Excel (.xlsx) enviado pela TIM para este mês.</p>
        <button @click="triggerFileInput" class="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm">
          Selecionar Arquivo
        </button>
      </div>
    </div>

    <!-- Dashboard de Auditoria (Aparece após o upload) -->
    <div v-else class="max-w-7xl mx-auto animate-fade-in-up">
      
      <!-- Resumo do Bate de Valores -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm border-l-4 border-l-blue-500">
          <p class="text-sm font-medium text-slate-500">Processado TIM</p>
          <h3 class="text-2xl font-bold text-slate-800">{{ resumo.processado }} Linhas</h3>
          <p class="text-xs text-slate-400 mt-1">Total lido no arquivo</p>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm border-l-4 border-l-emerald-500">
          <p class="text-sm font-medium text-slate-500">Match Perfeito</p>
          <h3 class="text-2xl font-bold text-emerald-600">{{ resumo.match }}</h3>
          <p class="text-xs text-slate-400 mt-1">Encontrado no VEXO</p>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm border-l-4 border-l-red-500">
          <p class="text-sm font-medium text-slate-500">Glosado / Divergente</p>
          <h3 class="text-2xl font-bold text-red-600">{{ resumo.glosa }}</h3>
          <p class="text-xs text-slate-400 mt-1">Linhas retidas</p>
        </div>
        <div class="bg-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-center items-center text-center">
          <p class="text-sm font-medium text-slate-300 mb-2">Ação Requerida</p>
          <button @click="resetar" class="w-full px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-500 font-bold transition-all shadow-md text-sm flex items-center justify-center">
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            Nova Conciliação
          </button>
        </div>
      </div>

      <!-- Tabela Side-by-Side (Dinâmica) -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h3 class="text-lg font-semibold text-slate-800">Auditoria de Linhas ({{ mesCompetencia }})</h3>
          <div class="flex gap-2">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">Match Perfeito</span>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Não Encontrado / Glosa</span>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Divergência</span>
          </div>
        </div>
        
        <div class="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table class="w-full text-left border-collapse">
            <thead class="sticky top-0 z-10 bg-white">
              <tr class="text-xs uppercase tracking-wider">
                <th colspan="3" class="px-6 py-3 font-semibold text-slate-600 bg-slate-100 border-b border-r border-slate-200 text-center">Dados Internos (VEXO)</th>
                <th colspan="3" class="px-6 py-3 font-semibold text-blue-800 bg-blue-50 border-b border-slate-200 text-center">Espelho TIM</th>
              </tr>
              <tr class="bg-white text-slate-500 text-xs tracking-wider border-b border-slate-200 shadow-sm">
                <th class="px-6 py-3 font-medium">Consultor</th>
                <th class="px-6 py-3 font-medium">GSM / CPF</th>
                <th class="px-6 py-3 font-medium text-right border-r border-slate-200">Previsão (R$)</th>
                <th class="px-6 py-3 font-medium bg-blue-50/30">Valor Pago (R$)</th>
                <th class="px-6 py-3 font-medium bg-blue-50/30">Status TIM</th>
                <th class="px-6 py-3 font-medium bg-blue-50/30 text-center">Auditoria</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-sm text-slate-700">
              
              <tr v-for="linha in linhasAuditoria" :key="linha.id" 
                  class="hover:bg-slate-50 transition-colors"
                  :class="{
                    'bg-red-50/30': linha.auditoria === 'RETIDO',
                    'bg-amber-50/30': linha.auditoria === 'DIVERGE'
                  }">
                <td class="px-6 py-4 font-medium">{{ linha.consultor }}</td>
                <td class="px-6 py-4">
                  <div class="font-medium">{{ linha.gsm }}</div>
                  <div class="text-xs text-slate-400">{{ linha.plano }}</div>
                </td>
                <td class="px-6 py-4 text-right border-r border-slate-200 font-medium text-slate-500">
                  {{ linha.previsao.toFixed(2).replace('.', ',') }}
                </td>
                
                <td class="px-6 py-4 font-bold"
                    :class="{
                      'text-emerald-600': linha.auditoria === 'OK',
                      'text-red-600': linha.auditoria === 'RETIDO',
                      'text-amber-600': linha.auditoria === 'DIVERGE'
                    }">
                  {{ linha.pago.toFixed(2).replace('.', ',') }}
                </td>
                
                <td class="px-6 py-4 text-xs font-medium"
                    :class="{
                      'text-slate-500': linha.auditoria === 'OK',
                      'text-red-600': linha.auditoria === 'RETIDO',
                      'text-amber-600': linha.auditoria === 'DIVERGE'
                    }">
                  {{ linha.status }}
                </td>
                
                <td class="px-6 py-4 text-center">
                  <span v-if="linha.auditoria === 'OK'" class="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-700">MATCH</span>
                  <span v-if="linha.auditoria === 'RETIDO'" class="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-700">GLOSA</span>
                  <span v-if="linha.auditoria === 'DIVERGE'" class="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-amber-100 text-amber-700">DIVERGÊNCIA</span>
                </td>
              </tr>

              <tr v-if="linhasAuditoria.length === 0">
                <td colspan="6" class="px-6 py-12 text-center text-slate-500">
                  Nenhuma linha processada. Verifique o arquivo enviado.
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
import { supabase } from '@/lib/supabaseClient' // Ajuste o caminho

const fileInput = ref(null)
const arquivoCarregado = ref(false)
const isProcessingUpload = ref(false)
const mesCompetencia = ref('2026-08') // Padrão Inicial

const resumo = ref({
  processado: 0,
  match: 0,
  glosa: 0
})
const linhasAuditoria = ref([])

const triggerFileInput = () => fileInput.value.click()
const processarDrop = (event) => { const file = event.dataTransfer.files[0]; if (file) manipularArquivo(file) }
const processarSelecaoArquivo = (event) => { const file = event.target.files[0]; if (file) manipularArquivo(file) }
const resetar = () => { arquivoCarregado.value = false; linhasAuditoria.value = []; fileInput.value.value = null }

const manipularArquivo = (file) => {
  isProcessingUpload.value = true
  const reader = new FileReader()

  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      const linhasExcel = XLSX.utils.sheet_to_json(firstSheet)

      // 1. Mapeamento das colunas da TIM
      const payloadLimpo = linhasExcel.map(linha => ({
        gsm: (linha['NUMERO_LINHA'] || linha['GSM'] || linha['telefone'])?.toString(), 
        cpf: (linha['CPF_CLIENTE'] || linha['CPF'] || linha['cpf'])?.toString(),
        valor_pago: parseFloat(linha['VALOR_REMUNERADO'] || linha['valor_pago'] || 0),
        motivo_glosa: linha['STATUS_REJEICAO'] || linha['motivo'] || 'PAGO'
      }))

      // 2. Chama a Procedure de Match no Supabase
      const dataSQL = `${mesCompetencia.value}-01`
      const { data: resultadoRpc, error: rpcError } = await supabase.rpc('processar_conciliacao_tim', {
        p_mes_competencia: dataSQL,
        p_dados_espelho: payloadLimpo
      })
      
      if (rpcError) throw rpcError;

      resumo.value = {
        processado: resultadoRpc.linhas_processadas || 0,
        match: resultadoRpc.matches_perfeitos || 0,
        glosa: resultadoRpc.glosas || 0
      }

      // 3. Busca o detalhe das linhas gravadas na tabela de auditoria para montar a View Side-by-Side
      const { data: detalhes, error: detalhesError } = await supabase
        .from('financeiro_conciliacao_tim')
        .select(`
          id, tim_gsm, tim_valor_pago, tim_motivo_glosa, status_conciliacao, diferenca_valor,
          interacoes ( vendedor, categoria, valor_total )
        `)
        .eq('lote_importacao_id', resultadoRpc.lote_id)
        .order('status_conciliacao', { ascending: false }) // Mostra glosas primeiro

      if (detalhesError) throw detalhesError;

      // 4. Mapeia para a Tabela Vue
      linhasAuditoria.value = detalhes.map(d => {
        let statusTag = 'OK'
        if (d.status_conciliacao === 'GLOSADO' || d.status_conciliacao === 'NAO_ENCONTRADO_SISTEMA') statusTag = 'RETIDO'
        if (d.status_conciliacao === 'DIVERGENCIA_VALOR') statusTag = 'DIVERGE'

        return {
          id: d.id,
          consultor: d.interacoes?.vendedor || 'Não Identificado',
          gsm: d.tim_gsm || 'Sem GSM',
          plano: d.interacoes?.categoria || '-',
          previsao: parseFloat(d.interacoes?.valor_total || 0),
          pago: parseFloat(d.tim_valor_pago || 0),
          status: d.tim_motivo_glosa || 'PAGO',
          auditoria: statusTag
        }
      })

      arquivoCarregado.value = true
    } catch (error) {
      console.error('Erro na conciliação TIM:', error)
      alert('Falha ao processar a conciliação. Verifique os dados ou o console.')
    } finally {
      isProcessingUpload.value = false
    }
  }

  reader.readAsArrayBuffer(file)
}
</script>

<style scoped>
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
  animation: fadeInUp 0.4s ease-out forwards;
}
</style>
