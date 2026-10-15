<template>
  <div class="min-h-screen bg-slate-50 p-6 font-sans">
    
    <div class="max-w-7xl mx-auto mb-8">
      <h1 class="text-3xl font-bold text-slate-800 tracking-tight">Hub de Conciliação TIM</h1>
      <p class="text-slate-500 mt-1">Faça o upload do espelho da operadora e audite os pagamentos lado a lado.</p>
    </div>

    <!-- Upload Area (Drag & Drop) -->
    <div v-if="!arquivoCarregado" class="max-w-4xl mx-auto bg-white rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center hover:bg-slate-50 transition-colors cursor-pointer group">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50 text-indigo-600 mb-4 group-hover:scale-110 transition-transform">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
      </div>
      <h3 class="text-lg font-semibold text-slate-800 mb-1">Importar Espelho de Pagamento</h3>
      <p class="text-sm text-slate-500 mb-4">Arraste o arquivo Excel (.xlsx) ou CSV enviado pela TIM para este mês.</p>
      <button @click="simularUpload" class="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm">
        Selecionar Arquivo
      </button>
    </div>

    <!-- Dashboard de Auditoria (Aparece após o upload) -->
    <div v-else class="max-w-7xl mx-auto">
      
      <!-- Resumo do Bate de Valores -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm border-l-4 border-l-blue-500">
          <p class="text-sm font-medium text-slate-500">Processado TIM</p>
          <h3 class="text-2xl font-bold text-slate-800">R$ 4.120,50</h3>
          <p class="text-xs text-slate-400 mt-1">Total lido no arquivo</p>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm border-l-4 border-l-emerald-500">
          <p class="text-sm font-medium text-slate-500">Match Perfeito</p>
          <h3 class="text-2xl font-bold text-emerald-600">R$ 3.850,00</h3>
          <p class="text-xs text-slate-400 mt-1">Liberado para comissionar</p>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm border-l-4 border-l-red-500">
          <p class="text-sm font-medium text-slate-500">Glosado / Retido</p>
          <h3 class="text-2xl font-bold text-red-600">R$ 270,50</h3>
          <p class="text-xs text-slate-400 mt-1">3 Linhas retidas</p>
        </div>
        <div class="bg-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-center items-center text-center">
          <p class="text-sm font-medium text-slate-300 mb-2">Ação Requerida</p>
          <button class="w-full px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 font-bold transition-all shadow-md text-sm">
            Liberar Espelhos B2C
          </button>
        </div>
      </div>

      <!-- Tabela Side-by-Side (Inforteca vs TIM) -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h3 class="text-lg font-semibold text-slate-800">Auditoria de Linhas (Agosto 2026)</h3>
          <div class="flex gap-2">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">OK</span>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Glosa</span>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Divergência</span>
          </div>
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="text-xs uppercase tracking-wider">
                <th colspan="3" class="px-6 py-3 font-semibold text-slate-600 bg-slate-100 border-b border-r border-slate-200 text-center">Dados Internos (Inforteca)</th>
                <th colspan="3" class="px-6 py-3 font-semibold text-blue-800 bg-blue-50 border-b border-slate-200 text-center">Espelho TIM</th>
              </tr>
              <tr class="bg-white text-slate-500 text-xs tracking-wider border-b border-slate-200">
                <th class="px-6 py-3 font-medium">Consultor</th>
                <th class="px-6 py-3 font-medium">GSM / Plano</th>
                <th class="px-6 py-3 font-medium text-right border-r border-slate-200">Previsão (R$)</th>
                <th class="px-6 py-3 font-medium bg-blue-50/30">Valor Pago (R$)</th>
                <th class="px-6 py-3 font-medium bg-blue-50/30">Status TIM</th>
                <th class="px-6 py-3 font-medium bg-blue-50/30 text-center">Auditoria</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-sm text-slate-700">
              
              <!-- Linha: Match Perfeito -->
              <tr class="hover:bg-slate-50">
                <td class="px-6 py-4 font-medium">Daniel Alves</td>
                <td class="px-6 py-4">
                  <div class="font-medium">87 99999-1111</div>
                  <div class="text-xs text-slate-400">TIM Controle</div>
                </td>
                <td class="px-6 py-4 text-right border-r border-slate-200 font-medium">42,55</td>
                <td class="px-6 py-4 text-slate-800 font-medium">42,55</td>
                <td class="px-6 py-4 text-slate-500 text-xs">PAGO_INTEGRAL</td>
                <td class="px-6 py-4 text-center">
                  <span class="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-700">OK</span>
                </td>
              </tr>

              <!-- Linha: Glosa Documentação -->
              <tr class="hover:bg-slate-50 bg-red-50/30">
                <td class="px-6 py-4 font-medium">Ewerton Benevides</td>
                <td class="px-6 py-4">
                  <div class="font-medium">87 98888-2222</div>
                  <div class="text-xs text-slate-400">TIM Black A</div>
                </td>
                <td class="px-6 py-4 text-right border-r border-slate-200 font-medium">102,00</td>
                <td class="px-6 py-4 text-red-600 font-bold">0,00</td>
                <td class="px-6 py-4 text-red-600 text-xs font-medium">GLOSA: DOC PENDENTE 15D</td>
                <td class="px-6 py-4 text-center">
                  <span class="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-700">RETIDO</span>
                </td>
              </tr>

              <!-- Linha: Divergência de Valor -->
              <tr class="hover:bg-slate-50 bg-amber-50/30">
                <td class="px-6 py-4 font-medium">Caio</td>
                <td class="px-6 py-4">
                  <div class="font-medium">87 97777-3333</div>
                  <div class="text-xs text-slate-400">TIM Controle Plus</div>
                </td>
                <td class="px-6 py-4 text-right border-r border-slate-200 font-medium">58,00</td>
                <td class="px-6 py-4 text-amber-600 font-bold">42,55</td>
                <td class="px-6 py-4 text-amber-600 text-xs font-medium">DOWNGRADE CONTROLE EM 60D</td>
                <td class="px-6 py-4 text-center">
                  <span class="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-amber-100 text-amber-700">DIVERGE</span>
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

const arquivoCarregado = ref(false)

const simularUpload = () => {
  // Na versão real, isso ativará o input type="file" e rodará o parser JavaScript
  arquivoCarregado.value = true
}
</script>
