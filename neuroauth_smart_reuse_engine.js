/**
 * NEUROAUTH Smart Reuse Engine v1.0.0
 * Memória Operacional + Grafo de Conhecimento Clínico
 *
 * Camadas:
 *  1. Blueprint Cache  — localStorage (offline-first, zero latência)
 *  2. Signature Graph  — TUSS + Operadora + OPME fingerprint
 *  3. Weighted Scorer  — recência × uso × similaridade
 *  4. Safe Injector    — popula DOM sem dados do paciente (LGPD)
 *  5. Billing Bridge   — emite REUSE_SUCCESS ao billing client
 *  6. Audit Log        — rastreia reutilizações por blueprint_id
 *
 * Global UMD: NEUROAUTH_SMART_REUSE_ENGINE
 * Compatível com Node.js (sem localStorage) para testes.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NEUROAUTH_SMART_REUSE_ENGINE = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis :
  typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  var VERSION    = '1.2.0';
  var CACHE_KEY  = 'NEUROAUTH_BLUEPRINT_CACHE_V1';
  var GRAPH_KEY  = 'NEUROAUTH_BP_GRAPH_V1';
  var MAX_BLUEPRINTS = 50;
  var TOP_K          = 3;

  /* =========================================================================
   * LGPD — Campos absolutamente proibidos (nunca armazenar / nunca injetar)
   * ========================================================================= */
  var FORBIDDEN_FIELDS = [
    'paciente_nome','beneficiario_nome','nome_beneficiario','tiss_10_nome_beneficiario',
    'tiss_13_nome_social',
    'carteirinha','numero_carteirinha','tiss_08_numero_carteira',
    'numero_guia','guia_id','tiss_02_numero_guia_operadora',
    'data_nascimento','nascimento','tiss_12_data_nascimento',
    'cpf','rg','documento','tiss_11_numero_cns',
    'tiss_cpf_beneficiario','tiss_rg_beneficiario',
    'endereco','logradouro','cep','cidade','estado',
    'telefone','email','contato',
    'responsavel_legal','tiss_14_nome_responsavel_legal'
  ];

  /* =========================================================================
   * LOGGER
   * ========================================================================= */
  var Logger = {
    _fmt: function(level, event, ctx) {
      ctx = ctx || {};
      return { ts: new Date().toISOString(), level: level, event: event,
        service: 'neuroauth_smart_reuse_engine', version: VERSION,
        user_id: ctx.user_id || null, blueprint_id: ctx.blueprint_id || null };
    },
    info:  function(e,c) { if (typeof console !== 'undefined') console.info( '[SMART_REUSE]', JSON.stringify(this._fmt('INFO',  e, c))); },
    warn:  function(e,c) { if (typeof console !== 'undefined') console.warn( '[SMART_REUSE]', JSON.stringify(this._fmt('WARN',  e, c))); },
    error: function(e,c) { if (typeof console !== 'undefined') console.error('[SMART_REUSE]', JSON.stringify(this._fmt('ERROR', e, c))); }
  };

  /* =========================================================================
   * STORAGE ADAPTER — localStorage com fallback memory (Node.js safe)
   * ========================================================================= */
  var _memoryFallback = {};

  var Storage = {
    _canUseLS: (function() {
      try {
        if (typeof localStorage === 'undefined') return false;
        var k = '__NEUROAUTH_TEST__';
        localStorage.setItem(k, '1');
        localStorage.removeItem(k);
        return true;
      } catch(e) { return false; }
    })(),

    getItem: function(key) {
      if (this._canUseLS) {
        try { return localStorage.getItem(key); } catch(e) {}
      }
      return _memoryFallback[key] !== undefined ? _memoryFallback[key] : null;
    },

    setItem: function(key, val) {
      if (this._canUseLS) {
        try { localStorage.setItem(key, val); return; } catch(e) {}
      }
      _memoryFallback[key] = val;
    },

    removeItem: function(key) {
      if (this._canUseLS) {
        try { localStorage.removeItem(key); return; } catch(e) {}
      }
      delete _memoryFallback[key];
    }
  };

  /* =========================================================================
   * STATE
   * ========================================================================= */
  var _blueprints            = [];
  var _lastSync              = null;
  var _auditLog              = [];
  var _cfg                   = {};
  var _lastAppliedBlueprintId = null;  // for graph edge tracking

  /* =========================================================================
   * HELPERS
   * ========================================================================= */
  function _nowMs()  { return Date.now(); }
  function _nowIso() { return new Date().toISOString(); }
  function _norm(s)  { return (s || '').toString().trim().toLowerCase(); }
  function _genId(prefix) {
    return (prefix || 'ID') + '-' + _nowMs() + '-' +
      Math.random().toString(36).slice(2,8).toUpperCase();
  }

  /** Strip forbidden patient fields from any object (deep, immutable) */
  function _sanitize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var s = JSON.parse(JSON.stringify(obj));
    FORBIDDEN_FIELDS.forEach(function(f) { delete s[f]; });
    return s;
  }

  /* =========================================================================
   * CAMADA 1 — BLUEPRINT CACHE (localStorage / memory)
   * init() — carrega do storage em zero latência
   * ========================================================================= */
  function init() {
    try {
      var raw = Storage.getItem(CACHE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        _blueprints = Array.isArray(parsed.blueprints) ? parsed.blueprints : [];
        _lastSync   = parsed.lastSync || null;
      }
    } catch(e) {
      Logger.warn('init.cache_load_failed', {});
    }
    Logger.info('smart_reuse_engine.initialized', {});
    return { loaded: _blueprints.length, lastSync: _lastSync };
  }

  function _persist() {
    try {
      // Compaction — keep cache "hot": most recently used, cap at MAX_BLUEPRINTS
      _blueprints = _blueprints
        .sort(function(a, b) { return b.last_used_at - a.last_used_at; })
        .slice(0, MAX_BLUEPRINTS);
      Storage.setItem(CACHE_KEY, JSON.stringify({
        blueprints: _blueprints,
        lastSync: _nowMs()
      }));
    } catch(e) {
      Logger.warn('persist.failed', {});
    }
  }

  /* =========================================================================
   * CAMADA 2 — SIGNATURE GRAPH NODE KEY
   * Fingerprint determinístico: TUSS + Operadora + OPME codes
   * ========================================================================= */
  function _buildSignature(event) {
    var tuss     = _norm(event.tuss || event.tiss_45_proc_codigo || event.tiss_05_codigo_procedimento || event.procedimento_tuss || '');
    var operadora= _norm(event.operadora || event.tiss_09_codigo_operadora || '');
    var opmeKeys = (event.opme_items || event.opme_itens || event.tiss_opme || [])
      .map(function(o) { return _norm(o.codigo || o.codigo_anvisa || o.tiss_63_opme_codigo_anvisa || ''); })
      .filter(function(c) { return c.length > 0; })  // ignora itens sem código
      .sort()
      .join('-');
    var sig = [tuss, operadora, opmeKeys].join('|');
    // Rejeitar assinaturas vazias — '||' colidiria entre procedimentos sem TUSS/operadora/OPME
    // (ex: guias de consulta básica merging incorretamente com cirurgias)
    if (sig === '||' || (!tuss && !operadora && !opmeKeys)) return null;
    return sig;
  }

  /* =========================================================================
   * CAMADA 2b — BUILD BLUEPRINT FROM BILLING EVENT
   * buildBlueprintFromBillingEvent(event) → blueprint object (LGPD safe)
   * ========================================================================= */
  function buildBlueprintFromBillingEvent(event) {
    if (!event) return null;

    var guiaId = event.guia_id || event.tiss_02_numero_guia_operadora || _genId('GNG');
    var sig    = _buildSignature(event);

    // Strip all forbidden patient fields from every sub-object
    var opmeRaw = event.opme_items || event.opme_itens || event.tiss_opme || [];
    var opmeClean = opmeRaw.map(function(o) {
      return _sanitize({
        codigo:    o.codigo || o.codigo_anvisa || o.tiss_63_opme_codigo_anvisa || null,
        descricao: o.descricao || o.tiss_65_opme_descricao_item || null,
        quantidade:o.quantidade || o.tiss_66_opme_qtd_solicitada || 1
      });
    });

    return {
      blueprint_id:   _genId('SBP'),
      parent_guia_id: guiaId,
      created_at:     _nowMs(),
      last_used_at:   _nowMs(),
      usage_count:    1,
      signature:      sig,
      clinical_data:  _sanitize({
        procedimento_codigo: event.procedimento_codigo || event.tiss_05_codigo_procedimento || null,
        procedimento_nome:   event.procedimento_nome   || event.tiss_06_descricao_procedimento || null,
        tuss:                event.tuss || event.tiss_45_proc_codigo || event.tiss_05_codigo_procedimento || null,
        cid:                 event.cid || event.tiss_52_cid_principal || null,
        justificativa_base:  event.justificativa || event.tiss_72_justificativa_clinica || null,
        opme_template:       opmeClean,
        operadora:           event.operadora || event.tiss_09_codigo_operadora || null
      }),
      autofill_mode:  event.autofill_mode || 'fresh',
      _schema_version: '1.0.0'
    };
  }

  /* =========================================================================
   * CAMADA 1b — INDEX FROM BILLING EVENT
   * indexFromBillingEvent(event) — add/update blueprint in cache
   * ========================================================================= */
  function indexFromBillingEvent(event) {
    if (!event) return null;

    var blueprint = buildBlueprintFromBillingEvent(event);
    if (!blueprint) return null;
    // Rejeitar blueprints com assinatura nula — evento sem dados clínicos suficientes
    // para identificar o procedimento de forma única (evita colisão de '||')
    if (!blueprint.signature) {
      Logger.warn('blueprint.rejected_empty_signature', {});
      return null;
    }

    var existing = null;
    for (var i = 0; i < _blueprints.length; i++) {
      if (_blueprints[i].signature === blueprint.signature) {
        existing = _blueprints[i];
        break;
      }
    }

    if (existing) {
      existing.usage_count  += 1;
      existing.last_used_at  = _nowMs();
      Logger.info('blueprint.merged', { blueprint_id: existing.blueprint_id });
    } else {
      _blueprints.unshift(blueprint);
      // NÃO fazer pop aqui — _persist() faz sort por last_used_at + slice(MAX)
      // Um pop prematuro removeria o último por ordem de inserção, não o menos usado
      Logger.info('blueprint.indexed', { blueprint_id: blueprint.blueprint_id });
    }

    _persist();
    return existing || blueprint;
  }

  /* =========================================================================
   * CAMADA 3 — WEIGHTED SCORER
   * getTopBlueprints(input, opts) → top-K blueprints scored
   * Score = 0.6 × similarity + 0.3 × usage_log + 0.1 × recency_bonus
   * ========================================================================= */
  function _recencyBonus(lastUsedMs) {
    var age = _nowMs() - (lastUsedMs || 0);
    if (age < 7  * 24 * 60 * 60 * 1000) return 1.0;   // < 7 days
    if (age < 30 * 24 * 60 * 60 * 1000) return 0.8;   // < 30 days
    if (age < 90 * 24 * 60 * 60 * 1000) return 0.5;   // < 90 days
    return 0.2;
  }

  function _similarityScore(bp, input) {
    if (!input) return 0;
    var score = 0;

    // TUSS exact match — strongest clinical signal (0.5)
    var bpTuss = _norm(bp.clinical_data.tuss || '');
    var inTuss = _norm(input.tuss || input.procedimento_tuss || input.tiss_05_codigo_procedimento || '');
    if (bpTuss && inTuss && bpTuss === inTuss) score += 0.5;

    // Operadora (0.2)
    var bpOp = _norm(bp.clinical_data.operadora || '');
    var inOp = _norm(input.operadora || input.tiss_09_codigo_operadora || '');
    if (bpOp && inOp && bpOp === inOp) score += 0.2;

    // OPME Jaccard similarity (0.3) — reconhece padrão cirúrgico real
    var opmeA = (bp.clinical_data.opme_template || [])
      .map(function(o) { return _norm(o.codigo || ''); })
      .filter(function(c) { return c.length > 0; });
    var opmeB = (input.opme_items || input.opme_itens || input.tiss_opme || [])
      .map(function(o) { return _norm(o.codigo || o.codigo_anvisa || o.tiss_63_opme_codigo_anvisa || ''); })
      .filter(function(c) { return c.length > 0; });

    if (opmeA.length > 0 || opmeB.length > 0) {
      var intersection = opmeA.filter(function(x) { return opmeB.indexOf(x) !== -1; }).length;
      var unionSize = opmeA.length + opmeB.length - intersection;
      if (unionSize > 0) score += (intersection / unionSize) * 0.3;
    }

    return Math.min(score, 1.0);
  }

  function getTopBlueprints(input, opts) {
    input = input || {};
    opts  = opts  || {};
    var k       = opts.k || TOP_K;
    var minScore= opts.min_score !== undefined ? opts.min_score : 0.05;

    var scored = _blueprints.map(function(bp) {
      var sim     = _similarityScore(bp, input);
      var usage   = Math.log(bp.usage_count + 1) / Math.log(MAX_BLUEPRINTS + 1);
      var recency = _recencyBonus(bp.last_used_at);
      var score   = sim * 0.6 + usage * 0.3 + recency * 0.1;
      return Object.assign({}, bp, { _score: parseFloat(score.toFixed(4)) });
    });

    scored.sort(function(a, b) { return b._score - a._score; });
    return scored.filter(function(s) { return s._score >= minScore; }).slice(0, k);
  }

  /* =========================================================================
   * CAMADA 4 — SAFE INJECTOR
   * applyBlueprint(blueprint, opts)
   *   opts.autofillEngine — objeto com método inject(payload) (opcional)
   *   opts.formFieldMap   — mapa campo→seletor DOM (opcional)
   *   opts.userId         — para audit
   * ========================================================================= */

  /** Map blueprint.clinical_data keys to DOM input selectors used in copiloto */
  var DEFAULT_FIELD_MAP = {
    procedimento_nome:   '#f-clinical-input',
    tuss:                '#f-tuss',
    cid:                 '#f-cid',
    justificativa_base:  '#f-justificativa',
    operadora:           '#f-operadora'
  };

  function applyBlueprint(blueprint, opts) {
    if (!blueprint || !blueprint.clinical_data) return { success: false, error: 'blueprint_null' };
    opts = opts || {};

    var data    = _sanitize(blueprint.clinical_data);
    var fieldMap= opts.formFieldMap || DEFAULT_FIELD_MAP;

    // Approach A: delegate to autofill engine inject() if provided
    if (opts.autofillEngine && typeof opts.autofillEngine.inject === 'function') {
      opts.autofillEngine.inject({
        procedimento_codigo: data.procedimento_codigo,
        procedimento_nome:   data.procedimento_nome,
        tuss:                data.tuss,
        cid:                 data.cid,
        justificativa:       data.justificativa_base,
        opme_items:          data.opme_template,
        operadora:           data.operadora
      });
    } else {
      // Approach B: direct DOM fill (browser-only, graceful in Node)
      _domFill(fieldMap, data);
    }

    // Highlight patient-identity fields that still need manual fill
    _highlightPatientFields();

    // Billing event
    _emitReuseEvent(blueprint, opts.userId);

    // Graph edge: track sequential blueprint usage
    if (_lastAppliedBlueprintId && _lastAppliedBlueprintId !== blueprint.blueprint_id) {
      _linkUsage(_lastAppliedBlueprintId, blueprint.blueprint_id);
    }
    _lastAppliedBlueprintId = blueprint.blueprint_id;

    // Audit
    _auditLog.push({
      ts:           _nowIso(),
      action:       'blueprint.applied',
      blueprint_id: blueprint.blueprint_id,
      user_id:      opts.userId || null,
      score:        blueprint._score || null
    });

    Logger.info('blueprint.applied', { blueprint_id: blueprint.blueprint_id, user_id: opts.userId || null });
    return { success: true, blueprint_id: blueprint.blueprint_id, fields_filled: Object.keys(fieldMap) };
  }

  function _domFill(fieldMap, data) {
    if (typeof document === 'undefined') return;
    var keyMap = {
      procedimento_nome:  data.procedimento_nome,
      tuss:               data.tuss,
      cid:                data.cid,
      justificativa_base: data.justificativa_base,
      operadora:          data.operadora
    };
    Object.keys(fieldMap).forEach(function(field) {
      var selector = fieldMap[field];
      var value    = keyMap[field];
      if (!selector || value === null || value === undefined) return;
      try {
        var el = document.querySelector(selector);
        if (el) {
          el.value = value;
          // Trigger change event for reactive frameworks
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch(e) { /* DOM not available */ }
    });
  }

  function _highlightPatientFields() {
    if (typeof document === 'undefined') return;
    try {
      var fields = document.querySelectorAll('[data-patient-field]');
      fields.forEach(function(el) { el.classList.add('highlight-required'); });
      // Auto-clear after 4s — highlight guides without polluting the UI permanently
      setTimeout(function() {
        fields.forEach(function(el) { el.classList.remove('highlight-required'); });
      }, 4000);
    } catch(e) {}
  }

  /* =========================================================================
   * CAMADA 5 — BILLING BRIDGE
   * Emite REUSE_SUCCESS para NEUROAUTH_BILLING_BRIDGE_CLIENT
   * ========================================================================= */
  function _emitReuseEvent(blueprint, userId) {
    var client = (typeof NEUROAUTH_BILLING_BRIDGE_CLIENT !== 'undefined')
      ? NEUROAUTH_BILLING_BRIDGE_CLIENT
      : ((typeof window !== 'undefined' && window.NEUROAUTH_BILLING_BRIDGE_CLIENT)
          ? window.NEUROAUTH_BILLING_BRIDGE_CLIENT
          : null);

    if (!client) return;

    // autofill_mode = 'blueprint' porque applyBlueprint() aplica um protocolo salvo,
    // não uma reutilização de caso ad-hoc. Valor de tempo reflete blueprint_case_min do TIME_MODEL.
    var payload = {
      type:                 'REUSE_SUCCESS',
      source_blueprint_id:  blueprint.blueprint_id,
      parent_guia_id:       blueprint.parent_guia_id,
      autofill_mode:        'blueprint',
      time_saved_estimate_min: 14,
      user_id:              userId || null,
      ts:                   _nowIso()
    };

    if (typeof client.trackEvent === 'function') {
      try { client.trackEvent(payload); } catch(e) {}
    } else if (typeof client.logBillingEvent === 'function') {
      try { client.logBillingEvent(payload); } catch(e) {}
    }

    // Feed ROI incremental accumulator (fire-and-forget)
    var roiEngine = (typeof NEUROAUTH_ROI_ENGINE !== 'undefined')
      ? NEUROAUTH_ROI_ENGINE
      : (typeof window !== 'undefined' ? window.NEUROAUTH_ROI_ENGINE : null);
    if (roiEngine && typeof roiEngine.accumulateFromEvent === 'function') {
      try { roiEngine.accumulateFromEvent(payload); } catch(e) {}
    }
  }

  /* =========================================================================
   * CAMADA 3b — RENDER HELPER
   * renderBlueprintSuggestions(list, containerId, onClickFn)
   * ========================================================================= */
  function renderBlueprintSuggestions(list, containerId, onClickFn) {
    if (typeof document === 'undefined') return;
    var container = document.getElementById(containerId || 'blueprint-suggestions');
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    // Build HTML with data-index only — no JSON/function in attributes (XSS-safe)
    container.innerHTML = list.map(function(bp, idx) {
      var nome  = (bp.clinical_data.procedimento_nome || '—').slice(0, 40);
      var op    = bp.clinical_data.operadora || '—';
      var usos  = bp.usage_count || 1;
      var score = bp._score !== undefined ? (bp._score * 100).toFixed(0) : '—';
      return (
        '<div class="sre-bp-card" data-index="' + idx + '" role="button" tabindex="0">' +
          '<div class="sre-bp-title">\u267b ' + _escHtml(nome) + '</div>' +
          '<div class="sre-bp-meta">' + _escHtml(op) + ' \u00b7 ' + usos + ' uso' + (usos !== 1 ? 's' : '') +
            ' \u00b7 match ' + score + '%</div>' +
        '</div>'
      );
    }).join('');

    // Attach event listeners — no inline handlers, no JSON injection
    container.querySelectorAll('.sre-bp-card').forEach(function(el) {
      var idx = parseInt(el.getAttribute('data-index'), 10);
      function _activate() {
        var bp = list[idx];
        if (!bp) return;
        if (typeof onClickFn === 'function') {
          onClickFn(bp);
        } else {
          applyBlueprint(bp, {});
        }
      }
      el.addEventListener('click', _activate);
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _activate(); }
      });
    });
  }

  /** Called by onclick in rendered cards — kept on the public object for DOM access */
  var _lastTopK = [];
  function _onCardClick(idx) {
    var bp = _lastTopK[idx];
    if (!bp) return;
    applyBlueprint(bp, {});
  }

  function _escHtml(s) {
    return (s || '').toString()
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  /* =========================================================================
   * CAMADA 6 — USAGE GRAPH (edge tracking)
   * _linkUsage(fromId, toId) — registra transição entre blueprints
   * Abre caminho para: sequência cirúrgica, previsão de próximo passo,
   * sugestão automática multi-etapas
   * ========================================================================= */
  function _linkUsage(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    try {
      var raw = Storage.getItem(GRAPH_KEY);
      var graph;
      try { graph = raw ? JSON.parse(raw) : {}; } catch(e) { graph = {}; }
      if (!graph[fromId]) graph[fromId] = {};
      graph[fromId][toId] = (graph[fromId][toId] || 0) + 1;
      Storage.setItem(GRAPH_KEY, JSON.stringify(graph));
    } catch(e) { /* graph write never throws */ }
  }

  function getGraph() {
    try {
      var raw = Storage.getItem(GRAPH_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch(e) { return {}; }
  }

  function getNextSuggestions(blueprintId) {
    var graph = getGraph();
    var edges = graph[blueprintId];
    if (!edges) return [];
    return Object.keys(edges)
      .map(function(toId) { return { blueprint_id: toId, weight: edges[toId] }; })
      .sort(function(a, b) { return b.weight - a.weight; });
  }

  /* =========================================================================
   * CONFIGURE
   * ========================================================================= */
  function configure(opts) {
    opts = opts || {};
    if (opts.max_blueprints) MAX_BLUEPRINTS = opts.max_blueprints;
    if (opts.top_k)          TOP_K          = opts.top_k;
    if (opts.cache_key)      CACHE_KEY      = opts.cache_key;
    Logger.info('smart_reuse_engine.configured', {});
  }

  /* =========================================================================
   * METRICS
   * ========================================================================= */
  function getMetrics() {
    return {
      total_blueprints:   _blueprints.length,
      total_audit_events: _auditLog.length,
      reuse_applications: _auditLog.filter(function(e){ return e.action === 'blueprint.applied'; }).length,
      most_used: _blueprints.slice().sort(function(a,b){ return b.usage_count - a.usage_count; }).slice(0, 3),
      last_sync:   _lastSync,
      storage_type: Storage._canUseLS ? 'localStorage' : 'memory'
    };
  }

  function clearCache() {
    _blueprints              = [];
    _auditLog                = [];
    _lastSync                = null;
    _lastAppliedBlueprintId  = null;   // evita aresta fantasma no grafo após clear
    Storage.removeItem(CACHE_KEY);
    Logger.info('cache.cleared', {});
  }

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */
  return {
    VERSION: VERSION,
    FORBIDDEN_FIELDS: FORBIDDEN_FIELDS,

    // Core lifecycle
    configure:      configure,
    init:           init,
    clearCache:     clearCache,

    // Indexing
    indexFromBillingEvent:          indexFromBillingEvent,
    buildBlueprintFromBillingEvent: buildBlueprintFromBillingEvent,

    // Scoring
    getTopBlueprints: function(input, opts) {
      var top = getTopBlueprints(input, opts);
      _lastTopK = top;   // store for card onclick
      return top;
    },

    // Application (LGPD safe)
    applyBlueprint: applyBlueprint,

    // Render helper
    renderBlueprintSuggestions: renderBlueprintSuggestions,

    // DOM card click bridge (accessed by inline onclick)
    _onCardClick: _onCardClick,

    // Metrics & audit
    getMetrics:   getMetrics,
    getAuditLog:  function() { return _auditLog.slice(); },

    // Camada 6 — Usage graph
    getGraph:           getGraph,
    getNextSuggestions: getNextSuggestions
  };
}));
