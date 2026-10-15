<template>
  <div class="min-h-screen bg-slate-50 p-6 font-sans">
    
    <!-- Cabeçalho & Gamificação (Fora do PDF) -->
    <div class="max-w-7xl mx-auto mb-8">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-end mb-4 gap-4">
        <div>
          <h1 class="text-3xl font-bold text-slate-800 tracking-tight">Meu Extrato B2C</h1>
          <p class="text-slate-500 mt-1">Competência: <span class="font-medium text-slate-700">Agosto 2026</span> | Pagamento: <span class="font-medium text-slate-700">Outubro 2026</span></p>
        </div>
        <div class="flex items-center gap-3">
          <span class="inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium bg-emerald-100 text-emerald-800">
            <svg class="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
            Espelho Fechado
          </span>
          
          <!-- Botão de Exportação PDF -->
          <button @click="gerarPDF" :disabled="isExporting" class="inline-flex items-center px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 font-medium transition-colors shadow-sm disabled:opacity-50">
            <svg v-if="isExporting" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            <svg v-else class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            {{ isExporting ? 'A gerar PDF...' : 'Baixar PDF' }}
          </button>
        </div>
      </div>

      <!-- Alerta de Meta (Gamificação - Não entra no PDF) -->
      <div class="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg">
        <h2 class="text-lg font-semibold mb-2">Você está na faixa: Ativou, Ganhou (20%) 🚀</h2>
        <p class="text-blue-100 text-sm mb-4">Faltam apenas <strong>3 vendas Controle</strong> para você destravar a <span class="text-white font-bold">Meta Pessoal (30%)</span> e ganhar um bônus retroativo sobre tudo que já vendeu no mês!</p>
        <div class="w-full bg-blue-900/50 rounded-full h-3">
          <div class="bg-white h-3 rounded-full" style="width: 75%"></div>
        </div>
        <p class="text-right text-xs mt-2 text-blue-200">75% da meta atingida</p>
      </div>
    </div>

    <!-- ========================================== -->
    <!-- ÁREA A SER EXPORTADA PARA PDF              -->
    <!-- ========================================== -->
    <div id="espelho-conteudo" class="bg-slate-50 pb-8 pt-4">
      
      <!-- Cabeçalho Oficial Oculto (Só aparece no PDF) -->
      <div class="hidden pdf-only text-center mb-8 px-8">
        <h2 class="text-2xl font-bold text-slate-800 uppercase tracking-wide">INFORTECA LTDA - Relatório de Remuneração</h2>
        <div class="flex justify-between items-center mt-4 text-sm text-slate-600 font-medium">
          <p>Consultor: <span class="font-bold text-slate-800">Daniel Alves Ferreira</span></p>
          <p>Competência: <span class="font-bold text-slate-800">Agosto / 2026</span></p>
          <p>Status: <span class="font-bold text-emerald-600">FECHADO</span></p>
        </div>
        <hr class="mt-4 border-slate-300">
      </div>

      <!-- Cards de Resumo Financeiro (KPIs) -->
      <div class="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 px-6 md:px-0">
        <!-- Card 1: Total a Receber -->
        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm relative overflow-hidden">
          <div class="absolute right-0 top-0 w-24 h-24 bg-emerald-50 rounded-bl-full -mr-4 -mt-4 opacity-50"></div>
          <p class="text-sm font-medium text-slate-500 mb-1">Total a Receber</p>
          <h3 class="text-3xl font-bold text-slate-800">R$ {{ totalLiquido }}</h3>
        </div>
        
        <!-- Card 2: Serviços -->
        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <p class="text-sm font-medium text-slate-500 mb-1">Serviços TIM</p>
          <h3 class="text-2xl font-bold text-slate-700">R$ 64,31</h3>
          <p class="text-xs text-indigo-600 mt-2 font-medium">8 Ativações</p>
        </div>

        <!-- Card 3: Aparelhos -->
        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <p class="text-sm font-medium text-slate-500 mb-1">Aparelhos SMB</p>
          <h3 class="text-2xl font-bold text-slate-700">R$ 64,96</h3>
          <p class="text-xs text-amber-600 mt-2 font-medium">1,00% Fator Aplicado</p>
        </div>

        <!-- Card 4: Acessórios -->
        <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <p class="text-sm font-medium text-slate-500 mb-1">Acessórios</p>
          <h3 class="text-2xl font-bold text-slate-700">R$ 27,55</h3>
          <p class="text-xs text-cyan-600 mt-2 font-medium">0,50% Fator Aplicado</p>
        </div>
      </div>

      <!-- Tabela Detalhada (Audit Trail) -->
      <div class="max-w-7xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mx-6 md:mx-0">
        <div class="px-6 py-5 border-b border-slate-200 bg-slate-50/50">
          <h3 class="text-lg font-semibold text-slate-800">Extrato Detalhado</h3>
          <p class="text-xs text-slate-500">Composição do cálculo da comissão com base na qualidade M-6 da TIM.</p>
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
              <tr v-for="item in espelhoItens" :key="item.id" class="hover:bg-slate-50 transition-colors">
                <td class="px-6 py-4">
                  <div class="font-medium text-slate-800">{{ item.descricao }}</div>
                  <div class="text-xs font-semibold text-indigo-500 mt-0.5" v-if="item.e_portabilidade">Portabilidade (+15%)</div>
                </td>
                <td class="px-6 py-4 text-right">R$ {{ item.valor_referencia }}</td>
                <td class="px-6 py-4 text-center">
                  <span v-if="item.tipo === 'SERVICO'" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                    {{ item.qualidade }}%
                  </span>
                  <span v-else class="text-slate-300">-</span>
                </td>
                <td class="px-6 py-4 text-right text-slate-500 font-medium">R$ {{ item.base_liquida }}</td>
                <td class="px-6 py-4 text-center">
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-700">
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
      
      <!-- Rodapé de Assinatura (Só aparece no PDF) -->
      <div class="hidden pdf-only mt-20 px-16 flex justify-between items-end">
        <div class="text-center w-64">
          <div class="border-t-2 border-slate-800 pt-2">
            <p class="font-bold text-slate-800">Ewerton Benevides Oliveira</p>
            <p class="text-xs text-slate-500 uppercase mt-1">Gestão Financeira</p>
          </div>
        </div>
        <div class="text-center w-64">
          <div class="border-t-2 border-slate-800 pt-2">
            <p class="font-bold text-slate-800">Daniel Alves Ferreira</p>
            <p class="text-xs text-slate-500 uppercase mt-1">Consultor de Vendas</p>
          </div>
        </div>
      </div>
      
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import html2pdf from 'html2pdf.js'

