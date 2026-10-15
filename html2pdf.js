<template>
  <div class="min-h-screen bg-slate-50 p-6 font-sans">
    
    <!-- Cabeçalho & Gamificação -->
    <div class="max-w-7xl mx-auto mb-8">
      <div class="flex justify-between items-end mb-4">
        <div>
          <h1 class="text-3xl font-bold text-slate-800 tracking-tight">Meu Extrato B2C</h1>
          <p class="text-slate-500 mt-1">Competência: <span class="font-medium text-slate-700">Agosto 2026</span> | Pagamento: <span class="font-medium text-slate-700">Outubro 2026</span></p>
        </div>
        <div class="text-right flex items-center gap-3">
          <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-emerald-100 text-emerald-800">
            <svg class="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
            Espelho Fechado
          </span>
          <!-- NOVO: Botão de Exportação PDF -->
          <button @click="gerarPDF" :disabled="isExporting" class="inline-flex items-center px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 font-medium transition-colors shadow-sm disabled:opacity-50">
            <svg v-if="isExporting" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            <svg v-else class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            {{ isExporting ? 'A gerar PDF...' : 'Baixar PDF' }}
          </button>
        </div>
      </div>
      
      <!-- O Alerta de Gamificação mantido aqui -->
    </div>

    <!-- ÁREA A SER EXPORTADA PARA PDF -->
    <div id="espelho-conteudo" class="bg-slate-50 pb-8">
      
      <!-- Cabeçalho Oculto (Só aparece no PDF para ficar profissional) -->
      <div class="hidden pdf-only text-center mb-8 pt-8">
        <h2 class="text-2xl font-bold text-slate-800">INFORTECA LTDA - Relatório de Remuneração</h2>
        <p class="text-slate-500">Consultor: Daniel Alves Ferreira | Competência: Agosto/2026</p>
        <hr class="mt-4 border-slate-300">
      </div>

      <!-- Cards de Resumo Financeiro (KPIs) -->
      <div class="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 px-6 md:px-0">
        <!-- Omissão das divs internas dos cards para brevidade, mantenha as originais -->
      </div>

      <!-- Tabela Detalhada (Audit Trail) -->
      <div class="max-w-7xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mx-6 md:mx-0">
         <!-- Omissão da tabela para brevidade, mantenha a original -->
      </div>
      
      <!-- Rodapé de Assinatura (Só aparece no PDF) -->
      <div class="hidden pdf-only mt-16 px-12 flex justify-between items-end">
        <div class="text-center w-64">
          <div class="border-t border-slate-800 pt-2">
            <p class="font-bold text-slate-800">Ewerton Benevides Oliveira</p>
            <p class="text-xs text-slate-500">Diretoria / Gestão Financeira</p>
          </div>
        </div>
        <div class="text-center w-64">
          <div class="border-t border-slate-800 pt-2">
            <p class="font-bold text-slate-800">Daniel Alves Ferreira</p>
            <p class="text-xs text-slate-500">Consultor de Vendas</p>
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

// Dados do espelho (Mantenha os que configurámos antes)
// const totalLiquido = ref('156,82')
// const espelhoItens = ref([...])

const gerarPDF = async () => {
  isExporting.value = true
  
  // Elemento que será convertido
  const element = document.getElementById('espelho-conteudo')
  
  // Configurações do PDF (Alta qualidade, formato A4)
  const opt = {
    margin:       [10, 0, 10, 0], // Top, Left, Bottom, Right
    filename:     `Espelho_Inforteca_Agosto_2026.pdf`,
    image:        { type: 'jpeg', quality: 1 },
    html2canvas:  { 
      scale: 2, 
      useCORS: true,
      scrollY: 0,
      windowWidth: 1200 // Força o layout de desktop
    },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }

  // Revela elementos específicos do PDF (Cabeçalho e Assinaturas)
  const pdfElements = document.querySelectorAll('.pdf-only')
  pdfElements.forEach(el => el.classList.remove('hidden'))

  try {
    await html2pdf().set(opt).from(element).save()
  } catch (error) {
    console.error("Erro ao gerar PDF:", error)
  } finally {
    // Oculta novamente os elementos específicos do PDF
    pdfElements.forEach(el => el.classList.add('hidden'))
    isExporting.value = false
  }
}
</script>

<style>
/* Garante que o fundo não fique transparente no PDF */
#espelho-conteudo {
  background-color: #f8fafc; /* bg-slate-50 */
}
</style>
