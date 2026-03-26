/**
 * ============================================================
 * NEUROAUTH_CLINICAL_AUTOFILL_ENGINE
 * v1.0.0 — Copiloto Clínico de Autorização Cirúrgica
 *
 * Camada de inteligência clínica independente do render engine.
 * Não altera: renderEngine.js, BRADESCO_OVERRIDE, BRADESCO_FIELD_MAP,
 * RENDER_SPEC_MASTER_SADT_OPME, estrutura TISS.
 *
 * Pipeline: input clínico livre → parseProcedimento → inferClinicalData
 *           → mapToTISSPayload → renderEngine (intocado)
 * ============================================================
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// NEURO_PROCEDURE_LIBRARY
// Fonte única de verdade clínica para todos os procedimentos suportados.
// Cada entrada: sinônimos, TUSS, CID padrão, justificativa-base,
// flag OPME obrigatório, template OPME com cálculo por nível.
// ─────────────────────────────────────────────────────────────────────────────
const NEURO_PROCEDURE_LIBRARY = {

  "artrodese_lombar": {
    label: "Artrodese Lombar (Fixação Posterior)",
    synonyms: [
      "artrodese lombar", "fusao lombar", "fixacao lombar", "fixacao de coluna",
      "estabilizacao posterior", "artrodese vertebral", "fusao vertebral lombar",
      "cirurgia de coluna lombar", "instrumentacao lombar", "plif", "tlif",
      "posterior lumbar interbody fusion", "transforaminal lumbar"
    ],
    tuss: "30715016",
    tabela_tuss: "22",
    cid_padrao: "M43.1",
    cid_alternativo: ["M51.1", "M48.0", "M43.0"],
    justificativa_base:
      "Paciente apresenta quadro de dor lombar crônica refratária ao tratamento conservador " +
      "por mais de 6 meses, com instabilidade segmentar documentada em {nivel} por exames de " +
      "imagem (radiografia dinâmica e/ou RM). Indicada artrodese cirúrgica com instrumentação " +
      "pedicular para estabilização definitiva, descompressão neural e restauração da altura discal.",
    opme_obrigatorio: true,
    regime_internacao: "2",
    carater_atendimento: "1",
    opme_template: [
      {
        item: "Parafuso Pedicular Polyaxial Titânio",
        codigo_material: "20714100010",
        referencia: "POLY-PED-5.5",
        qtd_base: 2,
        por_nivel: true,
        nivel_mode: "vertebra",
        anvisa: "80072700018",
        fabricante: "DePuy Synthes / Stryker Brasil",
        unidade: "UN",
        justificativa: "Fixação pedicular bilateral para instrumentação posterior e estabilização segmentar em {nivel}. Parafuso polyaxial garante ajuste angular intraoperatório e redução de stress na interface implante-osso."
      },
      {
        item: "Haste Longitudinal CoCr 5.5mm",
        codigo_material: "20714100020",
        referencia: "ROD-COCR-5.5",
        qtd_base: 2,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "80072700021",
        fabricante: "DePuy Synthes / Stryker Brasil",
        unidade: "UN",
        justificativa: "Haste de cobalto-cromo bilateral para conexão dos parafusos pediculares e manutenção do alinhamento sagital. 2 hastes necessárias para montagem bilateral padrão."
      },
      {
        item: "Crosslink / Conector Transversal",
        codigo_material: "20714100025",
        referencia: "XLINK-STD",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "80072700025",
        fabricante: "DePuy Synthes / Stryker Brasil",
        unidade: "UN",
        justificativa: "Conector transversal para aumento da rigidez torsional da montagem pedicular bilateral. Reduz risco de falha por fadiga do sistema."
      },
      {
        item: "Cage Intersomático PEEK/Titânio",
        codigo_material: "20714100030",
        referencia: "CAGE-PEEK-LIF",
        qtd_base: 1,
        por_nivel: true,
        nivel_mode: "disco",
        anvisa: "80072700030",
        fabricante: "Alphatec / NuVasive Brasil",
        unidade: "UN",
        justificativa: "Espaçador intersomático para restauração da altura discal e fusão interbody em {nivel}. Material PEEK/titânio com superfície porosa para integração óssea."
      }
    ]
  },

  "microdiscectomia": {
    label: "Microdiscectomia",
    synonyms: [
      "microdiscectomia", "hernia de disco", "microcirurgia hernia discal",
      "discectomia lombar", "cirurgia hernia", "hernia discal lombar",
      "descompressao radicular", "hld", "protrusion discal cirurgia",
      "hernia disco lombossacra", "ciatalgia cirurgia"
    ],
    tuss: "30715180",
    tabela_tuss: "22",
    cid_padrao: "M51.1",
    cid_alternativo: ["M54.4", "M51.0"],
    justificativa_base:
      "Paciente com hérnia discal em {nivel}, apresentando radiculopatia persistente " +
      "com irradiação para membro inferior, com falha do tratamento conservador por " +
      "mais de 6 semanas. Exame de imagem (RM) confirma compressão radicular por " +
      "material discal extrusado. Indicada microdiscectomia para descompressão neural.",
    opme_obrigatorio: false,
    regime_internacao: "2",
    carater_atendimento: "1",
    opme_template: []
  },

  "derivacao_ventriculo_peritoneal": {
    label: "Derivação Ventricular Peritoneal (DVP)",
    synonyms: [
      "dvp", "derivacao ventriculo peritoneal", "valvula de derivacao",
      "hidrocefalia cirurgia", "derivacao liquorica", "shunt ventriculoperitoneal",
      "ventriculoperitoneal shunt", "valvula anti-sifao", "derivacao hidrocefalia"
    ],
    tuss: "30704016",
    tabela_tuss: "22",
    cid_padrao: "G91.9",
    cid_alternativo: ["G91.0", "G91.1", "G91.2"],
    justificativa_base:
      "Paciente com hidrocefalia sintomática — cefaleia progressiva, alteração de marcha " +
      "e distúrbio cognitivo — com dilatação ventricular documentada em RM/TC. " +
      "Indicada derivação ventriculoperitoneal com válvula programável para controle " +
      "da hipertensão intracraniana e restauração da dinâmica do LCR.",
    opme_obrigatorio: true,
    regime_internacao: "2",
    carater_atendimento: "1",
    opme_template: [
      {
        item: "Válvula de Derivação Programável",
        codigo_material: "20704100010",
        referencia: "VALVE-PROG-STD",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "10332340152",
        fabricante: "Medtronic / Integra Brasil",
        unidade: "UN",
        justificativa: "Válvula de derivação ventriculoperitoneal programável por telemetria magnética. Permite ajuste não-invasivo da pressão de abertura no pós-operatório."
      },
      {
        item: "Cateter Ventricular Silicone",
        codigo_material: "20704100020",
        referencia: "CATH-VENT-14FR",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "10332340153",
        fabricante: "Medtronic / Integra Brasil",
        unidade: "UN",
        justificativa: "Cateter ventricular radiopaco para punção e drenagem ventricular. Impregnado com antibiótico para redução de risco de infecção."
      },
      {
        item: "Cateter Peritoneal Silicone",
        codigo_material: "20704100030",
        referencia: "CATH-PERIT-30CM",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "10332340154",
        fabricante: "Medtronic / Integra Brasil",
        unidade: "UN",
        justificativa: "Cateter peritoneal para drenagem distal do LCR na cavidade peritoneal. Comprimento adequado para crescimento em pacientes pediátricos."
      }
    ]
  },

  "craniotomia_tumor": {
    label: "Craniotomia para Ressecção Tumoral",
    synonyms: [
      "craniotomia tumor", "resseccao tumoral cerebral", "tumor cerebral cirurgia",
      "craniotomia para tumor", "exerese neoplasia cerebral", "craniotomia glioma",
      "craniotomia meningioma", "craniotomia gbm", "glioblastoma cirurgia",
      "ressecao cerebral", "craniotomia para neoplasia"
    ],
    tuss: "30706018",
    tabela_tuss: "22",
    cid_padrao: "C71.9",
    cid_alternativo: ["C71.0", "C71.1", "C71.2", "D33.0", "D43.0"],
    justificativa_base:
      "Paciente com lesão expansiva intracraniana — compatível com neoplasia cerebral — " +
      "com efeito de massa, edema perilesional e/ou déficit neurológico progressivo, " +
      "documentada por RM com contraste. Indicada craniotomia para ressecção máxima " +
      "segura da lesão, obtenção de material histológico e descompressão neural.",
    opme_obrigatorio: true,
    regime_internacao: "2",
    carater_atendimento: "1",
    opme_template: [
      {
        item: "Sistema de Fixação Craniana Titânio (placa + parafusos)",
        codigo_material: "20161400070",
        referencia: "CRANIOPLAST-KIT",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "10223710035",
        fabricante: "Stryker Brasil / DePuy Synthes",
        unidade: "KIT",
        justificativa: "Reposicionamento e fixação rígida do retalho ósseo após craniotomia. Sistema de placa e parafusos de titânio previne deslocamento e assegura cicatrização óssea adequada."
      },
      {
        item: "Substituto Dural Biológico Absorvível",
        codigo_material: "20161200041",
        referencia: "DURA-BIO-5X6",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "80378070002",
        fabricante: "Integra LifeSciences Brasil",
        unidade: "UN",
        justificativa: "Substituto dural para duroplastia quando dura-máter comprometida por infiltração tumoral ou insuficiente para fechamento primário. Previne fístula liquórica e pseudomeningocele."
      }
    ]
  },

  "biopsia_cerebral": {
    label: "Biópsia Cerebral (Estereotáxica ou Aberta)",
    synonyms: [
      "biopsia cerebral", "biopsia estereotaxica", "biopsia de tumor cerebral",
      "biopsia intracraniana", "stereotaxic biopsy", "biopsia guiada",
      "biopsia lesao cerebral", "diagnostico histologico cerebral"
    ],
    tuss: "30706026",
    tabela_tuss: "22",
    cid_padrao: "D43.2",
    cid_alternativo: ["C71.9", "D33.0"],
    justificativa_base:
      "Paciente com lesão intracraniana de etiologia indeterminada — sem diagnóstico " +
      "histológico definido por exames não-invasivos. Indicada biópsia cerebral " +
      "estereotáxica para obtenção de material para diagnóstico histopatológico " +
      "definitivo e orientação terapêutica.",
    opme_obrigatorio: false,
    regime_internacao: "1",
    carater_atendimento: "1",
    opme_template: []
  },

  "craniectomia_descompressiva": {
    label: "Craniectomia Descompressiva",
    synonyms: [
      "craniectomia descompressiva", "hipertensao intracraniana cirurgia",
      "pic refrataria cirurgia", "hematoma epidural craniotomia",
      "hematoma subdural drenagem", "traumatismo craniano cirurgia",
      "hematoma extradural", "sdh agudo cirurgia"
    ],
    tuss: "30706034",
    tabela_tuss: "22",
    cid_padrao: "S06.5",
    cid_alternativo: ["S06.4", "I62.0", "G93.6"],
    justificativa_base:
      "Paciente com hipertensão intracraniana refratária ao tratamento clínico " +
      "máximo — ou hematoma intracraniano com efeito de massa — com risco iminente " +
      "de herniação cerebral e morte. Indicada craniectomia descompressiva de " +
      "urgência para redução da pressão intracraniana.",
    opme_obrigatorio: false,
    regime_internacao: "2",
    carater_atendimento: "3",
    opme_template: []
  },

  "tratamento_aneurisma_clipagem": {
    label: "Tratamento Cirúrgico de Aneurisma — Clipagem",
    synonyms: [
      "aneurisma cerebral clipagem", "clipagem aneurisma", "clipagem de aneurisma",
      "aneurisma intracraniano clipagem", "clipagem microcirurgica aneurisma",
      "clipagem arterial cerebral", "aneurisma cerebral cirurgia aberta"
    ],
    tuss: "30706042",
    tabela_tuss: "22",
    cid_padrao: "I67.1",
    cid_alternativo: ["I60.0", "I60.9"],
    justificativa_base:
      "Paciente com aneurisma intracraniano — incidental, sintomático ou roto " +
      "(HSA Fisher {nivel}) — com indicação de tratamento cirúrgico por clipagem " +
      "microcirúrgica, dado morfologia e localização favoráveis e disponibilidade " +
      "de expertise técnica local.",
    opme_obrigatorio: true,
    regime_internacao: "2",
    carater_atendimento: "2",
    opme_template: [
      {
        item: "Clip Aneurismático Permanente Titanium",
        codigo_material: "20706100010",
        referencia: "CLIP-ANEURYSM-STD",
        qtd_base: 2,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "10150470555",
        fabricante: "Aesculap / Codman Brasil",
        unidade: "UN",
        justificativa: "Clip aneurismático permanente para oclusão definitiva do colo do aneurisma. Quantidade mínima de 2 clips prevê necessidade de clip auxiliar ou de reposicionamento intraoperatório."
      }
    ]
  },

  "tratamento_aneurisma_endovascular": {
    label: "Embolização Endovascular de Aneurisma",
    synonyms: [
      "embolizacao aneurisma", "coil aneurisma", "tratamento endovascular aneurisma",
      "aneurisma embolizacao", "neuroradiologia intervencionista aneurisma",
      "pipeline diversion aneurisma", "stent assistido coil"
    ],
    tuss: "30912015",
    tabela_tuss: "22",
    cid_padrao: "I67.1",
    cid_alternativo: ["I60.0", "I60.9"],
    justificativa_base:
      "Paciente com aneurisma intracraniano indicado para tratamento endovascular " +
      "por morfologia e localização favoráveis (razão domo/colo adequada, localização " +
      "profunda ou alto risco cirúrgico). Embolização com microcoils de platina " +
      "para oclusão progressiva.",
    opme_obrigatorio: true,
    regime_internacao: "2",
    carater_atendimento: "2",
    opme_template: [
      {
        item: "Microcoil de Platina (pacote 3 unidades)",
        codigo_material: "20912100010",
        referencia: "COIL-PT-3D",
        qtd_base: 3,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "10150470666",
        fabricante: "Stryker Neurovascular / MicroVention",
        unidade: "UN",
        justificativa: "Microcoils de platina para embolização progressiva do saco aneurismático. Quantidade mínima de 3 coils para aneurisma de pequeno-médio volume — quantidade definitiva ajustada intraoperatoriamente por progressão do preenchimento."
      },
      {
        item: "Microcateter Neurovascular",
        codigo_material: "20912100020",
        referencia: "MICROCATH-NEURO",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "10150470667",
        fabricante: "Stryker / Medtronic",
        unidade: "UN",
        justificativa: "Microcateter para acesso superseletivo ao saco aneurismático durante embolização endovascular."
      }
    ]
  },

  "laminectomia_lombar": {
    label: "Laminectomia / Descompressão Lombar",
    synonyms: [
      "laminectomia", "descompressao lombar", "estenose lombar cirurgia",
      "laminectomia lombar", "estenose do canal lombar", "estenose vertebral",
      "descompressao cirurgica canal medular", "claudicacao neurogena cirurgia"
    ],
    tuss: "30715121",
    tabela_tuss: "22",
    cid_padrao: "M48.0",
    cid_alternativo: ["M48.02", "G83.2"],
    justificativa_base:
      "Paciente com estenose do canal medular lombar sintomática em {nivel} — " +
      "claudicação neurogênica, dor irradiada bilateral e limitação funcional — " +
      "refratária ao tratamento conservador por mais de 6 semanas. " +
      "Indicada descompressão cirúrgica por laminectomia.",
    opme_obrigatorio: false,
    regime_internacao: "2",
    carater_atendimento: "1",
    opme_template: []
  },

  "rizotomia_percutanea": {
    label: "Rizotomia Percutânea do Trigêmeo",
    synonyms: [
      "rizotomia", "neuralgia trigeminal cirurgia", "rizotomia percutanea",
      "neuralgia do trigemio cirurgia", "termocoagulacao percutanea",
      "ganglio de gasser", "forame oval percutaneo"
    ],
    tuss: "30712022",
    tabela_tuss: "22",
    cid_padrao: "G50.0",
    cid_alternativo: ["G50.9"],
    justificativa_base:
      "Paciente com neuralgia do trigêmeo clássica — dor paroxística tipo choque em " +
      "território trigeminal — refratária a carbamazepina em dose máxima tolerada " +
      "e/ou com efeitos colaterais inaceitáveis. Indicada rizotomia percutânea " +
      "por termocoagulação do gânglio de Gasser.",
    opme_obrigatorio: false,
    regime_internacao: "1",
    carater_atendimento: "1",
    opme_template: []
  },

  "implante_eletrodo_medular": {
    label: "Implante de Neuroestimulador Medular",
    synonyms: [
      "estimulador medular", "neuroestimulacao medular", "implante eletrodo medular",
      "neuromodulacao medular", "spinal cord stimulation", "scs implante",
      "dor neuropatica implantar estimulador", "neuroestimulador coluna"
    ],
    tuss: "30717011",
    tabela_tuss: "22",
    cid_padrao: "M96.1",
    cid_alternativo: ["G89.2", "G89.3"],
    justificativa_base:
      "Paciente com dor neuropática crônica — síndrome de dor pós-laminectomia ou " +
      "dor regional complexa — refratária a múltiplos tratamentos farmacológicos " +
      "e intervencionistas. Avaliação psicológica favorável. Indicado implante " +
      "de neuroestimulador medular após teste de rastreamento positivo.",
    opme_obrigatorio: true,
    regime_internacao: "2",
    carater_atendimento: "1",
    opme_template: [
      {
        item: "Eletrodo Epidural Percutâneo",
        codigo_material: "20717100010",
        referencia: "ELEC-EPI-8CH",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "10332340222",
        fabricante: "Medtronic / Abbott Neuromodulation",
        unidade: "UN",
        justificativa: "Eletrodo de neuroestimulação epidural com 8 contatos para cobertura bilateral do campo doloroso. Posicionamento guiado por fluoroscopia e teste intraoperatório."
      },
      {
        item: "Gerador de Pulso Implantável Recarregável",
        codigo_material: "20717100020",
        referencia: "IPG-RECHARG-STD",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "10332340223",
        fabricante: "Medtronic / Abbott Neuromodulation",
        unidade: "UN",
        justificativa: "Gerador de pulso implantável com bateria recarregável por indução. Longevidade > 10 anos. Programação externa via telemetria para ajuste de parâmetros de estimulação."
      },
      {
        item: "Extensão / Cabo de Conexão",
        codigo_material: "20717100030",
        referencia: "EXT-CABLE-60CM",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "10332340224",
        fabricante: "Medtronic / Abbott Neuromodulation",
        unidade: "UN",
        justificativa: "Cabo de extensão para conexão entre eletrodo epidural e gerador de pulso subcutâneo. Comprimento adequado para roteamento abdominal."
      }
    ]
  },

  "vertebroplastia": {
    label: "Vertebroplastia / Cifoplastia",
    synonyms: [
      "vertebroplastia", "cifoplastia", "cimentacao vertebral",
      "fratura vertebral osteoporotica cirurgia", "cimento vertebral",
      "balloon kyphoplasty", "pme vertebral"
    ],
    tuss: "30715083",
    tabela_tuss: "22",
    cid_padrao: "M80.0",
    cid_alternativo: ["M80.1", "M48.5", "S22.0"],
    justificativa_base:
      "Paciente com fratura vertebral por compressão em {nivel} — osteoporótica ou " +
      "por fragilidade — com dor mecânica intensa e limitação funcional, refratária " +
      "ao tratamento clínico por mais de 4 semanas. Indicada vertebroplastia/cifoplastia " +
      "percutânea para estabilização e alívio da dor.",
    opme_obrigatorio: true,
    regime_internacao: "1",
    carater_atendimento: "1",
    opme_template: [
      {
        item: "Cimento Ósseo Acrílico (PMMA) Kit",
        codigo_material: "20715100010",
        referencia: "PMMA-VERTEBRO-KIT",
        qtd_base: 1,
        por_nivel: true,
        nivel_mode: "disco",
        anvisa: "10332340333",
        fabricante: "Stryker / DePuy Synthes Brasil",
        unidade: "KIT",
        justificativa: "Cimento ósseo PMMA para injeção intracorporal transpedicular. Estabiliza microfraturas e restaura resistência mecânica do corpo vertebral acometido."
      }
    ]
  },

  "artrodese_cervical": {
    label: "Artrodese Cervical (ACDF / Posterior)",
    synonyms: [
      "artrodese cervical", "fusao cervical", "acdf", "anterior cervical discectomy fusion",
      "fixacao cervical", "instabilidade cervical cirurgia", "hernia cervical artrodese",
      "mielopatia cervical cirurgia", "placa cervical anterior"
    ],
    tuss: "30714010",
    tabela_tuss: "22",
    cid_padrao: "M50.1",
    cid_alternativo: ["M50.0", "M47.2"],
    justificativa_base:
      "Paciente com hernia discal cervical / espondilomielopatia em {nivel} — " +
      "com radiculopatia e/ou mielopatia progressiva documentada — refratária ao " +
      "tratamento conservador. Indicada artrodese cervical anterior com cage e " +
      "placa de fixação para descompressão e estabilização.",
    opme_obrigatorio: true,
    regime_internacao: "2",
    carater_atendimento: "1",
    opme_template: [
      {
        item: "Cage Cervical Intersomático PEEK",
        codigo_material: "20714200010",
        referencia: "CAGE-CERV-PEEK",
        qtd_base: 1,
        por_nivel: true,
        nivel_mode: "disco",
        anvisa: "80072700040",
        fabricante: "Alphatec / Globus Medical",
        unidade: "UN",
        justificativa: "Espaçador intersomático cervical PEEK para discectomia e fusão anterior em {nivel}. Restaura altura do disco e descomprime raízes e/ou medula."
      },
      {
        item: "Placa Cervical Anterior + Parafusos",
        codigo_material: "20714200020",
        referencia: "CERV-PLATE-KIT",
        qtd_base: 1,
        por_nivel: false,
        nivel_mode: "fixo",
        anvisa: "80072700041",
        fabricante: "DePuy Synthes / Stryker Brasil",
        unidade: "KIT",
        justificativa: "Placa anterior de titânio para fixação e estabilização da coluna cervical após artrodese. Parafusos travas autobloqueantes inclusos."
      }
    ]
  }

}; // END NEURO_PROCEDURE_LIBRARY


// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZADOR
// Padrão: lowercase + remove acentos + colapsa espaços
// TODA busca de sinônimo usa normalize() antes de comparar.
// ─────────────────────────────────────────────────────────────────────────────
function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


// ─────────────────────────────────────────────────────────────────────────────
// EXTRATOR DE NÍVEL ANATÔMICO
// Detecta: L4-L5, C4-C5, T10-T11, L4-S1, L5, C5, etc.
// ─────────────────────────────────────────────────────────────────────────────
function extractNivel(normText) {
  // Range: L4-L5, C3-C4, L4-S1, T10-T12
  const rangePattern = /\b([lct]\s*\d{1,2})\s*[-–]\s*([lcts]\s*\d{1,2})\b/gi;
  const rangeMatch = normText.match(rangePattern);
  if (rangeMatch) {
    return rangeMatch[0].toUpperCase().replace(/\s+/g, '').replace('–', '-');
  }
  // Single level: L4, C5, T11
  const singlePattern = /\b([lct])(\d{1,2})\b/gi;
  const singleMatch = normText.match(singlePattern);
  if (singleMatch) {
    return singleMatch[0].toUpperCase();
  }
  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// EXTRATOR DE LATERALIDADE
// ─────────────────────────────────────────────────────────────────────────────
function extractLateralidade(normText) {
  if (/\b(bilateral|ambos|bilater)\b/.test(normText)) return 'bilateral';
  if (/\b(esquerdo|esquerda|esq|left)\b/.test(normText)) return 'esquerdo';
  if (/\b(direito|direita|dir|right)\b/.test(normText)) return 'direito';
  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// CONTADOR DE NÍVEIS DISCAIS
// L4-L5 → 1 disco | L3-L5 → 2 discos | L4-S1 → 2 discos
// ─────────────────────────────────────────────────────────────────────────────
function countDiscLevels(nivel) {
  if (!nivel) return 1;
  const m = nivel.match(/([LCTS])(\d+)-([LCTS])(\d+)/i);
  if (!m) return 1;
  const startLetter = m[1].toUpperCase();
  const startNum    = parseInt(m[2]);
  const endLetter   = m[3].toUpperCase();
  const endNum      = parseInt(m[4]);
  // S1 = "6" for counting purposes
  const effectiveEnd = (endLetter === 'S') ? 6 : endNum;
  return Math.max(1, effectiveEnd - startNum);
}

// Vértebras instrumentadas = níveis discais + 1
function countVertebrae(nivel) {
  return countDiscLevels(nivel) + 1;
}

// Formata nível para exibição
function formatNivel(nivel) {
  if (!nivel) return 'nível não especificado';
  return nivel.toUpperCase().replace('--', '-');
}


// ─────────────────────────────────────────────────────────────────────────────
// parseProcedimento
// Input: texto livre do usuário
// Output: { procKey, nivel, lateralidade, techKeywords, rawInput, confidence }
// ─────────────────────────────────────────────────────────────────────────────
function parseProcedimento(input) {
  const normInput = normalize(input);

  let matchedKey   = null;
  let matchScore   = 0;
  let matchedSyn   = null;

  for (const [key, proc] of Object.entries(NEURO_PROCEDURE_LIBRARY)) {
    for (const syn of proc.synonyms) {
      const normSyn = normalize(syn);
      let score = 0;

      // Correspondência exata
      if (normInput === normSyn) {
        score = normSyn.length * 3;
      }
      // Input contém o sinônimo completo
      else if (normInput.includes(normSyn)) {
        score = normSyn.length * 2;
      }
      // Sinônimo contém o input completo
      else if (normSyn.includes(normInput)) {
        score = normInput.length;
      }
      // Todas as palavras do sinônimo presentes no input (ordem qualquer)
      else {
        const synWords = normSyn.split(' ').filter(w => w.length > 3);
        const matchedWords = synWords.filter(w => normInput.includes(w));
        if (synWords.length > 0 && matchedWords.length === synWords.length) {
          score = synWords.length * 5;
        } else if (matchedWords.length >= 2) {
          score = matchedWords.length * 2;
        }
      }

      if (score > matchScore) {
        matchScore   = score;
        matchedKey   = key;
        matchedSyn   = syn;
      }
    }
  }

  const nivel       = extractNivel(normInput);
  const lateralidade = extractLateralidade(normInput);
  const confidence  = matchScore > 0 ? Math.min(100, matchScore * 5) : 0;

  // Técnica extra detectada
  const techKeywords = [];
  if (/neuronaveg/.test(normInput)) techKeywords.push('neuronavegacao');
  if (/fluorescenc|5-ala|gliolan/.test(normInput)) techKeywords.push('fluorescencia');
  if (/endoscop/.test(normInput)) techKeywords.push('endoscopia');
  if (/video|laparoscop/.test(normInput)) techKeywords.push('videoassistido');
  if (/minimamente\s+invasiv|mini-?aberta|mis\b/.test(normInput)) techKeywords.push('minimamente_invasivo');

  return {
    procKey: matchedKey,
    nivel,
    lateralidade,
    techKeywords,
    rawInput: input,
    matchedSynonym: matchedSyn,
    confidence
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// generateJustificativa
// Substitui {nivel} e {lateralidade} no template base.
// ─────────────────────────────────────────────────────────────────────────────
function generateJustificativa(template, context) {
  const { nivel, lateralidade } = context;
  let text = template || '';
  text = text.replace(/\{nivel\}/g, nivel ? formatNivel(nivel) : 'nível a determinar');
  text = text.replace(/\{lateralidade\}/g, lateralidade || 'a determinar');
  return text;
}


// ─────────────────────────────────────────────────────────────────────────────
// buildOPME
// Calcula quantidades de OPME conforme contexto (nível, modo de cálculo).
// Retorna array no formato tiss_6x pronto para renderEngine.
// ─────────────────────────────────────────────────────────────────────────────
function buildOPME(procedimento, contexto) {
  const { nivel, lateralidade } = contexto;
  const template = procedimento.opme_template || [];
  if (template.length === 0) return [];

  const discLevels  = countDiscLevels(nivel);
  const vertebrae   = countVertebrae(nivel);

  return template.map((item, idx) => {
    let qtd = item.qtd_base;

    if (item.por_nivel) {
      switch (item.nivel_mode) {
        case 'vertebra':
          // Ex: parafuso pedicular → 2 por vértebra × n vértebras
          qtd = item.qtd_base * vertebrae;
          break;
        case 'disco':
          // Ex: cage → 1 por disco × n discos
          qtd = item.qtd_base * discLevels;
          break;
        default:
          qtd = item.qtd_base;
      }
    }

    // Ajuste crosslink: 2 se > 2 discos
    if (item.item.toLowerCase().includes('crosslink') && discLevels > 2) {
      qtd = 2;
    }

    const justificativaItem = generateJustificativa(item.justificativa, contexto);

    return {
      tiss_62_opme_sequencial:          idx + 1,
      tiss_63_opme_codigo_material:      item.codigo_material  || '',
      tiss_64_opme_referencia_fabricante: item.referencia       || '',
      tiss_65_opme_descricao_item:        item.item,
      tiss_66_opme_qtd_solicitada:        qtd,
      tiss_67_opme_qtd_autorizada:        null,
      tiss_68_opme_unidade_medida:        item.unidade          || 'UN',
      tiss_69_opme_numero_anvisa:         item.anvisa           || '',
      tiss_70_opme_nome_fabricante:       item.fabricante       || '',
      tiss_71_opme_justificativa_uso:     justificativaItem
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// inferClinicalData
// Recebe resultado de parseProcedimento e retorna dados clínicos inferidos.
// ─────────────────────────────────────────────────────────────────────────────
function inferClinicalData(parsedInput) {
  const { procKey, nivel, lateralidade, techKeywords, rawInput } = parsedInput;

  // Procedimento não encontrado
  if (!procKey) {
    return {
      success: false,
      error: `Procedimento não reconhecido na biblioteca: "${rawInput}". ` +
             `Disponíveis: ${Object.keys(NEURO_PROCEDURE_LIBRARY).join(', ')}`,
      rawInput
    };
  }

  const proc     = NEURO_PROCEDURE_LIBRARY[procKey];
  const contexto = { nivel, lateralidade, techKeywords };

  const justificativa = generateJustificativa(proc.justificativa_base, contexto);
  const opme_itens    = buildOPME(proc, contexto);

  return {
    success: true,
    procKey,
    label:                  proc.label,
    tuss:                   proc.tuss,
    tabela_tuss:            proc.tabela_tuss || '22',
    cid_principal:          proc.cid_padrao,
    cid_alternativo:        proc.cid_alternativo || [],
    justificativa_clinica:  justificativa,
    opme_itens,
    opme_obrigatorio:       proc.opme_obrigatorio,
    regime_internacao:      proc.regime_internacao,
    carater_atendimento:    proc.carater_atendimento,
    nivel,
    lateralidade,
    techKeywords,
    discLevels:             countDiscLevels(nivel),
    vertebrae:              countVertebrae(nivel),
    confidence:             parsedInput.confidence
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// mapToTISSPayload
// Bridge entre a saída da engine e o formato esperado pelo renderEngine.
// Merge: dados clínicos inferidos + dados do paciente fornecidos pelo usuário.
// NÃO altera renderEngine.js nem a estrutura TISS.
// ─────────────────────────────────────────────────────────────────────────────
function mapToTISSPayload(clinicalData, patientData) {
  if (!clinicalData || !clinicalData.success) return null;

  const p = patientData || {};
  const now = new Date().toISOString().split('T')[0];

  return {
    // ── Meta ──
    _meta: {
      payload_id:       `NEUROAUTH-${Date.now()}`,
      engine_version:   '1.0.0',
      generated_at:     new Date().toISOString(),
      proc_key:         clinicalData.procKey,
      nivel:            clinicalData.nivel || null,
      confidence:       clinicalData.confidence
    },

    // ── Campos TISS: operadora + autorização ──
    tiss_01_registro_ans:               p.registro_ans           || '',
    tiss_02_numero_guia_operadora:      p.numero_guia            || '',
    tiss_03_senha_autorizacao:          p.senha_autorizacao       || '',
    tiss_04_data_autorizacao:           p.data_autorizacao        || null,
    tiss_05_data_validade_senha:        p.data_validade_senha     || null,
    tiss_06_data_validade_atendimento:  p.data_validade_atendimento || null,
    tiss_07_numero_guia_principal:      p.numero_guia_principal   || null,

    // ── Beneficiário ──
    tiss_08_numero_carteira:            p.numero_carteira         || '',
    tiss_09_atendimento_rn:             p.atendimento_rn          || false,
    tiss_10_nome_beneficiario:          p.nome_beneficiario       || '',
    tiss_11_numero_cns:                 p.numero_cns              || '',
    tiss_12_data_nascimento:            p.data_nascimento         || null,
    tiss_13_nome_social:                p.nome_social             || null,
    tiss_14_codigo_plano:               p.codigo_plano            || '',
    tiss_15_nome_plano:                 p.nome_plano              || '',
    tiss_16_validade_carteira:          p.validade_carteira       || null,

    // ── Solicitante ──
    tiss_17_codigo_contratado_sol:      p.codigo_contratado_sol   || '',
    tiss_18_nome_contratado_sol:        p.nome_contratado_sol     || '',
    tiss_19_codigo_cnes_sol:            p.codigo_cnes_sol         || '',
    tiss_20_codigo_operadora_sol:       p.codigo_operadora_sol    || '',
    tiss_21_nome_profissional_sol:      p.nome_medico_sol         || '',
    tiss_22_conselho_profissional_sol:  p.conselho_sol            || 'CRM',
    tiss_23_numero_conselho_sol:        p.numero_crm_sol          || '',
    tiss_24_uf_conselho_sol:            p.uf_crm_sol              || '',
    tiss_25_codigo_cbo_sol:             p.codigo_cbo_sol          || '225125',
    tiss_26_descricao_cbo_sol:          p.descricao_cbo_sol       || 'Médico Neurocirurgião',

    // ── Executante ──
    tiss_27_codigo_contratado_exec:     p.codigo_contratado_exec  || '',
    tiss_28_nome_contratado_exec:       p.nome_hospital           || '',
    tiss_29_codigo_cnes_exec:           p.codigo_cnes_exec        || '',
    tiss_30_codigo_operadora_exec:      p.codigo_operadora_exec   || '',
    tiss_31_nome_profissional_exec:     p.nome_medico_exec        || p.nome_medico_sol || '',
    tiss_32_conselho_profissional_exec: p.conselho_exec           || 'CRM',
    tiss_33_numero_conselho_exec:       p.numero_crm_exec         || p.numero_crm_sol  || '',
    tiss_34_uf_conselho_exec:           p.uf_crm_exec             || p.uf_crm_sol      || '',
    tiss_35_codigo_cbo_exec:            p.codigo_cbo_exec         || '225125',
    tiss_36_descricao_cbo_exec:         p.descricao_cbo_exec      || 'Médico Neurocirurgião',

    // ── Dados do Atendimento ──
    tiss_37_data_solicitacao:           p.data_solicitacao        || now,
    tiss_38_carater_atendimento:        clinicalData.carater_atendimento === '3'
                                          ? 'Urgência/Emergência'
                                          : clinicalData.carater_atendimento === '2'
                                            ? 'Urgência'
                                            : 'Eletivo',
    tiss_39_tipo_consulta:              null,
    tiss_40_indicacao_acidente:         'Não',
    tiss_41_tipo_internacao:            'Cirúrgica',
    tiss_42_indicacao_clinica:          p.indicacao_clinica       || clinicalData.justificativa_clinica,

    // ── Procedimentos ──
    procedimentos: [
      {
        tiss_43_proc_sequencial:        1,
        tiss_44_proc_codigo_tabela:     clinicalData.tabela_tuss,
        tiss_45_proc_codigo:            clinicalData.tuss,
        tiss_46_proc_descricao:         clinicalData.label,
        tiss_47_proc_qtd_solicitada:    1,
        tiss_48_proc_qtd_autorizada:    null,
        tiss_49_proc_via_acesso:        'Única',
        tiss_50_proc_tecnica:           clinicalData.techKeywords.includes('minimamente_invasivo')
                                          ? 'Minimamente Invasivo'
                                          : 'Convencional',
        tiss_51_proc_reducao_acrescimo: 0
      }
    ],

    // ── Diagnóstico ──
    tiss_52_cid_principal:              p.cid_principal           || clinicalData.cid_principal,
    tiss_53_cid_secundario:             p.cid_secundario          || null,
    tiss_54_cid_causas_1:               null,
    tiss_55_cid_causas_2:               null,
    tiss_56_indicacao_acidente_diag:    'Não',
    tiss_57_tipo_consulta_diag:         null,

    // ── Info Complementar ──
    tiss_58_observacao:                 p.observacao              || '',

    // ── Assinaturas ──
    tiss_59_assinatura_medico_sol:      '__ASSINATURA_DIGITAL__',
    tiss_60_data_assinatura_sol:        p.data_solicitacao        || now,
    tiss_61_assinatura_beneficiario:    '__ASSINATURA_BENEFICIARIO__',

    // ── OPME ──
    opme_itens: clinicalData.opme_itens,

    // ── Justificativa Cirúrgica ──
    tiss_72_justificativa_clinica:      p.justificativa_override  || clinicalData.justificativa_clinica,
    tiss_73_hipotese_diagnostica:       p.hipotese_diagnostica    || '',

    // ── Assinaturas Médico Executante ──
    tiss_74_assinatura_medico_exec:     '__ASSINATURA_DIGITAL__',
    tiss_75_data_assinatura_exec:       p.data_solicitacao        || now,
    tiss_76_conselho_carimbo_exec:      `${p.conselho_exec || 'CRM'}-${p.uf_crm_exec || p.uf_crm_sol || ''} ${p.numero_crm_exec || p.numero_crm_sol || ''}`.trim(),
    tiss_77_assinatura_beneficiario_p2: '__ASSINATURA_BENEFICIARIO__'
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// onMagicAutofill — BOOTSTRAP PRINCIPAL
// Recebe input clínico + dados do paciente.
// Executa pipeline completo e devolve payload TISS pronto para renderEngine.
// ─────────────────────────────────────────────────────────────────────────────
async function onMagicAutofill(userInput, patientData) {
  if (!userInput || typeof userInput !== 'string') {
    return { success: false, error: 'Input inválido ou vazio.' };
  }

  // 1. Parse: normalizar + identificar procedimento + contexto
  const parsed = parseProcedimento(userInput);

  // 2. Inferência clínica: justificativa + OPME + CID + TUSS
  const clinical = inferClinicalData(parsed);

  if (!clinical.success) {
    return {
      success: false,
      error: clinical.error,
      suggestions: getSuggestions(userInput)
    };
  }

  // 3. Bridge para TISS: merge com dados do paciente
  const tissPayload = mapToTISSPayload(clinical, patientData || {});

  return {
    success: true,
    parsed,
    clinical,
    tissPayload,
    summary: buildSummary(clinical)
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

/** Sugestões quando procedimento não reconhecido */
function getSuggestions(input) {
  const norm = normalize(input);
  const scored = [];
  for (const [key, proc] of Object.entries(NEURO_PROCEDURE_LIBRARY)) {
    let maxScore = 0;
    for (const syn of proc.synonyms) {
      const normSyn = normalize(syn);
      const words = normSyn.split(' ').filter(w => w.length > 3);
      const matched = words.filter(w => norm.includes(w));
      const score = words.length > 0 ? matched.length / words.length : 0;
      if (score > maxScore) maxScore = score;
    }
    if (maxScore > 0) scored.push({ key, label: proc.label, score: maxScore });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.label);
}