// Variáveis de estado
const isExporting = ref(false)
const totalLiquido = ref('156,82')

// Mock array imitando o retorno da tabela financeiro_espelho_itens
const espelhoItens = ref([
  { id: 1, descricao: 'TIM Controle', tipo: 'SERVICO', e_portabilidade: false, valor_referencia: '55,00', qualidade: '73,08', base_liquida: '40,19', fator_aplicado: '20', comissao_final: '8,03' },
  { id: 2, descricao: 'TIM Controle', tipo: 'SERVICO', e_portabilidade: true, valor_referencia: '55,00', qualidade: '73,08', base_liquida: '40,19', fator_aplicado: '20', comissao_final: '8,03' },
  { id: 3, descricao: 'Acessório - Capa Anti Impacto XYZ', tipo: 'ACESSORIO', e_portabilidade: false, valor_referencia: '90,00', qualidade: '100', base_liquida: '90,00', fator_aplicado: '0.50', comissao_final: '0,45' },
  { id: 4, descricao: 'Smartphone XYZ 128GB', tipo: 'APARELHO', e_portabilidade: false, valor_referencia: '1.200,00', qualidade: '100', base_liquida: '1.200,00', fator_aplicado: '1.00', comissao_final: '12,00' }
])

// Função que gera e descarrega o PDF
const gerarPDF = async () => {
  isExporting.value = true
  
  const element = document.getElementById('espelho-conteudo')
  
  // Opções para garantir alta resolução e um formato de folha A4 perfeito
  const opt = {
    margin:       [15, 10, 15, 10], // Margens [Cima, Esquerda, Baixo, Direita]
    filename:     `Comissao_Daniel_Agosto_2026.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { 
      scale: 2, 
      useCORS: true,
      windowWidth: 1024 // Força a largura de desktop para não quebrar a tabela
    },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }

  // Mostra as zonas oficiais para o PDF (Cabeçalho e Assinatura)
  const pdfElements = document.querySelectorAll('.pdf-only')
  pdfElements.forEach(el => el.classList.remove('hidden'))

  try {
    await html2pdf().set(opt).from(element).save()
  } catch (error) {
    console.error("Erro ao gerar PDF:", error)
    alert("Ocorreu um erro ao exportar o documento.")
  } finally {
    // Esconde novamente para manter a UI limpa
    pdfElements.forEach(el => el.classList.add('hidden'))
    isExporting.value = false
  }
}
</script>

<style scoped>
/* Fundo branco/slate consistente no PDF gerado */
#espelho-conteudo {
  background-color: #f8fafc;
}
</style>
