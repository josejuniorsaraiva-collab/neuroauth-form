/**
 * NEUROAUTH Case Reuse Engine v1.0.0
 * Smart Reuse Layer — Clinical Blueprints + Safe Replay + Productivity
 *
 * Camadas:
 *  1. Case History Index
 *  2. Clinical Blueprint Builder
 *  3. Smart Case Matcher (scoring)
 *  4. Reuse Template Builder
 *  5. Safe Merge Engine (LGPD)
 *  6. Audit & Metrics
 *
 * Global UMD: NEUROAUTH_CASE_REUSE_ENGINE
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NEUROAUTH_CASE_REUSE_ENGINE = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis :
  typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  var VERSION = '1.2.0';

  /* =========================================================================
   * LGPD — CAMPOS PROIBIDOS (nunca copiar para reutilização)
   * ========================================================================= */
  var FORBIDDEN_FIELDS = [
    'paciente_nome','beneficiario_nome','nome_paciente','nome_beneficiario',
    'tiss_10_nome_beneficiario','tiss_13_nome_social',
    'carteirinha','numero_carteirinha','carteira','tiss_08_numero_carteira',
    'numero_guia','guia_id','tiss_02_numero_guia_operadora','tiss_07_numero_guia_principal',
    'tiss_03_senha_autorizacao','tiss_04_data_autorizacao','tiss_05_data_validade_senha',
    'data_nascimento','nascimento','tiss_12_data_nascimento',
    'cpf','rg','documento','tiss_11_numero_cns',
    'telefone','celular','email',
    'autorizacao','numero_autorizacao',
    'anexos','attachments','tiss_61_assinatura_beneficiario','tiss_77_assinatura_beneficiario_p2',
    'paciente_id','beneficiario_id',
    'tiss_59_assinatura_medico_sol','tiss_74_assinatura_medico_exec'
  ];

  /* =========================================================================
   * CAMPOS REUTILIZÁVEIS (estrutura clínica, sem identidade do paciente)
   * ========================================================================= */
  var REUSABLE_FIELDS = [
    'procedimento_principal','procedimento_nome','procedimento_tuss','procedimento_codigo',
    'cid','cid_principal','tiss_52_cid_principal',
    'opme_itens','procedimentos',
    'justificativa_clinica','tiss_72_justificativa_clinica',
    'operadora','operadora_nome','operadora_codigo',
    'carater_atendimento','tiss_38_carater_atendimento',
    'tipo_guia',
    'tiss_42_indicacao_acidente',
    'tiss_49_proc_via_acesso','tiss_50_proc_tecnica',
    'obs_operacionais','tiss_58_observacao'
  ];

  /* =========================================================================
   * SCORING DE SIMILARIDADE
   * ========================================================================= */
  var SIMILARITY_WEIGHTS = {
    same_tuss:               40,
    same_procedimento_exact: 25,
    same_procedimento_words: 15,
    same_operadora:          10,
    similar_opme:            15,
    same_cid_family:         10,
    similar_justificativa:   10,
    recent_90_days:          10,
    blueprint_reused:        15
  };

  /* =========================================================================
   * LOGGER
   * ========================================================================= */
  var Logger = {
    _fmt: function(level, event, ctx) {
      ctx = ctx || {};
      return {
        ts: new Date().toISOString(), level: level, event: event,
        service: 'neuroauth_case_reuse_engine', version: VERSION,
        user_id: ctx.user_id || null, case_id: ctx.case_id || null,
        blueprint_id: ctx.blueprint_id || null
      };
    },
    info:  function(e, c) { if (typeof console !== 'undefined') console.info('[REUSE]',  JSON.stringify(this._fmt('INFO',  e, c))); },
    warn:  function(e, c) { if (typeof console !== 'undefined') console.warn('[REUSE]',  JSON.stringify(this._fmt('WARN',  e, c))); },
    error: function(e, c) { if (typeof console !== 'undefined') console.error('[REUSE]', JSON.stringify(this._fmt('ERROR', e, c))); }
  };

  /* =========================================================================
   * HELPERS
   * ========================================================================= */
  function _nowIso()  { return new Date().toISOString(); }
  function _genId(p)  { return p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8).toUpperCase(); }

  function _daysSince(isoDate) {
    return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
  }

  function _norm(s) {
    if (!s) return '';
    return String(s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function _patientSafeLabel(payload) {
    var nome = payload.tiss_10_nome_beneficiario || payload.paciente_nome || payload.nome_beneficiario || '';
    var initials = nome.split(' ').filter(Boolean)
      .map(function(w) { return w[0].toUpperCase(); }).join('.') || 'P.';
    var d = new Date();
    return initials + ' / ' + String(d.getMonth()+1).padStart(2,'0') + '-' + d.getFullYear();
  }

  function _extractCategory(payload) {
    var nome = _norm(payload.procedimento_nome || payload.tiss_46_proc_descricao || '');
    if (nome.includes('artrodese') || nome.includes('coluna') || nome.includes('lombar') || nome.includes('cervical') || nome.includes('vertebra')) return 'spine_complex';
    if (nome.includes('tumor') || nome.includes('ressec')) return 'tumor';
    if (nome.includes('hidrocefalia') || nome.includes('derivac')) return 'hydrocephalus';
    if (nome.includes('vascular') || nome.includes('aneurisma') || nome.includes('malformac')) return 'vascular';
    if (nome.includes('dor') || nome.includes('estimulac') || nome.includes('funcional')) return 'pain_functional';
    return 'base_neuro';
  }

  function _guessComplexity(payload) {
    var opme = (payload.opme_itens || []).length;
    if (opme > 5) return 'high';
    if (opme > 2) return 'medium';
    return 'low';
  }

  function _generateTags(payload) {
    var tags = [];
    var nome = _norm(payload.procedimento_nome || payload.tiss_46_proc_descricao || '');
    if (nome.includes('artrodese'))  tags.push('artrodese');
    if (nome.includes('coluna'))     tags.push('coluna');
    if (nome.includes('lombar'))     tags.push('lombar');
    if (nome.includes('cervical'))   tags.push('cervical');
    if (nome.includes('tumor'))      tags.push('tumor');
    if (nome.includes('cranio') || nome.includes('crânio')) tags.push('cranio');
    if ((payload.opme_itens || []).length > 0) tags.push('com-opme');
    if ((payload.opme_itens || []).length > 5) tags.push('alta-complexidade');
    return tags;
  }

  function _normalizedSignature(payload) {
    return [
      _norm(payload.procedimento_tuss || payload.tiss_45_proc_codigo || ''),
      _norm(payload.procedimento_nome || payload.tiss_46_proc_descricao || '').slice(0,20),
      (payload.cid || payload.tiss_52_cid_principal || '').slice(0,3),
      String((payload.opme_itens || []).length)
    ].join('|');
  }

  /* =========================================================================
   * STORAGE ADAPTERS — CASE HISTORY
   * ========================================================================= */
  function MemoryCaseHistoryStorage() {
    this._cases  = {};
    this._byUser = {};
  }
  MemoryCaseHistoryStorage.prototype.save = function(rec) {
    this._cases[rec.case_id] = rec;
    if (!this._byUser[rec.user_id]) this._byUser[rec.user_id] = [];
    if (this._byUser[rec.user_id].indexOf(rec.case_id) === -1)
      this._byUser[rec.user_id].push(rec.case_id);
    return Promise.resolve(rec);
  };
  MemoryCaseHistoryStorage.prototype.getById = function(id) {
    return Promise.resolve(this._cases[id] || null);
  };
  MemoryCaseHistoryStorage.prototype.listByUser = function(uid, opts) {
    opts = opts || {};
    var ids   = this._byUser[uid] || [];
    var items = ids.map(function(id) { return this._cases[id]; }, this).filter(Boolean);
    items.sort(function(a,b) { return new Date(b.generated_at) - new Date(a.generated_at); });
    if (opts.limit) items = items.slice(0, opts.limit);
    return Promise.resolve(items);
  };
  MemoryCaseHistoryStorage.prototype.count = function(uid) {
    return Promise.resolve((this._byUser[uid] || []).length);
  };

  function APICaseHistoryStorage(cfg)          { var m = new MemoryCaseHistoryStorage(); m._baseUrl = cfg && cfg.baseUrl; return m; }
  function GoogleSheetsCaseHistoryStorage(cfg) { var m = new MemoryCaseHistoryStorage(); m._sheetId = cfg && cfg.sheetId; return m; }

  /* =========================================================================
   * STORAGE ADAPTERS — BLUEPRINTS
   * ========================================================================= */
  function MemoryBlueprintStorage() {
    this._bps    = {};
    this._byUser = {};
  }
  MemoryBlueprintStorage.prototype.save = function(bp) {
    this._bps[bp.blueprint_id] = bp;
    if (!this._byUser[bp.user_id]) this._byUser[bp.user_id] = [];
    if (this._byUser[bp.user_id].indexOf(bp.blueprint_id) === -1)
      this._byUser[bp.user_id].push(bp.blueprint_id);
    return Promise.resolve(bp);
  };
  MemoryBlueprintStorage.prototype.getById = function(id) {
    return Promise.resolve(this._bps[id] || null);
  };
  MemoryBlueprintStorage.prototype.listByUser = function(uid, opts) {
    opts = opts || {};
    var ids   = this._byUser[uid] || [];
    var items = ids.map(function(id) { return this._bps[id]; }, this).filter(Boolean);
    items.sort(function(a,b) { return b.usage_count - a.usage_count; });
    if (opts.limit) items = items.slice(0, opts.limit);
    return Promise.resolve(items);
  };
  MemoryBlueprintStorage.prototype.incrementUsage = function(id) {
    var bp = this._bps[id];
    if (bp) { bp.usage_count = (bp.usage_count||0)+1; bp.last_used_at = _nowIso(); }
    return Promise.resolve(bp || null);
  };

  function APIBlueprintStorage(cfg)          { var m = new MemoryBlueprintStorage(); m._baseUrl = cfg && cfg.baseUrl; return m; }
  function GoogleSheetsBlueprintStorage(cfg) { var m = new MemoryBlueprintStorage(); m._sheetId = cfg && cfg.sheetId; return m; }

  /* =========================================================================
   * STORAGE ADAPTERS — REUSE EVENTS
   * ========================================================================= */
  function MemoryReuseEventStorage() {
    this._events = {};
    this._byUser = {};
  }
  MemoryReuseEventStorage.prototype.save = function(evt) {
    this._events[evt.reuse_event_id] = evt;
    if (!this._byUser[evt.user_id]) this._byUser[evt.user_id] = [];
    this._byUser[evt.user_id].push(evt.reuse_event_id);
    return Promise.resolve(evt);
  };
  MemoryReuseEventStorage.prototype.listByUser = function(uid, opts) {
    opts = opts || {};
    var ids   = this._byUser[uid] || [];
    var items = ids.map(function(id) { return this._events[id]; }, this).filter(Boolean);
    items.sort(function(a,b) { return new Date(b.created_at) - new Date(a.created_at); });
    if (opts.limit) items = items.slice(0, opts.limit);
    return Promise.resolve(items);
  };
  MemoryReuseEventStorage.prototype.countByUser = function(uid) {
    return Promise.resolve((this._byUser[uid] || []).length);
  };

  function APIReuseEventStorage(cfg)          { var m = new MemoryReuseEventStorage(); m._baseUrl = cfg && cfg.baseUrl; return m; }
  function GoogleSheetsReuseEventStorage(cfg) { var m = new MemoryReuseEventStorage(); m._sheetId = cfg && cfg.sheetId; return m; }

  /* =========================================================================
   * STORAGE SINGLETONS
   * ========================================================================= */
  var CaseStorage = {
    _a: new MemoryCaseHistoryStorage(),
    configure:   function(a) { this._a = a; },
    save:        function(r) { return this._a.save(r); },
    getById:     function(id) { return this._a.getById(id); },
    listByUser:  function(uid, o) { return this._a.listByUser(uid, o); },
    count:       function(uid) { return this._a.count(uid); }
  };
  var BlueprintStorage = {
    _a: new MemoryBlueprintStorage(),
    configure:       function(a) { this._a = a; },
    save:            function(b) { return this._a.save(b); },
    getById:         function(id) { return this._a.getById(id); },
    listByUser:      function(uid, o) { return this._a.listByUser(uid, o); },
    incrementUsage:  function(id) { return this._a.incrementUsage(id); }
  };
  var ReuseEventStorage = {
    _a: new MemoryReuseEventStorage(),
    configure:   function(a) { this._a = a; },
    save:        function(e) { return this._a.save(e); },
    listByUser:  function(uid, o) { return this._a.listByUser(uid, o); },
    countByUser: function(uid) { return this._a.countByUser(uid); }
  };

  /* =========================================================================
   * CAMADA 1 — CASE HISTORY INDEX
   * indexGeneratedCase(payload, renderResult, opts)
   * ========================================================================= */
  function indexGeneratedCase(payload, renderResult, opts) {
    opts = opts || {};
    if (!payload) return Promise.resolve(null);

    var userId   = payload.user_id || opts.user_id || 'unknown';
    var caseId   = _genId('CASE');
    var guiaId   = (renderResult && renderResult.guia_id) ? renderResult.guia_id : _genId('NG');

    var opmeClean = (payload.opme_itens || payload.tiss_opme || []).map(function(item) {
      return {
        codigo_anvisa: item.tiss_63_opme_codigo_anvisa || item.codigo_anvisa || null,
        descricao:     item.tiss_65_opme_descricao_item || item.descricao || null,
        quantidade:    item.tiss_66_opme_qtd_solicitada || item.quantidade || 1,
        referencia:    item.tiss_64_opme_referencia || item.referencia || null,
        fabricante:    item.fabricante || null
        // price intentionally omitted — may be sensitive
      };
    });

    var rec = {
      case_id:               caseId,
      guia_id:               guiaId,
      generated_at:          _nowIso(),
      user_id:               userId,
      medico_nome:           payload.tiss_21_nome_profissional_sol || null,
      medico_crm:            payload.medico_crm || null,
      operadora:             payload.operadora_nome || payload.tiss_09_codigo_operadora || payload.operadora || null,
      operadora_codigo:      payload.tiss_01_registro_ans || payload.operadora_codigo || null,
      tipo_guia:             payload.tipo_guia || 'SADT',
      procedimento_principal: payload.tiss_46_proc_descricao || payload.tiss_06_descricao_procedimento || payload.procedimento_nome || null,
      procedimento_tuss:     payload.tiss_45_proc_codigo || payload.tiss_05_codigo_procedimento || payload.procedimento_tuss || null,
      cid:                   payload.tiss_52_cid_principal || payload.cid || null,
      opme_count:            opmeClean.length,
      opme_itens:            opmeClean,
      procedimentos:         payload.procedimentos || [],
      justificativa_clinica: payload.tiss_72_justificativa_clinica || payload.justificativa_clinica || null,
      carater_atendimento:   payload.tiss_38_carater_atendimento || null,
      complexity_level:      opts.complexity_level || _guessComplexity(payload),
      procedure_category:    _extractCategory(payload),
      tags:                  _generateTags(payload),
      normalized_signature:  _normalizedSignature(payload),
      patient_safe_label:    _patientSafeLabel(payload),
      autofill_mode:         opts.autofill_mode || 'fresh',
      source_case_id:        opts.source_case_id || null,
      source_blueprint_id:   opts.source_blueprint_id || null,
      total_pages:           (renderResult && renderResult.total_pages) || null,
      _schema_version:       '1.0.0'
    };

    Logger.info('case.indexed', { user_id: userId, case_id: caseId });
    return CaseStorage.save(rec);
  }

  /* =========================================================================
   * CAMADA 2 — CLINICAL BLUEPRINT BUILDER
   * createBlueprintFromCase(caseData, opts)
   * ========================================================================= */
  function createBlueprintFromCase(caseData, opts) {
    opts = opts || {};
    if (!caseData) return Promise.resolve(null);

    var bpId = _genId('BP');
    var name = opts.name || opts.template_name ||
      ('Meu padrão: ' + (caseData.procedimento_principal || 'Procedimento').slice(0,45));

    var bp = {
      blueprint_id:      bpId,
      source_case_id:    caseData.case_id,
      user_id:           caseData.user_id,
      template_name:     name,
      name:              name,
      created_at:        _nowIso(),
      usage_count:       0,
      last_used_at:      null,
      procedure_category: caseData.procedure_category,
      clinical_data: {
        procedimento_tuss:     caseData.procedimento_tuss,
        procedimento_nome:     caseData.procedimento_principal,
        cid:                   caseData.cid,
        justificativa_base:    caseData.justificativa_clinica,
        opme_template:         caseData.opme_itens || [],
        operadora_preferencial: caseData.operadora || null,
        operadora_codigo:      caseData.operadora_codigo || null,
        carater_sugerido:      caseData.carater_atendimento || 'Eletivo',
        tipo_guia:             caseData.tipo_guia || 'SADT',
        configuracoes_tecnicas: {}
      },
      tags:              caseData.tags || [],
      reusable_fields:   REUSABLE_FIELDS.slice(),
      forbidden_fields:  FORBIDDEN_FIELDS.slice(),
      _schema_version:   '1.0.0'
    };

    Logger.info('blueprint.created', { user_id: caseData.user_id, blueprint_id: bpId, case_id: caseData.case_id });
    return BlueprintStorage.save(bp);
  }

  /* =========================================================================
   * CAMADA 3 — SMART CASE MATCHER
   * findSimilarCases(input, opts)
   * ========================================================================= */
  function _scoreSimilarity(input, rec) {
    var score = 0;
    var inputTuss = _norm(input.procedimento_tuss || input.tiss_45_proc_codigo || '');
    var recTuss   = _norm(rec.procedimento_tuss || '');
    if (inputTuss && recTuss && inputTuss === recTuss) score += SIMILARITY_WEIGHTS.same_tuss;

    var inputProc = _norm(input.procedimento_nome || input.tiss_46_proc_descricao || '');
    var recProc   = _norm(rec.procedimento_principal || '');
    if (inputProc && recProc) {
      if (inputProc === recProc) {
        score += SIMILARITY_WEIGHTS.same_procedimento_exact;
      } else {
        var iw = inputProc.split(' ').filter(function(w) { return w.length > 3; });
        var rw = recProc.split(' ').filter(function(w) { return w.length > 3; });
        var shared = iw.filter(function(w) { return rw.indexOf(w) !== -1; }).length;
        if (shared > 0) score += Math.min(shared * 5, SIMILARITY_WEIGHTS.same_procedimento_words);
      }
    }

    var inputOp = _norm(input.operadora || input.operadora_nome || '');
    var recOp   = _norm(rec.operadora || '');
    if (inputOp && recOp && inputOp === recOp) score += SIMILARITY_WEIGHTS.same_operadora;

    var iOpme = (input.opme_itens || []).length;
    var rOpme = rec.opme_count || 0;
    if (iOpme > 0 && rOpme > 0) {
      var ratio = Math.min(iOpme, rOpme) / Math.max(iOpme, rOpme);
      score += Math.round(ratio * SIMILARITY_WEIGHTS.similar_opme);
    }

    var iCid = (input.cid || input.tiss_52_cid_principal || '').slice(0,3).toUpperCase();
    var rCid = (rec.cid || '').slice(0,3).toUpperCase();
    if (iCid && rCid && iCid === rCid) score += SIMILARITY_WEIGHTS.same_cid_family;

    var iJust = _norm(input.justificativa_clinica || input.tiss_72_justificativa_clinica || '').slice(0,120);
    var rJust = _norm(rec.justificativa_clinica || '').slice(0,120);
    if (iJust && rJust) {
      var jw = iJust.split(' ').filter(function(w) { return w.length > 4; });
      var rjw = rJust.split(' ').filter(function(w) { return w.length > 4; });
      var jshared = jw.filter(function(w) { return rjw.indexOf(w) !== -1; }).length;
      if (jshared >= 3) score += SIMILARITY_WEIGHTS.similar_justificativa;
    }

    if (_daysSince(rec.generated_at) <= 90) score += SIMILARITY_WEIGHTS.recent_90_days;
    if (rec.autofill_mode === 'reuse' || rec.autofill_mode === 'blueprint') score += SIMILARITY_WEIGHTS.blueprint_reused;

    return score;
  }

  function findSimilarCases(input, opts) {
    opts = opts || {};
    var uid = input.user_id || opts.user_id;
    if (!uid) return Promise.resolve([]);
    var minScore = opts.min_score !== undefined ? opts.min_score : 10;
    var limit    = opts.limit || 5;

    return CaseStorage.listByUser(uid, { limit: 200 }).then(function(cases) {
      var scored = cases.map(function(c) {
        return { score: _scoreSimilarity(input, c), caseRecord: c };
      });
      scored.sort(function(a,b) { return b.score - a.score; });
      return scored
        .filter(function(s) { return s.score >= minScore; })
        .slice(0, limit)
        .map(function(s) { return Object.assign({}, s.caseRecord, { similarity_score: s.score }); });
    });
  }

  /* =========================================================================
   * CAMADA 4 — REUSE TEMPLATE BUILDER
   * buildReusableTemplate(caseRecord)
   * ========================================================================= */
  function buildReusableTemplate(caseRecord) {
    if (!caseRecord) return null;
    return {
      template_id:    _genId('TPL'),
      source_case_id: caseRecord.case_id,
      created_at:     _nowIso(),
      reusable_fields: {
        procedimento_principal: caseRecord.procedimento_principal,
        procedimento_tuss:      caseRecord.procedimento_tuss,
        cid:                    caseRecord.cid,
        opme_itens:             caseRecord.opme_itens || [],
        procedimentos:          caseRecord.procedimentos || [],
        justificativa_clinica:  caseRecord.justificativa_clinica,
        operadora:              caseRecord.operadora,
        operadora_codigo:       caseRecord.operadora_codigo,
        carater_atendimento:    caseRecord.carater_atendimento,
        tipo_guia:              caseRecord.tipo_guia,
        tags:                   caseRecord.tags || []
      },
      metadata: {
        procedure_category: caseRecord.procedure_category,
        complexity_level:   caseRecord.complexity_level,
        opme_count:         caseRecord.opme_count,
        original_date:      caseRecord.generated_at,
        patient_safe_label: caseRecord.patient_safe_label
      }
    };
  }

  /* =========================================================================
   * CAMADA 5 — SAFE MERGE ENGINE (LGPD)
   * sanitizeTemplateForNewPatient(template)
   * mergeTemplateWithNewPatient(template, patientData)
   * ========================================================================= */
  /**
   * _safeClone(obj)
   * Cópia segura de objetos de template. Estratégia em duas camadas:
   *
   *   1. Fast path: JSON.parse(JSON.stringify(obj)) — rápido, preserva estrutura.
   *      Falha em objetos com referências circulares ou BigInt.
   *
   *   2. Fallback recursivo com rastreamento WeakSet:
   *      Percorre propriedades enumeráveis recursivamente, parando em ciclos
   *      detectados via WeakSet (substituídos por null). Garante que objetos
   *      aninhados em cadeias circulares indiretas (a→b→a) sejam clonados
   *      sem perder os campos clínicos que contêm (opme_itens, etc.).
   *
   * BUG C2-1 — JSON.parse/stringify lançava TypeError em objetos circulares.
   * BUG C3-1 — Fallback anterior usava JSON.parse nos sub-objetos, que também
   *            falhava em cadeias indiretas, omitindo silenciosamente campos como
   *            opme_itens. Corrigido com recursão + WeakSet em _safeCloneNode.
   */
  function _safeCloneNode(val, visited) {
    if (val === null || val === undefined) return val;
    if (typeof val !== 'object') return val; // primitivos: cópia direta
    // Ciclo detectado — substituir por null para não perder a chave pai
    if (visited && visited.has(val)) return null;
    if (visited) visited.add(val);

    if (Array.isArray(val)) {
      return val.map(function(item) { return _safeCloneNode(item, visited); });
    }
    var copy = {};
    var keys = Object.keys(val);
    for (var ki = 0; ki < keys.length; ki++) {
      var k = keys[ki];
      var child = val[k];
      if (child !== null && typeof child === 'object') {
        // Tenta fast path por sub-objeto; se falhar, recursão com visited
        try {
          copy[k] = JSON.parse(JSON.stringify(child));
        } catch (_) {
          copy[k] = _safeCloneNode(child, visited);
        }
      } else {
        copy[k] = child;
      }
    }
    return copy;
  }

  function _safeClone(obj) {
    if (obj === null || obj === undefined) return obj;
    // Fast path: sem circular → retorna imediatamente
    try { return JSON.parse(JSON.stringify(obj)); } catch (_) {}
    // Fallback com rastreamento de ciclo via WeakSet
    var visited = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
    return _safeCloneNode(obj, visited);
  }

  function sanitizeTemplateForNewPatient(template) {
    if (!template) return null;
    var s = _safeClone(template);
    var stripped = [];
    FORBIDDEN_FIELDS.forEach(function(f) {
      if (s[f] !== undefined)                        { delete s[f]; stripped.push(f); }
      if (s.reusable_fields && s.reusable_fields[f] !== undefined) { delete s.reusable_fields[f]; }
      if (s.clinical_data   && s.clinical_data[f] !== undefined)   { delete s.clinical_data[f]; }
    });
    delete s.guia_id; delete s.numero_guia;
    s._sanitized       = true;
    s._sanitized_at    = _nowIso();
    s._stripped_fields = stripped;
    return s;
  }

  function mergeTemplateWithNewPatient(template, patientData) {
    if (!template) return patientData || {};
    patientData = patientData || {};
    var s = sanitizeTemplateForNewPatient(template);
    var fields = s.reusable_fields || s.clinical_data || {};
    var merged = Object.assign({}, fields, patientData);
    FORBIDDEN_FIELDS.forEach(function(f) {
      if (patientData[f] !== undefined) merged[f] = patientData[f];
      else delete merged[f];
    });
    merged._reuse_source      = template.source_case_id || null;
    merged._reuse_applied_at  = _nowIso();
    return merged;
  }

  /* =========================================================================
   * CAMADA 6 — WORKFLOW INITIATORS
   * startReuseFlow(caseId, userId)
   * startBlueprintFlow(blueprintId, userId)
   * ========================================================================= */
  function startReuseFlow(caseId, userId) {
    return CaseStorage.getById(caseId).then(function(rec) {
      if (!rec) return { success: false, error: 'case_not_found', case_id: caseId };
      var template  = buildReusableTemplate(rec);
      var sanitized = sanitizeTemplateForNewPatient(template);
      Logger.info('reuse.flow.started', { user_id: userId, case_id: caseId });
      return { success: true, flow: 'reuse', case_id: caseId, template: sanitized, autofill_mode: 'reuse', source_case_id: caseId, reusable_fields: REUSABLE_FIELDS.slice() };
    });
  }

  function startBlueprintFlow(blueprintId, userId) {
    return BlueprintStorage.getById(blueprintId).then(function(bp) {
      if (!bp) return { success: false, error: 'blueprint_not_found', blueprint_id: blueprintId };
      return BlueprintStorage.incrementUsage(blueprintId).then(function() {
        var template = {
          template_id:         _genId('TPL'),
          source_blueprint_id: blueprintId,
          source_case_id:      bp.source_case_id,
          reusable_fields:     bp.clinical_data,
          metadata:            { procedure_category: bp.procedure_category },
          _sanitized:          true
        };
        Logger.info('blueprint.flow.started', { user_id: userId, blueprint_id: blueprintId });
        return { success: true, flow: 'blueprint', blueprint_id: blueprintId, template: template,
          autofill_mode: 'blueprint', source_blueprint_id: blueprintId, source_case_id: bp.source_case_id };
      });
    });
  }

  /* =========================================================================
   * AUDIT — LOG REUSE EVENT
   * ========================================================================= */
  function logReuseEvent(opts) {
    opts = opts || {};
    var evt = {
      reuse_event_id:          _genId('REUSE'),
      source_case_id:          opts.source_case_id      || null,
      source_blueprint_id:     opts.source_blueprint_id || null,
      new_case_id:             opts.new_case_id          || null,
      user_id:                 opts.user_id              || 'unknown',
      autofill_mode:           opts.autofill_mode        || 'reuse',
      reused_fields:           REUSABLE_FIELDS.slice(),
      stripped_fields:         FORBIDDEN_FIELDS.slice(),
      time_saved_estimate_min: opts.time_saved_estimate_min || 12,
      created_at:              _nowIso(),
      _schema_version:         '1.0.0'
    };
    Logger.info('reuse.event.logged', { user_id: evt.user_id, case_id: evt.source_case_id });
    return ReuseEventStorage.save(evt);
  }

  /* =========================================================================
   * METRICS
   * getReuseMetrics(userId, opts) — async
   * ========================================================================= */
  function getReuseMetrics(userId, opts) {
    opts = opts || {};
    return Promise.all([
      ReuseEventStorage.listByUser(userId, { limit: 2000 }),
      CaseStorage.listByUser(userId, { limit: 2000 }),
      BlueprintStorage.listByUser(userId, { limit: 200 })
    ]).then(function(results) {
      var events  = results[0];
      var cases   = results[1];
      var bps     = results[2];
      var total   = cases.length;
      var reuseC  = events.filter(function(e) { return e.autofill_mode === 'reuse'; }).length;
      var bpC     = events.filter(function(e) { return e.autofill_mode === 'blueprint'; }).length;
      var timeSvd = events.reduce(function(s,e) { return s + (e.time_saved_estimate_min||0); }, 0);
      return {
        user_id:              userId,
        total_cases_indexed:  total,
        total_cases:          total,
        total_reuse_events:   events.length,
        reuse_count:          reuseC,
        blueprint_count:      bpC,
        total_blueprints:     bps.length,
        reuse_rate:           total > 0 ? Math.round((reuseC / total) * 100) : 0,
        blueprint_rate:       total > 0 ? Math.round((bpC / total) * 100) : 0,
        total_time_saved_min: timeSvd,
        top_blueprints:       bps.slice(0, 5),
        recent_cases:         cases.slice(0, 10),
        calculated_at:        _nowIso()
      };
    });
  }

  /* =========================================================================
   * NORMALIZE (public helper)
   * ========================================================================= */
  function normalizeCaseForReuse(caseData) {
    if (!caseData) return null;
    var n = Object.assign({}, caseData);
    FORBIDDEN_FIELDS.forEach(function(f) { delete n[f]; });
    return n;
  }

  /* =========================================================================
   * CONFIGURE
   * ========================================================================= */
  function configure(opts) {
    opts = opts || {};
    if (opts.caseStorage)      CaseStorage.configure(opts.caseStorage);
    if (opts.blueprintStorage) BlueprintStorage.configure(opts.blueprintStorage);
    if (opts.reuseStorage)     ReuseEventStorage.configure(opts.reuseStorage);
    Logger.info('case_reuse_engine.configured');
  }

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */
  return {
    VERSION:            VERSION,
    FORBIDDEN_FIELDS:   FORBIDDEN_FIELDS,
    REUSABLE_FIELDS:    REUSABLE_FIELDS,
    SIMILARITY_WEIGHTS: SIMILARITY_WEIGHTS,

    configure:          configure,

    // Camada 1 — Indexing
    indexGeneratedCase:            indexGeneratedCase,

    // Camada 2 — Blueprints
    createBlueprintFromCase:       createBlueprintFromCase,

    // Camada 3 — Matching
    findSimilarCases:              findSimilarCases,

    // Camada 4 — Template
    buildReusableTemplate:         buildReusableTemplate,

    // Camada 5 — Safe merge (LGPD)
    normalizeCaseForReuse:         normalizeCaseForReuse,
    sanitizeTemplateForNewPatient: sanitizeTemplateForNewPatient,
    mergeTemplateWithNewPatient:   mergeTemplateWithNewPatient,

    // Camada 6 — Workflows
    startReuseFlow:     startReuseFlow,
    startBlueprintFlow: startBlueprintFlow,

    // Audit
    logReuseEvent:      logReuseEvent,

    // History & blueprint queries
    getCaseHistory:      function(uid, o) { return CaseStorage.listByUser(uid, o); },
    getCase:             function(id)     { return CaseStorage.getById(id); },
    getBlueprintLibrary: function(uid, o) { return BlueprintStorage.listByUser(uid, o); },
    listBlueprints:      function(uid, o) { return BlueprintStorage.listByUser(uid, o); },
    getBlueprint:        function(id)     { return BlueprintStorage.getById(id); },
    getReuseEvents:      function(uid, o) { return ReuseEventStorage.listByUser(uid, o); },

    // Metrics
    getReuseMetrics:    getReuseMetrics,

    // Storage adapters (for configuration)
    MemoryCaseHistoryStorage:       MemoryCaseHistoryStorage,
    APICaseHistoryStorage:          APICaseHistoryStorage,
    GoogleSheetsCaseHistoryStorage: GoogleSheetsCaseHistoryStorage,
    MemoryBlueprintStorage:         MemoryBlueprintStorage,
    APIBlueprintStorage:            APIBlueprintStorage,
    GoogleSheetsBlueprintStorage:   GoogleSheetsBlueprintStorage,
    MemoryReuseEventStorage:        MemoryReuseEventStorage,
    APIReuseEventStorage:           APIReuseEventStorage,
    GoogleSheetsReuseEventStorage:  GoogleSheetsReuseEventStorage
  };
}));