/** Resumo legível do resultado inferido */
function buildSummary(clinical) {
  const lines = [
    `Procedimento: ${clinical.label} (TUSS ${clinical.tuss})`,
    `CID Principal: ${clinical.cid_principal}`,
    `Nível: ${clinical.nivel ? formatNivel(clinical.nivel) : '—'}`,
    `OPME: ${clinical.opme_itens.length} ${clinical.opme_itens.length === 1 ? 'item' : 'itens'}`,
    `Confiança: ${clinical.confidence}%`
  ];
  if (clinical.nivel) {
    lines.push(`Níveis discais: ${clinical.discLevels} | Vértebras: ${clinical.vertebrae}`);
  }
  return lines.join('\n');
}

/** Lista todos os procedimentos disponíveis */
function listProcedimentos() {
  return Object.entries(NEURO_PROCEDURE_LIBRARY).map(([key, proc]) => ({
    key,
    label: proc.label,
    tuss: proc.tuss,
    cid: proc.cid_padrao,
    opme_obrigatorio: proc.opme_obrigatorio,
    synonyms_count: proc.synonyms.length
  }));
}


// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — compatível com CommonJS, AMD e browser global
// ─────────────────────────────────────────────────────────────────────────────
const NEUROAUTH_ENGINE = {
  // Biblioteca
  NEURO_PROCEDURE_LIBRARY,

  // Funções públicas
  normalize,
  parseProcedimento,
  inferClinicalData,
  generateJustificativa,
  buildOPME,
  mapToTISSPayload,
  onMagicAutofill,

  // Utilitários
  extractNivel,
  extractLateralidade,
  countDiscLevels,
  countVertebrae,
  listProcedimentos,
  getSuggestions
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NEUROAUTH_ENGINE;
} else if (typeof define === 'function' && define.amd) {
  define([], function () { return NEUROAUTH_ENGINE; });
} else if (typeof window !== 'undefined') {
  window.NEUROAUTH_ENGINE = NEUROAUTH_ENGINE;
}
