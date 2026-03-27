/**
 * neuroauth_compliance_engine.js
 * NEUROAUTH COMPLIANCE ENGINE v1.0.1
 *
 * Motor de Conformidade TISS + Anti-Glosa em 3 Camadas
 *
 * CAMADA 1 — ANS/TISS regulatório (obrigatório universal)
 * CAMADA 2 — Boas práticas anti-glosa (recomendado, sem fonte exigida)
 * CAMADA 3 — Regras por operadora (apenas quando houver fonte oficial)
 *
 * Princípio: nenhuma regra de Camada 3 é marcada "obrigatória"
 * sem source_type !== "regra_interna".
 *
 * @version 1.0.0
 * @license Proprietary — NeuroAuth © 2026
 */

(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.NEUROAUTH_COMPLIANCE = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var VERSION = '1.0.1';

  /* =========================================================================
   * CAMADA 1 — PADRÃO ANS/TISS OBRIGATÓRIO
   * Fonte: Resolução Normativa ANS 501/2022 + Padrão TISS vigente
   * As operadoras NÃO podem alterar estes campos nem exigir papel
   * quando o padrão eletrônico é aplicável.
   * ========================================================================= */
  var TISS_REQUIRED = {
    source_type:      'ans_oficial',
    source_reference: 'Padrão TISS ANS — RN 501/2022 e Componente Organizacional vigente',
    confidence_level: 'alta',

    /* Campos obrigatórios no padrão TISS para Guia SP/SADT */
    sadt: [
      'codigo_ans',         // Campo 1  — Registro ANS da operadora
      'numero_carteira',    // Campo 8  — Número da carteira do beneficiário
      'nome_paciente',      // Campo 10 — Nome do beneficiário
      'medico_solicitante', // Campo 15 — Nome do profissional solicitante
      'crm',                // Campo 17 — Número no Conselho (CRM)
      'cbo',                // Campo 19 — CBO do profissional
      'carater_cod',        // Campo 21 — Caráter do atendimento (E/U/X)
      'data_solicitacao',   // Campo 22 — Data da solicitação
      'indicacao_clinica',  // Campo 23 — Indicação clínica
      'procedimento',       // Campo 26 — Descrição do procedimento solicitado
      'cod_cbhpm'           // Campo 25 — Código do procedimento (CBHPM/TUSS)
    ],

    /* Campos obrigatórios no padrão TISS para Guia OPME */
    opme: [
      'codigo_ans',
      'numero_carteira',
      'nome_paciente',
      'medico_solicitante',
      'crm',
      'cbo',
      'procedimento',
      'justificativa_opme',  // Justificativa clínica para uso de OPME
      'opme_items'           // Ao menos 1 item OPME descrito
    ],

    recommended_fields: [
      'cns',              // CNS — recomendado TISS, não sempre obrigatório
      'validade_carteira',
      'cid_principal',    // CID — fortemente recomendado, obrigatório em muitos contextos
      'hospital'
    ]
  };

  /* =========================================================================
   * CAMADA 2 — BOAS PRÁTICAS ANTI-GLOSA (neurocirurgia)
   * Regras derivadas de experiência clínica e lógica TISS.
   * Não dependem de manual de operadora.
   * São recomendações — não bloqueiam impressão, apenas alertam.
   * ========================================================================= */
  var ANTI_GLOSA_BEST_PRACTICES = [
    {
      id:          'cid_obrigatorio',
      layer:       2,
      label:       'CID principal preenchido',
      description: 'Ausência de CID é a causa mais comum de glosa administrativa. Sem CID o auditor não consegue validar cobertura.',
      check:       function(d) { return !!(d.cid_principal && d.cid_principal.trim().length >= 3); },
      severity:    'alto',
      fields:      ['cid_principal']
    },
    {
      id:          'indicacao_minima',
      layer:       2,
      label:       'Indicação clínica com mínimo 40 caracteres',
      description: 'Campo 23 preenchido superficialmente é glosado por falta de justificativa. Mínimo aceitável: 40 chars com dados clínicos reais.',
      check:       function(d) { return !!(d.indicacao_clinica && d.indicacao_clinica.trim().length >= 40); },
      severity:    'alto',
      fields:      ['indicacao_clinica']
    },
    {
      id:          'opme_com_justificativa',
      layer:       2,
      label:       'OPME sempre acompanhada de justificativa',
      description: 'Solicitação de OPME sem justificativa clínica é glosa certa. A justificativa deve conter indicação, falha de tratamento conservador e necessidade específica do implante.',
      check:       function(d) {
        if (!_isOpmeAtivo(d.necessita_opme)) return true;
        return !!(d.justificativa_opme && d.justificativa_opme.trim().length >= 30);
      },
      severity:    'critico',
      fields:      ['justificativa_opme', 'necessita_opme']
    },
    {
      id:          'cid_coerente_procedimento',
      layer:       2,
      label:       'CID coerente com procedimento neurocirúrgico',
      description: 'CID fora do grupo M/G/S para neurocirurgia levanta suspeita de inconsistência. Verificar.',
      check:       function(d) {
        if (!d.cid_principal) return false; // já coberto por cid_obrigatorio
        var cid = d.cid_principal.toUpperCase();
        var neuroCids = ['M', 'G', 'S', 'T', 'Q', 'C'];
        return neuroCids.some(function(prefix) { return cid.startsWith(prefix); });
      },
      severity:    'medio',
      fields:      ['cid_principal', 'procedimento']
    },
    {
      id:          'tto_conservador_documentado',
      layer:       2,
      label:       'Tratamento conservador documentado (quando aplicável)',
      description: 'Para procedimentos eletivos, a ausência de registro de tratamento conservador prévio é argumento frequente de negativa. Preencher campo.',
      check:       function(d) {
        var eletivo = d.carater_cod === 'E';
        if (!eletivo) return true;
        return !!(d.tto_conservador && d.tto_conservador !== '');
      },
      severity:    'medio',
      fields:      ['tto_conservador', 'carater_cod']
    },
    {
      id:          'achados_exame_presentes',
      layer:       2,
      label:       'Achados de imagem documentados',
      description: 'Para neurocirurgia, achados de RM/TC são evidência clínica primária. Ausência aumenta risco de negativa por falta de lastro diagnóstico.',
      check:       function(d) {
        return !!(d.achados_resumo && d.achados_resumo.trim().length > 10) ||
               !!(d.achados_exame  && d.achados_exame.trim().length  > 10);
      },
      severity:    'alto',
      fields:      ['achados_resumo', 'achados_exame', 'exame_principal']
    },
    {
      id:          'opme_descricao_completa',
      layer:       2,
      label:       'Itens OPME com descrição, quantidade e empresa',
      description: 'Item OPME sem descrição completa ou quantidade é glosado na conferência de fatura.',
      check:       function(d) {
        if (!d.opme_items || d.opme_items.length === 0) return true;
        return d.opme_items.every(function(item) {
          return item && item.descricao && item.descricao.trim().length > 3 &&
                 Number(item.qtd) > 0;
        });
      },
      severity:    'critico',
      fields:      ['opme_items']
    },
    {
      id:          'medico_dados_completos',
      layer:       2,
      label:       'Médico com CRM e CBO preenchidos',
      description: 'Guia sem CRM ou CBO do solicitante é rejeitada automaticamente por sistemas de auditoria eletrônica.',
      check:       function(d) {
        return !!(d.medico_solicitante && d.crm && d.cbo);
      },
      severity:    'critico',
      fields:      ['medico_solicitante', 'crm', 'cbo']
    }
  ];

  /* =========================================================================
   * CAMADA 3 — REGRAS ESPECÍFICAS POR OPERADORA
   *
   * POLÍTICA: cada entrada DEVE conter source_type e source_reference.
   * Se source_type === "regra_interna", a regra é RECOMENDAÇÃO, nunca bloqueio.
   * Se source_type === "manual_oficial" | "portal_oficial", pode ser validada
   * como obrigatória APENAS se confidence_level === "alta".
   * ========================================================================= */
  var CONVENIO_RULES_LIBRARY = {

    /* ── TISS default (fallback universal) ─────────────────────────────── */
    default_tiss: {
      id:               'default_tiss',
      nome:             'Padrão TISS ANS (fallback universal)',
      source_type:      'ans_oficial',
      source_reference: 'Padrão TISS ANS — RN 501/2022',
      confidence_level: 'alta',
      required_fields:  TISS_REQUIRED.sadt,
      recommended_fields: TISS_REQUIRED.recommended_fields,
      layout_constraints: {},
      print_overrides:  {},
      validation_messages: {
        codigo_ans:         'Registro ANS da operadora obrigatório (campo 1 TISS)',
        numero_carteira:    'Número da carteira do beneficiário obrigatório (campo 8 TISS)',
        nome_paciente:      'Nome do beneficiário obrigatório (campo 10 TISS)',
        medico_solicitante: 'Nome do médico solicitante obrigatório (campo 15 TISS)',
        crm:                'CRM do médico obrigatório (campo 17 TISS)',
        cbo:                'CBO do médico obrigatório (campo 19 TISS)',
        indicacao_clinica:  'Indicação clínica obrigatória (campo 23 TISS)',
        procedimento:       'Descrição do procedimento obrigatória (campo 26 TISS)'
      }
    },

    /* ── Unimed (placeholder — sem manual oficial carregado ainda) ──────── */
    unimed: {
      id:               'unimed',
      nome:             'Unimed',
      source_type:      'regra_interna',
      source_reference: 'Preencher com: nome do manual, versão e data quando documento oficial for obtido junto à Unimed.',
      confidence_level: 'baixa',
      // Sem fonte oficial → nenhum campo marcado como obrigatório desta operadora
      required_fields:  [],
      recommended_fields: [
        'justificativa_opme',
        'achados_resumo',
        'cid_principal',
        'tto_conservador'
      ],
      layout_constraints: {
        /* Preencher após obter manual oficial */
      },
      print_overrides: {
        /* Preencher após obter manual oficial */
      },
      validation_messages: {
        justificativa_opme: 'Recomendado (anti-glosa): justificativa OPME detalhada',
        achados_resumo:     'Recomendado (anti-glosa): achados de imagem documentados'
      },
      _note: 'Regras específicas Unimed pendentes de documento oficial. Tratar como recomendações anti-glosa até obtenção do manual.'
    },

    /* ── Bradesco Saúde (placeholder) ───────────────────────────────────── */
    bradesco: {
      id:               'bradesco',
      nome:             'Bradesco Saúde',
      source_type:      'regra_interna',
      source_reference: 'Preencher com manual oficial Bradesco Saúde quando disponível.',
      confidence_level: 'baixa',
      required_fields:  [],
      recommended_fields: ['cid_principal', 'justificativa_opme', 'achados_resumo'],
      layout_constraints: {},
      print_overrides:  {},
      validation_messages: {}
    },

    /* ── Hapvida (placeholder) ──────────────────────────────────────────── */
    hapvida: {
      id:               'hapvida',
      nome:             'Hapvida',
      source_type:      'regra_interna',
      source_reference: 'Preencher com manual oficial Hapvida quando disponível.',
      confidence_level: 'baixa',
      required_fields:  [],
      recommended_fields: ['cid_principal', 'justificativa_opme'],
      layout_constraints: {},
      print_overrides:  {},
      validation_messages: {}
    },

    /* ── Particular / sem convênio ──────────────────────────────────────── */
    particular: {
      id:               'particular',
      nome:             'Particular',
      source_type:      'regra_interna',
      source_reference: 'Sem regulação de operadora. Apenas TISS/ANS aplicável.',
      confidence_level: 'alta',
      required_fields:  [],
      recommended_fields: ['indicacao_clinica', 'justificativa_opme'],
      layout_constraints: {},
      print_overrides:  {},
      validation_messages: {}
    }
  };

  /* =========================================================================
   * MATRIZ UI → PAYLOAD → PRINT
   * Colunas:
   *   ui_field         — id do campo no HTML
   *   payload_path     — chave no objeto collect()
   *   print_target     — onde aparece no render ('sadt', 'opme', 'ambos', 'nenhum')
   *   print_field_num  — número do campo TISS no formulário impresso
   *   required_tiss    — obrigatório pelo padrão TISS
   *   layer            — 1=TISS, 2=anti-glosa, 0=sem criticidade
   *   gap              — true se coletado mas não impresso (perda de dado)
   * ========================================================================= */
  var FIELD_MATRIX = [
    // ── PACIENTE ──────────────────────────────────────────────────────────
    { ui_field:'nome_paciente',    payload_path:'nome_paciente',    print_target:'ambos',   print_field_num:'10/8', required_tiss:true,  layer:1, gap:false },
    { ui_field:'data_nascimento',  payload_path:'data_nascimento',  print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Coletado, mas não impresso. Adicionar ao SADT se operadora exigir.' },
    { ui_field:'idade',            payload_path:'idade',            print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:0, gap:true,  gap_note:'Derivado, não impresso. Útil para audit trail.' },
    { ui_field:'sexo',             payload_path:'sexo',             print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:0, gap:true,  gap_note:'Coletado, não impresso no TISS padrão.' },
    { ui_field:'cpf',              payload_path:'cpf',              print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'CPF não está na guia TISS padrão, mas algumas operadoras exigem no papel. Gap a resolver por operadora.' },
    { ui_field:'telefone',         payload_path:'telefone',         print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:0, gap:true  },
    { ui_field:'email',            payload_path:'email',            print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:0, gap:true  },
    { ui_field:'cns',              payload_path:'cns',              print_target:'sadt',    print_field_num:'11',   required_tiss:false, layer:1, gap:false, gap_note:'Recomendado TISS. Impresso no SADT campo 11.' },
    { ui_field:'comorbidades',     payload_path:'comorbidades',     print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'⚠️ Gap crítico: comorbidades coletadas mas não impressas. Relevante para justificativa clínica neurocirúrgica.' },

    // ── CONVÊNIO ──────────────────────────────────────────────────────────
    { ui_field:'convenio',         payload_path:'convenio',         print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:1, gap:true,  gap_note:'Nome do convênio não está no template de impressão (logo hardcoded). Rever para multi-operadora.' },
    { ui_field:'codigo_ans',       payload_path:'codigo_ans',       print_target:'ambos',   print_field_num:'1',    required_tiss:true,  layer:1, gap:false },
    { ui_field:'numero_carteira',  payload_path:'numero_carteira',  print_target:'ambos',   print_field_num:'8/7',  required_tiss:true,  layer:1, gap:false },
    { ui_field:'validade_carteira',payload_path:'validade_carteira',print_target:'sadt',    print_field_num:'9',    required_tiss:false, layer:1, gap:false },
    { ui_field:'carater',          payload_path:'carater_cod',      print_target:'sadt',    print_field_num:'21',   required_tiss:true,  layer:1, gap:false },
    { ui_field:'tipo_guia',        payload_path:'tipo_guia',        print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Tipo de guia (SADT/OPME/Internação) não está explícito no print, apenas no título.' },
    { ui_field:'hospital',         payload_path:'hospital',         print_target:'sadt',    print_field_num:'14/30',required_tiss:false, layer:1, gap:false },
    { ui_field:'regime',           payload_path:'regime',           print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Regime (ambulatorial/internação) coletado mas não impresso. Pode ser exigido.' },
    { ui_field:'obs_convenio',     payload_path:'obs_convenio',     print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Obs convênio não chega ao print. Considerar incluir em campo 58 (Observação).' },

    // ── PROCEDIMENTO ──────────────────────────────────────────────────────
    { ui_field:'procedimento',     payload_path:'procedimento',     print_target:'ambos',   print_field_num:'26',   required_tiss:true,  layer:1, gap:false },
    { ui_field:'codigo_proc',      payload_path:'codigo_proc',      print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:1, gap:true,  gap_note:'Código do procedimento armazenado mas print usa cod_cbhpm. Verificar consistência.' },
    { ui_field:'cid_principal',    payload_path:'cid_principal',    print_target:'nenhum',  print_field_num:null,   required_tiss:true,  layer:1, gap:true,  gap_note:'⚠️ Gap crítico: CID principal coletado mas NÃO impresso no SADT. Causa comum de glosa.' },
    { ui_field:'cid2',             payload_path:'cid2',             print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'CID secundário coletado, não impresso.' },
    { ui_field:'cod_cbhpm',        payload_path:'cod_cbhpm',        print_target:'sadt',    print_field_num:'25',   required_tiss:true,  layer:1, gap:false },
    { ui_field:'cod_tuss',         payload_path:'cod_tuss',         print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Código TUSS coletado, não impresso. Considerar adicionar ao lado do CBHPM.' },
    { ui_field:'regiao',           payload_path:'regiao',           print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true  },
    { ui_field:'lateralidade',     payload_path:'lateralidade',     print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Lateralidade não impressa. Para neurocirurgia pode ser relevante para auditoria.' },
    { ui_field:'qtd_niveis',       payload_path:'qtd_niveis',       print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Quantidade de níveis não impressa. Relevante para OPME multinível.' },
    { ui_field:'niveis_anatomicos',payload_path:'niveis_anatomicos',print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true  },
    { ui_field:'via_acesso',       payload_path:'via_acesso',       print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Via de acesso (aberta/endoscópica/MIS) não impressa. Pode ser relevante para código CBHPM.' },
    { ui_field:'data_cirurgia',    payload_path:'data_cirurgia',    print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Data da cirurgia não está no print. Considerar campo de data prevista.' },
    { ui_field:'prioridade',       payload_path:'prioridade',       print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true  },

    // ── CLÍNICO / JUSTIFICATIVA ───────────────────────────────────────────
    { ui_field:'deficit_neuro',    payload_path:'deficit_neuro',    print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'⚠️ Gap crítico: déficit neurológico coletado mas não impresso. Critério clínico fundamental para neurocirurgia.' },
    { ui_field:'dor_refrataria',   payload_path:'dor_refrataria',   print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'⚠️ Gap crítico: dor refratária coletada, não impressa. Critério de urgência.' },
    { ui_field:'tto_conservador',  payload_path:'tto_conservador',  print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'⚠️ Gap crítico: tratamento conservador coletado, não impresso. Argumento anti-negativa.' },
    { ui_field:'duracao_tto',      payload_path:'duracao_tto',      print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true  },
    { ui_field:'exame_principal',  payload_path:'exame_principal',  print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Tipo de exame (RM/TC) não impresso. Útil na justificativa.' },
    { ui_field:'achados_resumo',   payload_path:'achados_resumo',   print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'⚠️ Gap: achados de imagem resumidos coletados, não impressos diretamente. Entram na indicação clínica apenas se o médico incluir manualmente.' },
    { ui_field:'indicacao_clinica',payload_path:'indicacao_clinica',print_target:'sadt',    print_field_num:'23',   required_tiss:true,  layer:1, gap:false },
    { ui_field:'achados_exame',    payload_path:'achados_exame',    print_target:'sadt',    print_field_num:'58',   required_tiss:false, layer:2, gap:false, gap_note:'Impresso no campo 58 (Observação/Justificativa).' },

    // ── MÉDICO ────────────────────────────────────────────────────────────
    { ui_field:'medico_solicitante',payload_path:'medico_solicitante',print_target:'ambos', print_field_num:'15/9', required_tiss:true,  layer:1, gap:false },
    { ui_field:'crm',              payload_path:'crm',              print_target:'ambos',   print_field_num:'17',   required_tiss:true,  layer:1, gap:false },
    { ui_field:'cbo',              payload_path:'cbo',              print_target:'ambos',   print_field_num:'19',   required_tiss:true,  layer:1, gap:false },
    { ui_field:'tel_medico',       payload_path:'tel_medico',       print_target:'opme',    print_field_num:'10',   required_tiss:false, layer:2, gap:false },

    // ── OPME / SADT ───────────────────────────────────────────────────────
    { ui_field:'necessita_opme',   payload_path:'necessita_opme',   print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Flag de necessidade OPME não impressa (implícita na existência da guia OPME).' },
    { ui_field:'necessita_sadt',   payload_path:'necessita_sadt',   print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true  },
    { ui_field:'opme_items',       payload_path:'opme_items',       print_target:'opme',    print_field_num:'tabela',required_tiss:true,  layer:1, gap:false },
    { ui_field:'empresa_opme',     payload_path:'empresa_opme',     print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'Empresa OPME coletada mas não mapeada para os itens individuais nem impressa no campo fabricante.' },
    { ui_field:'justificativa_opme',payload_path:'justificativa_opme',print_target:'opme',  print_field_num:'just', required_tiss:true,  layer:1, gap:false },
    { ui_field:'sadt_solicitado',  payload_path:'sadt_solicitado',  print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:2, gap:true,  gap_note:'⚠️ Gap: exames SADT perioperatórios coletados mas não aparecem na guia SADT impressa.' },
    { ui_field:'status_inicial',   payload_path:'status_inicial',   print_target:'nenhum',  print_field_num:null,   required_tiss:false, layer:0, gap:false },
    { ui_field:'obs_finais',       payload_path:'obs_finais',       print_target:'sadt',    print_field_num:'58',   required_tiss:false, layer:2, gap:false }
  ];

  /* =========================================================================
   * GAPS CRÍTICOS — campos coletados que NÃO chegam ao print
   * ========================================================================= */
  var CRITICAL_GAPS = [
    {
      field:      'cid_principal',
      severity:   'critico',
      impact:     'CID é o principal critério de auditoria. Ausência no print causa glosa imediata em auditorias eletrônicas.',
      fix:        'Adicionar campo CID na seção de Dados da Solicitação da guia SADT, entre campos 22 e 23.'
    },
    {
      field:      'deficit_neuro + dor_refrataria + tto_conservador',
      severity:   'alto',
      impact:     'Critérios clínicos de indicação cirúrgica coletados no formulário nunca chegam ao documento impresso. Médico precisa digitá-los manualmente na indicação clínica.',
      fix:        'Consolidar automaticamente esses campos no campo indicacao_clinica antes do render, ou adicionar seção de Critérios Clínicos ao template.'
    },
    {
      field:      'achados_resumo',
      severity:   'alto',
      impact:     'Achados de imagem (RM/TC) coletados separadamente mas não impressos. O campo 58 recebe apenas obs_finais ou achados_exame.',
      fix:        'Mesclar achados_resumo no campo 58 ou criar sub-seção de Achados de Imagem.'
    },
    {
      field:      'sadt_solicitado',
      severity:   'medio',
      impact:     'Exames perioperatórios solicitados (hemograma, coagulograma, ECG) coletados mas ausentes do print.',
      fix:        'Adicionar lista de exames SADT correlatos como linhas extras na tabela de procedimentos quando tipo_guia inclui SADT.'
    },
    {
      field:      'comorbidades',
      severity:   'medio',
      impact:     'Comorbidades relevantes (DM, HAS, uso de anticoagulantes) coletadas mas ausentes do print. Podem ser relevantes para justificativa de OPME.',
      fix:        'Incluir comorbidades relevantes no campo 58 quando preenchidas.'
    },
    {
      field:      'convenio (logo hardcoded)',
      severity:   'medio',
      impact:     'Logo Unimed Cariri está hardcoded no template. Para outros convênios, o documento impresso terá logo errado.',
      fix:        'Parametrizar logo e nome da operadora no render baseado no campo convenio selecionado.'
    }
  ];

  /* =========================================================================
   * FUNÇÃO: validateBeforePrint(payload, operatorId)
   *
   * Retorna:
   *   { can_print: bool, blocks: [], warnings: [] }
   *   blocks   — impedem impressão (TISS obrigatório ou operadora oficial)
   *   warnings — alertas anti-glosa (não bloqueiam)
   * ========================================================================= */
  function validateBeforePrint(payload, operatorId) {
    var result = {
      can_print: true,
      blocks:    [],
      warnings:  []
    };

    if (!payload) {
      result.can_print = false;
      result.blocks.push({ field: 'payload', message: 'Dados do formulário não encontrados.', layer: 1 });
      return result;
    }

    var opId  = (operatorId || 'default_tiss').toLowerCase();
    var rules = CONVENIO_RULES_LIBRARY[opId] || CONVENIO_RULES_LIBRARY['default_tiss'];

    // ── CAMADA 1: validar campos obrigatórios TISS ──────────────────────
    // Fix 1: clonar antes de modificar — evita contaminar TISS_REQUIRED.sadt global
    var tissRequired = TISS_REQUIRED.sadt.slice();
    if (_isOpmeAtivo(payload.necessita_opme)) {
      TISS_REQUIRED.opme.forEach(function(f) {
        if (tissRequired.indexOf(f) === -1) tissRequired.push(f);
      });
    }

    tissRequired.forEach(function(field) {
      var val = payload[field];
      var missing = !val || (typeof val === 'string' && val.trim() === '');
      // Fix 3: validação robusta de opme_items — exige item com descrição e qtd > 0
      if (field === 'opme_items') {
        missing = !val || !Array.isArray(val) || val.length === 0 ||
          !val.some(function(item) {
            return item && item.descricao && item.descricao.trim().length > 0 &&
                   Number(item.qtd) > 0;
          });
      }
      if (missing) {
        result.can_print = false;
        var msg = (CONVENIO_RULES_LIBRARY['default_tiss'].validation_messages || {})[field]
                  || ('Campo obrigatório TISS ausente: ' + field);
        result.blocks.push({ field: field, message: msg, layer: 1, source: 'ANS/TISS RN 501/2022' });
      }
    });

    // ── CAMADA 3: campos obrigatórios da operadora (só se fonte oficial) ─
    if (rules.source_type !== 'regra_interna' && rules.confidence_level === 'alta') {
      (rules.required_fields || []).forEach(function(field) {
        var val = payload[field];
        if (!val || (typeof val === 'string' && val.trim() === '')) {
          result.can_print = false;
          var msg = (rules.validation_messages || {})[field] || ('Campo obrigatório pela operadora: ' + field);
          result.blocks.push({ field: field, message: msg, layer: 3, source: rules.source_reference });
        }
      });
    }

    // ── CAMADA 2: boas práticas anti-glosa (warnings, não blocks) ────────
    ANTI_GLOSA_BEST_PRACTICES.forEach(function(rule) {
      try {
        var ok = rule.check(payload);
        if (!ok) {
          result.warnings.push({
            id:       rule.id,
            fields:   rule.fields,
            message:  rule.label,
            detail:   rule.description,
            severity: rule.severity,
            layer:    2
          });
        }
      } catch(e) { /* silencioso */ }
    });

    // ── CAMADA 3 (recomendações por operadora) como warnings ─────────────
    // Fix 4: deduplicar — não adicionar warning se já coberto pela Camada 2
    var warnIds = result.warnings.map(function(w) { return w.id; });
    var warnFields = result.warnings.reduce(function(acc, w) {
      (w.fields || []).forEach(function(f) { acc[f] = true; });
      return acc;
    }, {});

    (rules.recommended_fields || []).forEach(function(field) {
      if (warnFields[field]) return; // já avisado pela camada 2
      var val = payload[field];
      var empty = !val || (typeof val === 'string' && val.trim() === '');
      if (empty) {
        var id = 'op_rec_' + field;
        if (warnIds.indexOf(id) !== -1) return; // deduplicar por id
        var msg = (rules.validation_messages || {})[field]
                  || ('Recomendado pela operadora ' + rules.nome + ': ' + field);
        result.warnings.push({
          id:       id,
          fields:   [field],
          message:  msg,
          severity: 'baixo',
          layer:    3,
          source:   rules.source_reference
        });
      }
    });

    return result;
  }

  /* =========================================================================
   * FUNÇÃO: adjustUIForOperator(operatorId)
   *
   * Retorna objeto de configuração de UI para o operador dado.
   * NÃO manipula o DOM diretamente — retorna instruções para o caller.
   * ========================================================================= */
  function adjustUIForOperator(operatorId) {
    var opId  = (operatorId || '').toLowerCase().replace(/\s+/g, '_');
    var rules = CONVENIO_RULES_LIBRARY[opId] || null;

    // fallback: usar default_tiss
    var base = CONVENIO_RULES_LIBRARY['default_tiss'];

    return {
      operator_id:        opId,
      operator_name:      rules ? rules.nome : operatorId,
      source_type:        rules ? rules.source_type : 'ans_oficial',
      confidence_level:   rules ? rules.confidence_level : 'alta',

      // Campos a destacar como obrigatórios — deduplicados (Fix 4)
      highlight_required: _dedupe(
        (rules && rules.source_type !== 'regra_interna')
          ? base.required_fields.concat(rules.required_fields || [])
          : base.required_fields
      ),

      // Campos a destacar como recomendados — deduplicados (Fix 4)
      highlight_recommended: _dedupe(
        (rules ? rules.recommended_fields : []).concat(base.recommended_fields)
      ),

      // Campos que podem ser escondidos (nunca usados por esta operadora)
      // REGRA: nunca esconder campo clínico relevante — só campos administrativos vazios
      hide_when_empty:    [],

      // Mensagens de tooltip personalizadas por campo
      field_hints:        rules ? (rules.validation_messages || {}) : base.validation_messages,

      // Aviso de fonte se regra interna
      disclaimer: (rules && rules.source_type === 'regra_interna')
        ? 'Regras específicas para ' + (rules.nome || operatorId) + ' ainda não possuem fonte oficial documentada. Exibindo apenas recomendações anti-glosa.'
        : null
    };
  }

  /* =========================================================================
   * FUNÇÃO: getGaps()
   * Retorna a lista de gaps críticos (campos coletados mas não impressos)
   * ========================================================================= */
  function getGaps() {
    return FIELD_MATRIX.filter(function(f) { return f.gap === true; })
      .map(function(f) {
        return {
          field:       f.ui_field,
          layer:       f.layer,
          print_target: f.print_target,
          note:        f.gap_note || ''
        };
      });
  }

  /* =========================================================================
   * FUNÇÃO: getCriticalGlosaFields()
   * Campos mais importantes para prevenção de glosa administrativa
   * ========================================================================= */
  function getCriticalGlosaFields() {
    return [
      { field: 'cid_principal',      reason: 'Critério primário de auditoria. Ausência = glosa automática.' },
      { field: 'indicacao_clinica',  reason: 'Campo 23 TISS. Texto insuficiente = glosa por falta de justificativa.' },
      { field: 'justificativa_opme', reason: 'OPME sem justificativa = glosa na conferência de fatura.' },
      { field: 'cod_cbhpm',          reason: 'Código incorreto = glosa por incompatibilidade tabela/procedimento.' },
      { field: 'crm',                reason: 'CRM ausente = rejeição automática por auditoria eletrônica.' },
      { field: 'cbo',                reason: 'CBO ausente ou incompatível com procedimento = glosa.' },
      { field: 'tto_conservador',    reason: 'Para eletivos: ausência de registro de conservador = negativa por critério.' },
      { field: 'achados_resumo',     reason: 'Achados de imagem fundamentam indicação cirúrgica neurocirúrgica.' }
    ];
  }

  /* =========================================================================
   * HELPERS INTERNOS
   * ========================================================================= */

  // Fix 2: normaliza necessita_opme para boolean — aceita 'Sim','sim','true','1','yes',true
  function _isOpmeAtivo(val) {
    if (val === true) return true;
    if (!val) return false;
    var s = String(val).trim().toLowerCase();
    return s === 'sim' || s === 'true' || s === '1' || s === 'yes';
  }

  // Fix 4: remove duplicatas de um array preservando ordem
  function _dedupe(arr) {
    var seen = {};
    return (arr || []).filter(function(item) {
      if (seen[item]) return false;
      seen[item] = true;
      return true;
    });
  }

  /* =========================================================================
   * API PÚBLICA
   * ========================================================================= */
  return {
    VERSION:                VERSION,
    TISS_REQUIRED:          TISS_REQUIRED,
    ANTI_GLOSA_BEST_PRACTICES: ANTI_GLOSA_BEST_PRACTICES,
    CONVENIO_RULES_LIBRARY: CONVENIO_RULES_LIBRARY,
    FIELD_MATRIX:           FIELD_MATRIX,
    CRITICAL_GAPS:          CRITICAL_GAPS,
    validateBeforePrint:    validateBeforePrint,
    adjustUIForOperator:    adjustUIForOperator,
    getGaps:                getGaps,
    getCriticalGlosaFields: getCriticalGlosaFields,
    _helpers: {
      isOpmeAtivo: _isOpmeAtivo,
      dedupe:      _dedupe
    }
  };

}));
