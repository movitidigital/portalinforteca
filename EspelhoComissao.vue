<template>
  <div class="min-h-screen bg-slate-50 p-6 font-sans">
    
    <!-- Cabeçalho & Gamificação -->
    <div class="max-w-7xl mx-auto mb-8">
      <div class="flex justify-between items-end mb-4">
        <div>
          <h1 class="text-3xl font-bold text-slate-800 tracking-tight">Meu Extrato B2C</h1>
          <p class="text-slate-500 mt-1">Competência: <span class="font-medium text-slate-700">Agosto 2026</span> | Pagamento: <span class="font-medium text-slate-700">Outubro 2026</span></p>
        </div>
        <div class="text-right">
          <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-emerald-100 text-emerald-800">
            <svg class="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
            Espelho Fechado
          </span>
        </div>
      </div>

      <!-- Alerta de Meta (Gamificação) -->
      <div class="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg">
        <h2 class="text-lg font-semibold mb-2">Você está na faixa: Ativou, Ganhou (20%) 🚀</h2>
        <p class="text-blue-100 text-sm mb-4">Faltam apenas <strong>3 vendas Controle</strong> para você destravar a <span class="text-white font-bold">Meta Pessoal (30%)</span> e ganhar um bônus retroativo sobre tudo que já vendeu no mês!</p>
        <div class="w-full bg-blue-900/50 rounded-full h-3">
          <div class="bg-white h-3 rounded-full" style="width: 75%"></div>
        </div>
        <p class="text-right text-xs mt-2 text-blue-200">75% da meta atingida</p>
      </div>
    </div>

    <!-- Cards de Resumo Financeiro (KPIs) -->
    <div class="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      <!-- Card 1: Total a Receber -->
      <div class="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm relative overflow-hidden">
        <div class="absolute right-0 top-0 w-24 h-24 bg-emerald-50 rounded-bl-full -mr-4 -mt-4 opacity-50"></div>
        <p class="text-sm font-medium text-slate-500 mb-1">Total a Receber</p>
        <h3 class="text-3xl font-bold text-slate-800">R$ {{ totalLiquido }}</h3>
      </div>
      
      <!-- Card 2: Serviços -->
      <div class="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
        <p class="text-sm font-medium text-slate-500 mb-1">Serviços TIM</p>
        <h3 class="text-2xl font-bold text-slate-700">R$ 64,31</h3>
        <p class="text-xs text-indigo-600 mt-2 font-medium">8 Ativações</p>
      </div>

      <!-- Card 3: Aparelhos -->
      <div class="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
        <p class="text-sm font-medium text-slate-500 mb-1">Aparelhos SMB</p>
        <h3 class="text-2xl font-bold text-slate-700">R$ 64,96</h3>
        <p class="text-xs text-amber-600 mt-2 font-medium">1,00% Fator</p>
      </div>

      <!-- Card 4: Acessórios -->
      <div class="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
        <p class="text-sm font-medium text-slate-500 mb-1">Acessórios</p>
        <h3 class="text-2xl font-bold text-slate-700">R$ 27,55</h3>
        <p class="text-xs text-cyan-600 mt-2 font-medium">0,50% Fator</p>
      </div>
    </div>

    <!-- Tabela Detalhada (Audit Trail) -->
    <div class="max-w-7xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="px-6 py-5 border-b border-slate-200 bg-slate-50/50">
        <h3 class="text-lg font-semibold text-slate-800">Extrato Detalhado</h3>
        <p class="text-xs text-slate-500">Transparência total: veja como sua comissão foi calculada linha a linha.</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <th class="px-6 py-4 font-medium border-b border-slate-200">Produto/Serviço</th>
              <th class="px-6 py-4 font-medium border-b border-slate-200 text-right">Valor Ref.</th>
              <th class="px-6 py-4 font-medium border-b border-slate-200 text-center">Qualidade (M-6)</th>
              <th class="px-6 py-4 font-medium border-b border-slate-200 text-right">Base Líquida</th>
              <th class="px-6 py-4 font-medium border-b border-slate-200 text-center">Faixa %</th>
              <th class="px-6 py-4 font-medium border-b border-slate-200 text-right">Comissão R$</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-sm text-slate-700">
            <!-- Linha de Exemplo (Serviço TIM) -->
            <tr v-for="item in espelhoItens" :key="item.id" class="hover:bg-slate-50 transition-colors">
              <td class="px-6 py-4">
                <div class="font-medium text-slate-800">{{ item.descricao }}</div>
                <div class="text-xs text-slate-400 mt-0.5" v-if="item.e_portabilidade">Portabilidade</div>
              </td>
              <td class="px-6 py-4 text-right">R$ {{ item.valor_referencia }}</td>
              <td class="px-6 py-4 text-center">
                <span v-if="item.tipo === 'SERVICO'" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                  {{ item.qualidade }}%
                </span>
                <span v-else class="text-slate-300">-</span>
              </td>
              <td class="px-6 py-4 text-right text-slate-500">R$ {{ item.base_liquida }}</td>
              <td class="px-6 py-4 text-center">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                  {{ item.fator_aplicado }}%
                </span>
              </td>
              <td class="px-6 py-4 text-right font-bold text-emerald-600">
                R$ {{ item.comissao_final }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref } from 'vue'

// O total do Espelho do Daniel que usamos como exemplo
const totalLiquido = ref('156,82')

// Mock array imitando o retorno da nossa procedure do Supabase (tabela financeiro_espelho_itens)
const espelhoItens = ref([
  { id: 1, descricao: 'TIM Controle', tipo: 'SERVICO', e_portabilidade: false, valor_referencia: '55,00', qualidade: '73,08', base_liquida: '40,19', fator_aplicado: '20', comissao_final: '8,03' },
  { id: 2, descricao: 'TIM Controle', tipo: 'SERVICO', e_portabilidade: true, valor_referencia: '55,00', qualidade: '73,08', base_liquida: '40,19', fator_aplicado: '20', comissao_final: '8,03' },
  { id: 3, descricao: 'Acessório - Capa Anti Impacto', tipo: 'ACESSORIO', e_portabilidade: false, valor_referencia: '90,00', qualidade: '100', base_liquida: '90,00', fator_aplicado: '0.50', comissao_final: '0,45' },
  { id: 4, descricao: 'Smartphone XYZ', tipo: 'APARELHO', e_portabilidade: false, valor_referencia: '1.200,00', qualidade: '100', base_liquida: '1.200,00', fator_aplicado: '1.00', comissao_final: '12,00' }
])
</script>
