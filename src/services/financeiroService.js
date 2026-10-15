// src/services/financeiroService.js
import { supabase } from '@/lib/supabaseClient' // Ajuste para o caminho real do seu cliente Supabase

export const financeiroService = {
  
  // 1. Busca o cabeçalho do espelho do vendedor num mês específico
  async buscarEspelhoVendedor(vendedorId, mesCompetencia) {
    const { data, error } = await supabase
      .from('financeiro_espelhos_b2c')
      .select('*')
      .eq('vendedor_id', vendedorId)
      .eq('mes_competencia_venda', mesCompetencia)
      .single()
      
    if (error && error.code !== 'PGRST116') throw error // Ignora erro de "não encontrado" (PGRST116)
    return data
  },

  // 2. Busca os itens detalhados (linha a linha) desse espelho
  async buscarItensEspelho(espelhoId) {
    const { data, error } = await supabase
      .from('financeiro_espelho_itens')
      .select('*')
      .eq('espelho_id', espelhoId)
      .order('tipo_item', { ascending: true })
      
    if (error) throw error
    return data
  },

  // 3. Dispara a Procedure que construímos (A ser usado no Painel do Admin)
  async recalcularEspelhoB2C(mesCompetencia, vendedorId, bateuMetaPessoal, lojaBateuMeta) {
    const { data, error } = await supabase.rpc('calcular_espelho_comissao_b2c', {
      p_mes_competencia: mesCompetencia,
      p_vendedor_id: vendedorId,
      p_vendedor_bateu_meta: bateuMetaPessoal,
      p_loja_bateu_meta: lojaBateuMeta
    })
    
    if (error) throw error
    return data // Retorna o UUID do novo espelho gerado
  }
}
