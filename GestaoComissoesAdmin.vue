<template>
  <div class="min-h-screen bg-slate-50 p-6 font-sans">
    
    <div class="max-w-5xl mx-auto mb-8">
      <h1 class="text-3xl font-bold text-slate-800 tracking-tight">Gestão de Comissões e Metas</h1>
      <p class="text-slate-500 mt-1">Configure os parâmetros da TIM e dispare o cálculo da folha B2C.</p>
    </div>

    <!-- Seletor de Competência -->
    <div class="max-w-5xl mx-auto bg-white rounded-2xl p-6 border border-slate-200 shadow-sm mb-6 flex items-end gap-4">
      <div class="flex-1">
        <label class="block text-sm font-medium text-slate-700 mb-1">Mês de Competência (Venda)</label>
        <input type="month" v-model="mesCompetencia" class="w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-slate-700">
      </div>
      <button @click="buscarDadosCompetencia" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-medium transition-colors">
        Carregar Dados
      </button>
    </div>

    <div class="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      
      <!-- Card 1: Carta Meta TIM -->
      <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm relative">
        <div class="absolute top-0 right-0 p-4">
          <span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">Dados da Operadora</span>
        </div>
        <h2 class="text-xl font-semibold text-slate-800 mb-4">Carta Meta TIM</h2>
        
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Qualidade Pós-Pago (%)</label>
            <div class="relative">
              <input type="number" step="0.01" v-model="form.qtPos" class="w-full rounded-lg border-slate-300 pl-3 pr-8 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
              <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <span class="text-slate-500 sm:text-sm">%</span>
              </div>
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Qualidade Controle (%)</label>
             <div class="relative">
              <input type="number" step="0.01" v-model="form.qtControle" class="w-full rounded-lg border-slate-300 pl-3 pr-8 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
              <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <span class="text-slate-500 sm:text-sm">%</span>
              </div>
            </div>
          </div>
        </div>

        <div class="mb-4">
          <label class="block text-xs font-medium text-slate-500 mb-1">Meta Financeira Total TIM (R$)</label>
          <input type="number" step="0.01" v-model="form.metaTimFinanceira" class="w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Meta Volume Pós</label>
            <input type="number" v-model="form.metaTimPos" class="w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Meta Volume Controle</label>
            <input type="number" v-model="form.metaTimControle" class="w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
          </div>
        </div>
      </div>

      <!-- Card 2: Metas Inforteca (Sombra) -->
      <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm relative">
         <div class="absolute top-0 right-0 p-4">
          <span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">Metas Internas (Loja)</span>
        </div>
        <h2 class="text-xl font-semibold text-slate-800 mb-4">Metas Inforteca</h2>
        
        <div class="mb-4 mt-10">
          <label class="block text-xs font-medium text-slate-500 mb-1">Meta Financeira da Loja (R$)</label>
          <input type="number" step="0.01" v-model="form.metaIntFinanceira" class="w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
          <p class="text-[10px] text-slate-400 mt-1">Margem sugerida: 20% acima da TIM (R$ {{ (form.metaTimFinanceira * 1.2).toFixed(2) }})</p>
        </div>

        <div class="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Volume Pós Interno</label>
            <input type="number" v-model="form.metaIntPos" class="w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Volume Controle Interno</label>
            <input type="number" v-model="form.metaIntControle" class="w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
          </div>
        </div>
        
        <div class="flex justify-end pt-4 border-t border-slate-100">
           <button @click="salvarMetas" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm flex items-center">
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            Salvar Parâmetros
          </button>
        </div>
      </div>

    </div>

    <!-- Painel de Ação: Fechamento de Folha -->
    <div class="max-w-5xl mx-auto bg-slate-800 rounded-2xl p-8 shadow-lg flex items-center justify-between">
      <div>
        <h3 class="text-xl font-bold text-white mb-1">Disparar Cálculo de Comissões</h3>
        <p class="text-slate-400 text-sm">Isto irá processar todas as vendas de <strong>{{ mesCompetenciaFormatado }}</strong> utilizando as metas salvas acima.</p>
      </div>
      <button @click="gerarEspelhos" :disabled="isProcessing" class="px-6 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-bold transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center">
        <svg v-if="isProcessing" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <svg v-else class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
        {{ isProcessing ? 'Processando DRE...' : 'Gerar Espelhos B2C' }}
      </button>
    </div>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
// Assumindo que você tem o supabase inicializado no seu projeto
// import { supabase } from '@/lib/supabaseClient'

const mesCompetencia = ref('2026-08')
const isProcessing = ref(false)

const form = ref({
  qtPos: 85.00,
  qtControle: 77.78,
  metaTimFinanceira: 4632.44,
  metaTimPos: 7,
  metaTimControle: 63,
  metaIntFinanceira: 5558.00,
  metaIntPos: 10,
  metaIntControle: 80
})

const mesCompetenciaFormatado = computed(() => {
  if (!mesCompetencia.value) return ''
  const [ano, mes] = mesCompetencia.value.split('-')
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  return `${meses[parseInt(mes)-1]} de ${ano}`
})

const buscarDadosCompetencia = async () => {
  // Aqui você faria um select na tabela financeiro_metas_mensais
  console.log('Buscando dados para', mesCompetencia.value)
}

const salvarMetas = async () => {
  // Inserte/Update na tabela financeiro_metas_mensais
  console.log('Salvando...', form.value)
  alert('Metas salvas com sucesso!')
}

const gerarEspelhos = async () => {
  isProcessing.value = true
  try {
    // 1. Você faria um fetch de todos os vendedores ativos
    // 2. Loop sobre os vendedores para checar se eles bateram a meta individual
    // 3. Chamaria a função RPC para cada um:
    /*
    const { data, error } = await supabase.rpc('calcular_espelho_comissao_b2c', {
      p_mes_competencia: `${mesCompetencia.value}-01`,
      p_vendedor_id: 'ID_DO_VENDEDOR',
      p_vendedor_bateu_meta: true, // calculado no JS
      p_loja_bateu_meta: true // calculado no JS
    })
    */
    
    // Simulando delay de processamento
    await new Promise(resolve => setTimeout(resolve, 2000))
    alert(`Espelhos de ${mesCompetenciaFormatado.value} gerados com sucesso! O dashboard dos consultores já está atualizado.`)
  } catch (error) {
    console.error('Erro ao gerar', error)
  } finally {
    isProcessing.value = false
  }
}
</script>
