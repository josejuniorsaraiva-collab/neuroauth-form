/**
 * NEUROAUTH ROI Engine v1.0.0
 * Value Closure Loop — ROI Clínico-Financeiro em Malha Fechada
 *
 * Camadas:
 *  1. Time Saving Model (v1)
 *  2. Procedure Value Estimation Model (v1)
 *  3. ROI Event Builder + Audit Snapshot
 *  4. ROI Aggregation (por período, por usuário, global)
 *  5. Doctor ROI Dashboard payload
 *  6. Admin ROI Dashboard payload
 *  7. ROI Perception Engine (mensagens automáticas)
 *  8. Storage Adapters
 *
 * Global UMD: NEUROAUTH_ROI_ENGINE
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NEUROAUTH_ROI_ENGINE = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis :
  typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  var VERSION        = '1.2.0';
  var ROI_ACC_KEY    = 'NEUROAUTH_ROI_ACC_V1';

  /* =========================================================================
   * LOCAL STORAGE ADAPTER (Node-safe, same pattern as Smart Reuse Engine)
   * ========================================================================= */
  var _roiMemFallback = {};
  var RoiStorage = {
    _canUseLS: (function() {
      try {
        if (typeof localStorage === 'undefined') return false;
        var k = '__NR_TEST__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return true;
      } catch(e) { return false; }
    })(),
    getItem:    function(key) {
      if (this._canUseLS) { try { return localStorage.getItem(key); } catch(e) {} }
      return _roiMemFallback[key] !== undefined ? _roiMemFallback[key] : null;
    },
    setItem:    function(key, val) {
      if (this._canUseLS) { try { localStorage.setItem(key, val); return; } catch(e) {} }
      _roiMemFallback[key] = val;
    },
    removeItem: function(key) {
      if (this._canUseLS) { try { localStorage.removeItem(key); return; } catch(e) {} }
      delete _roiMemFallback[key];
    }
  };

  /* =========================================================================
   * CAMADA 8 — INCREMENTAL ACCUMULATOR
   * accumulateFromEvent(event) — atualiza acumulador em tempo real
   * Alimentado por REUSE_SUCCESS e qualquer evento com time_saved_estimate_min
   * Não depende de batch — ROI disponível a qualquer momento
   * ========================================================================= */
  function accumulateFromEvent(event) {
    if (!event) return null;
    var userId = event.user_id || 'global';
    var accKey = ROI_ACC_KEY + ':' + userId;
    var raw    = RoiStorage.getItem(accKey);
    var acc;
    try { acc = raw ? JSON.parse(raw) : {}; } catch(e) { acc = {}; }

    if (!acc.total_minutes_saved) acc.total_minutes_saved = 0;
    if (!acc.reuse_count)         acc.reuse_count         = 0;
    if (!acc.blueprint_count)     acc.blueprint_count     = 0;
    if (!acc.fresh_count)         acc.fresh_count         = 0;
    if (!acc.total_guides)        acc.total_guides        = 0;
    if (!acc.last_updated)        acc.last_updated        = null;

    acc.total_minutes_saved += (event.time_saved_estimate_min || event.time_saved_min || 0);
    acc.total_guides        += 1;
    acc.last_updated         = new Date().toISOString();

    var mode = event.autofill_mode || event.type || 'fresh';
    if (mode === 'blueprint' || mode === 'BLUEPRINT_REUSE') acc.blueprint_count++;
    else if (mode === 'reuse' || mode === 'REUSE_SUCCESS')  acc.reuse_count++;
    else acc.fresh_count++;

    // Derived
    acc.total_hours_saved   = acc.total_minutes_saved / 60;   // raw float
    // reuse_rate_pct só é significativo quando total_guides inclui TODOS os tipos
    // (fresh + reuse + blueprint). Callers devem garantir isso.
    acc.reuse_rate_pct      = acc.total_guides > 0
      ? Math.round(((acc.reuse_count + acc.blueprint_count) / acc.total_guides) * 100)
      : 0;

    try { RoiStorage.setItem(accKey, JSON.stringify(acc)); } catch(e) {}
    return acc;
  }

  function getAccumulated(userId) {
    var accKey = ROI_ACC_KEY + ':' + (userId || 'global');
    var raw    = RoiStorage.getItem(accKey);
    if (!raw) return { total_minutes_saved: 0, total_hours_saved: 0, reuse_count: 0, blueprint_count: 0, fresh_count: 0, total_guides: 0, reuse_rate_pct: 0, last_updated: null };
    try { return JSON.parse(raw); } catch(e) { return null; }
  }

  function clearAccumulated(userId) {
    var accKey = ROI_ACC_KEY + ':' + (userId || 'global');
    RoiStorage.removeItem(accKey);
  }

  /* =========================================================================
   * CAMADA 1 — TIME SAVING MODEL v1
   * Conservador: valores mínimos comprovados em campo
   * ========================================================================= */
  var TIME_MODEL = {
    v:                              '1.0.0',
    fresh_case_min:                 6,    // autofill básico economiza 6 min vs. digitação manual
    reuse_case_min:                 12,   // reutilização economiza 12 min (estrutura + OPME)
    blueprint_case_min:             14,   // blueprint economiza 14 min (protocolo completo)
    high_complexity_bonus_multiplier:   1.5,
    medium_complexity_bonus_multiplier: 1.2,
    low_complexity_bonus_multiplier:    1.0,
    manual_baseline_min:            20    // tempo estimado sem sistema (baseline conservador)
  };

  /* =========================================================================
   * CAMADA 2 — PROCEDURE VALUE ESTIMATION MODEL v1
   * Valores conservadores baseados em média de procedimentos neurológicos
   * IMPORTANTE: estes são valores de produção estimada suportada — NÃO faturamento
   * ========================================================================= */
  var PROCEDURE_VALUE_MODEL = {
    v:               '1.0.0',
    base_neuro:      8000,
    spine_complex:   25000,
    vascular:        30000,
    tumor:           20000,
    hydrocephalus:   12000,
    pain_functional: 10000,
    default:         8000,
    opme_multiplier: 1.2,     // OPME presença eleva complexidade estimada
    confidence:      'conservative'
  };

  /* =========================================================================
   * LOGGER
   * ========================================================================= */
  var Logger = {
    _fmt: function(level, event, ctx) {
      ctx = ctx || {};
      return { ts: new Date().toISOString(), level: level, event: event,
        service: 'neuroauth_roi_engine', version: VERSION,
        user_id: ctx.user_id || null, roi_event_id: ctx.roi_event_id || null };
    },
    info:  function(e,c) { if (typeof console !== 'undefined') console.info('[ROI]',  JSON.stringify(this._fmt('INFO',  e,c))); },
    warn:  function(e,c) { if (typeof console !== 'undefined') console.warn('[ROI]',  JSON.stringify(this._fmt('WARN',  e,c))); },
    error: function(e,c) { if (typeof console !== 'undefined') console.error('[ROI]', JSON.stringify(this._fmt('ERROR', e,c))); }
  };

  /* =========================================================================
   * HELPERS
   * ========================================================================= */
  function _nowIso()  { return new Date().toISOString(); }
  function _genId(p)  { return p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8).toUpperCase(); }

  function _periodKey(isoDate) {
    var d = isoDate ? new Date(isoDate) : new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  }

  function _inPeriod(isoDate, period) {
    if (!period || period === 'all_time') return true;
    if (period === 'current_month')      return _periodKey(isoDate) === _periodKey(null);
    if (period === 'last_30_days') {
      return (Date.now() - new Date(isoDate).getTime()) <= 30*24*3600*1000;
    }
    return _periodKey(isoDate) === period;
  }

  function _fmtBrl(n) {
    return 'R$ ' + Number(n||0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function _fmtMin(m) {
    if (m < 60) return m + ' min';
    var h = Math.floor(m/60), min = m % 60;
    return h + 'h' + (min > 0 ? ' ' + min + 'min' : '');
  }

  /* =========================================================================
   * STORAGE ADAPTERS — ROI EVENTS
   * ========================================================================= */
  function MemoryROIEventStorage() {
    this._events = {};
    this._byUser = {};
    this._all    = [];
  }
  MemoryROIEventStorage.prototype.save = function(e) {
    this._events[e.roi_event_id] = e;
    if (!this._byUser[e.user_id]) this._byUser[e.user_id] = [];
    this._byUser[e.user_id].push(e.roi_event_id);
    this._all.push(e.roi_event_id);
    return Promise.resolve(e);
  };
  MemoryROIEventStorage.prototype.listByUser = function(uid, opts) {
    opts = opts || {};
    var ids   = this._byUser[uid] || [];
    var items = ids.map(function(id) { return this._events[id]; }, this).filter(Boolean);
    items.sort(function(a,b) { return new Date(b.calculated_at) - new Date(a.calculated_at); });
    if (opts.limit) items = items.slice(0, opts.limit);
    return Promise.resolve(items);
  };
  MemoryROIEventStorage.prototype.listAll = function(opts) {
    opts = opts || {};
    var items = this._all.map(function(id) { return this._events[id]; }, this).filter(Boolean);
    items.sort(function(a,b) { return new Date(b.calculated_at) - new Date(a.calculated_at); });
    if (opts.limit) items = items.slice(0, opts.limit);
    return Promise.resolve(items);
  };

  function APIROIEventStorage(cfg)          { var m = new MemoryROIEventStorage(); m._baseUrl = cfg && cfg.baseUrl; return m; }
  function GoogleSheetsROIEventStorage(cfg) { var m = new MemoryROIEventStorage(); m._sheetId = cfg && cfg.sheetId; return m; }

  /* =========================================================================
   * STORAGE ADAPTERS — ROI SNAPSHOTS
   * ========================================================================= */
  function MemoryROISnapshotStorage() {
    this._snaps = {};
  }
  MemoryROISnapshotStorage.prototype.save = function(snap) {
    var key = (snap.user_id || 'global') + '|' + snap.period;
    this._snaps[key] = snap;
    return Promise.resolve(snap);
  };
  MemoryROISnapshotStorage.prototype.get = function(userId, period) {
    var key = (userId || 'global') + '|' + period;
    return Promise.resolve(this._snaps[key] || null);
  };
  MemoryROISnapshotStorage.prototype.listByUser = function(uid) {
    var prefix = (uid || 'global') + '|';
    var snaps = [];
    var self = this;
    Object.keys(this._snaps).forEach(function(k) {
      if (k.indexOf(prefix) === 0) snaps.push(self._snaps[k]);
    });
    snaps.sort(function(a,b) { return b.period > a.period ? 1 : -1; });
    return Promise.resolve(snaps);
  };

  function APIROISnapshotStorage(cfg)          { var m = new MemoryROISnapshotStorage(); m._baseUrl = cfg && cfg.baseUrl; return m; }
  function GoogleSheetsROISnapshotStorage(cfg) { var m = new MemoryROISnapshotStorage(); m._sheetId = cfg && cfg.sheetId; return m; }

  /* =========================================================================
   * STORAGE SINGLETONS
   * ========================================================================= */
  var ROIEventStore = {
    _a: new MemoryROIEventStorage(),
    configure:   function(a) { this._a = a; },
    save:        function(e) { return this._a.save(e); },
    listByUser:  function(uid, o) { return this._a.listByUser(uid, o); },
    listAll:     function(o) { return this._a.listAll(o); }
  };
  var ROISnapStore = {
    _a: new MemoryROISnapshotStorage(),
    configure:   function(a) { this._a = a; },
    save:        function(s) { return this._a.save(s); },
    get:         function(uid, p) { return this._a.get(uid, p); },
    listByUser:  function(uid) { return this._a.listByUser(uid); }
  };

  /* =========================================================================
   * CAMADA 1 — calculateTimeSaved(event)
   * event: { autofill_mode, complexity_level, opme_count }
   * returns minutes saved (integer)
   * ========================================================================= */
  function calculateTimeSaved(event) {
    event = event || {};
    var mode = event.autofill_mode || 'fresh';
    var base;
    if (mode === 'blueprint') base = TIME_MODEL.blueprint_case_min;
    else if (mode === 'reuse') base = TIME_MODEL.reuse_case_min;
    else base = TIME_MODEL.fresh_case_min;

    var complexity = event.complexity_level || 'low';
    var mult;
    if (complexity === 'high')   mult = TIME_MODEL.high_complexity_bonus_multiplier;
    else if (complexity === 'medium') mult = TIME_MODEL.medium_complexity_bonus_multiplier;
    else mult = TIME_MODEL.low_complexity_bonus_multiplier;

    return Math.round(base * mult);
  }

  /* =========================================================================
   * CAMADA 2 — estimateProcedureValue(event)
   * event: { procedure_category, opme_count, tier }
   * returns BRL estimate (conservative)
   * ========================================================================= */
  function estimateProcedureValue(event) {
    event = event || {};
    var cat = event.procedure_category || 'base_neuro';
    var base = PROCEDURE_VALUE_MODEL[cat] || PROCEDURE_VALUE_MODEL.default;
    var opmeCount = event.opme_count || 0;
    if (opmeCount > 0) base = Math.round(base * PROCEDURE_VALUE_MODEL.opme_multiplier);
    // Premium tier slight premium — still conservative
    if (event.tier === 'premium') base = Math.round(base * 1.1);
    return base;
  }

  /* =========================================================================
   * CAMADA 3 — buildROISnapshot(event)
   * Cria e persiste um snapshot auditável de ROI para um evento de guia
   * event: { guia_id, user_id, autofill_mode, complexity_level, opme_count,
   *          procedure_category, operadora, tier, source_billing_id }
   * ========================================================================= */
  function buildROISnapshot(event) {
    event = event || {};
    if (!event.user_id) {
      Logger.warn('roi.snapshot.dropped_no_user_id', { guia_id: event.guia_id || null });
      return Promise.resolve(null);
    }

    var timeSaved = calculateTimeSaved(event);
    var valueEst  = estimateProcedureValue(event);

    var snap = {
      roi_event_id:       _genId('ROI'),
      source_billing_id:  event.source_billing_id || null,
      guia_id:            event.guia_id || null,
      user_id:            event.user_id,
      period:             _periodKey(null),
      time_model_used:    'v' + TIME_MODEL.v,
      value_model_used:   'v' + PROCEDURE_VALUE_MODEL.v,
      autofill_mode:      event.autofill_mode      || 'fresh',
      complexity_level:   event.complexity_level   || 'low',
      procedure_category: event.procedure_category || 'base_neuro',
      opme_count:         event.opme_count         || 0,
      operadora:          event.operadora          || null,
      tier:               event.tier               || 'standard',
      calculated_at:      _nowIso(),
      time_saved_min:     timeSaved,
      estimated_value_brl: valueEst,
      _schema_version:    '1.0.0'
    };

    Logger.info('roi.snapshot.built', { user_id: snap.user_id, roi_event_id: snap.roi_event_id });
    return ROIEventStore.save(snap);
  }

  /* =========================================================================
   * CAMADA 4 — calculateROI({ events, period })
   * Agrega eventos em payload de ROI
   * ========================================================================= */
  function calculateROI(opts) {
    opts = opts || {};
    var events = opts.events || [];
    var period = opts.period || 'all_time';

    var filtered = events.filter(function(e) { return _inPeriod(e.calculated_at, period); });
    var total = filtered.length;
    if (total === 0) {
      return {
        period: period, total_guias: 0, total_time_saved_min: 0, total_time_saved_hours: 0.0,
        total_procedures_supported: 0, estimated_production_brl: 0,
        avg_time_saved_per_case: 0, reuse_rate: 0, blueprint_rate: 0,
        efficiency_gain_pct: 0, roi_confidence: 'conservative',
        fresh_count: 0, reuse_count: 0, blueprint_count: 0,
        calculated_at: _nowIso()
      };
    }

    var totalTimeSaved  = 0;
    var totalValue      = 0;
    var freshCount      = 0;
    var reuseCount      = 0;
    var bpCount         = 0;
    var byOperadora     = {};
    var byCategory      = {};
    var byTier          = {};

    filtered.forEach(function(e) {
      totalTimeSaved += (e.time_saved_min || 0);
      totalValue     += (e.estimated_value_brl || 0);
      var mode = e.autofill_mode || 'fresh';
      if (mode === 'blueprint') bpCount++;
      else if (mode === 'reuse') reuseCount++;
      else freshCount++;

      var op = e.operadora || 'Outros';
      if (!byOperadora[op]) byOperadora[op] = { guias: 0, value: 0, time: 0 };
      byOperadora[op].guias++;
      byOperadora[op].value += (e.estimated_value_brl||0);
      byOperadora[op].time  += (e.time_saved_min||0);

      var cat = e.procedure_category || 'base_neuro';
      if (!byCategory[cat]) byCategory[cat] = { guias: 0, value: 0 };
      byCategory[cat].guias++;
      byCategory[cat].value += (e.estimated_value_brl||0);

      var tier = e.tier || 'standard';
      if (!byTier[tier]) byTier[tier] = 0;
      byTier[tier]++;
    });

    var avgTimeSaved = Math.round(totalTimeSaved / total);
    var reuseRate    = Math.round(((reuseCount + bpCount) / total) * 100);
    var bpRate       = Math.round((bpCount / total) * 100);
    // Efficiency gain: (avg_saved / manual_baseline) * 100
    var efficiencyGain = Math.round((avgTimeSaved / TIME_MODEL.manual_baseline_min) * 100);

    var operadoraRows = Object.keys(byOperadora).map(function(op) {
      return { operadora: op, guias: byOperadora[op].guias,
        estimated_value_brl: byOperadora[op].value, time_saved_min: byOperadora[op].time };
    }).sort(function(a,b) { return b.estimated_value_brl - a.estimated_value_brl; });

    var categoryRows = Object.keys(byCategory).map(function(cat) {
      return { category: cat, guias: byCategory[cat].guias, estimated_value_brl: byCategory[cat].value };
    }).sort(function(a,b) { return b.estimated_value_brl - a.estimated_value_brl; });

    return {
      period:                     period,
      total_guias:                total,
      total_time_saved_min:       totalTimeSaved,
      total_time_saved_hours:     totalTimeSaved / 60,   // raw float — round/format only at display
      total_procedures_supported: total,
      estimated_production_brl:   totalValue,
      avg_time_saved_per_case:    avgTimeSaved,
      reuse_rate:                 reuseRate,
      blueprint_rate:             bpRate,
      efficiency_gain_pct:        efficiencyGain,
      roi_confidence:             'conservative',
      fresh_count:                freshCount,
      reuse_count:                reuseCount,
      blueprint_count:            bpCount,
      by_operadora:               operadoraRows,
      by_category:                categoryRows,
      by_tier:                    byTier,
      calculated_at:              _nowIso()
    };
  }

  /* =========================================================================
   * CAMADA 5 — getDoctorROI(userId, period)
   * Retorna payload completo para dashboard do médico
   * ========================================================================= */
  function getDoctorROI(userId, period) {
    period = period || 'current_month';
    return ROIEventStore.listByUser(userId, { limit: 2000 }).then(function(events) {
      var roi = calculateROI({ events: events, period: period });
      return Object.assign({}, roi, {
        user_id:   userId,
        period:    period,
        fmt: {
          total_time_saved:      _fmtMin(roi.total_time_saved_min),
          time_saved_hours:      (roi.total_time_saved_hours || 0).toFixed(1).replace('.', ',') + ' h',
          estimated_production:  _fmtBrl(roi.estimated_production_brl),
          production_brl:        _fmtBrl(roi.estimated_production_brl),
          avg_time_saved:        _fmtMin(roi.avg_time_saved_per_case),
          reuse_rate:            roi.reuse_rate + '%',
          blueprint_rate:        roi.blueprint_rate + '%',
          efficiency_gain:       roi.efficiency_gain_pct + '%'
        }
      });
    });
  }

  /* =========================================================================
   * CAMADA 6 — getAdminROI(period)
   * Retorna payload completo para dashboard admin
   * ========================================================================= */
  function getAdminROI(period) {
    period = period || 'current_month';
    return ROIEventStore.listAll({ limit: 50000 }).then(function(events) {
      var roi = calculateROI({ events: events, period: period });

      // Agrega por usuário
      var byUser = {};
      events.filter(function(e) { return _inPeriod(e.calculated_at, period); }).forEach(function(e) {
        if (!byUser[e.user_id]) byUser[e.user_id] = { guias: 0, time: 0, value: 0 };
        byUser[e.user_id].guias++;
        byUser[e.user_id].time  += (e.time_saved_min||0);
        byUser[e.user_id].value += (e.estimated_value_brl||0);
      });

      var topUsersByTime = Object.keys(byUser).map(function(uid) {
        return { user_id: uid, guias: byUser[uid].guias,
          time_saved_min: byUser[uid].time, estimated_value_brl: byUser[uid].value };
      }).sort(function(a,b) { return b.time_saved_min - a.time_saved_min; }).slice(0, 10);

      var topUsersByValue = Object.keys(byUser).map(function(uid) {
        return { user_id: uid, guias: byUser[uid].guias,
          time_saved_min: byUser[uid].time, estimated_value_brl: byUser[uid].value };
      }).sort(function(a,b) { return b.estimated_value_brl - a.estimated_value_brl; }).slice(0, 10);

      var totalUsers = Object.keys(byUser).length;
      var reuseUsers = Object.keys(byUser).filter(function(uid) {
        return events.some(function(e) { return e.user_id === uid && (e.autofill_mode === 'reuse' || e.autofill_mode === 'blueprint'); });
      }).length;

      var perUser = Object.keys(byUser).map(function(uid) {
        return { user_id: uid, guias: byUser[uid].guias,
          time_saved_min: byUser[uid].time, estimated_value_brl: byUser[uid].value };
      });

      return Object.assign({}, roi, {
        period:                  period,
        total_active_users:      totalUsers,
        reuse_adoption_rate:     totalUsers > 0 ? Math.round((reuseUsers/totalUsers)*100) : 0,
        blueprint_adoption_rate: roi.blueprint_rate,
        per_user:                perUser,
        top_users_by_time:       topUsersByTime,
        top_users_by_value:      topUsersByValue,
        fmt: {
          total_time_saved:      _fmtMin(roi.total_time_saved_min),
          estimated_production:  _fmtBrl(roi.estimated_production_brl),
          avg_time_per_user:     _fmtMin(totalUsers > 0 ? Math.round(roi.total_time_saved_min/totalUsers) : 0)
        }
      });
    });
  }

  /* =========================================================================
   * CAMADA 7 — buildROIMessages({ roi, period, previousPeriodRoi })
   * Gera mensagens automáticas de percepção de valor
   * ========================================================================= */
  function buildROIMessages(opts) {
    opts = opts || {};
    var roi  = opts.roi  || {};
    var prev = opts.previousPeriodRoi;
    var messages = [];

    // Tempo economizado
    if (roi.total_time_saved_min >= 60) {
      var h = (roi.total_time_saved_hours || 0).toFixed(1).replace('.', ',');
      messages.push({ type: 'time_saved', icon: '⏱', priority: 1,
        text: 'Você economizou <strong>' + h + ' horas</strong> com o NEUROAUTH' +
          (opts.period === 'current_month' ? ' este mês.' : '.') });
    } else if (roi.total_time_saved_min > 0) {
      messages.push({ type: 'time_saved', icon: '⏱', priority: 1,
        text: 'Você economizou <strong>' + roi.total_time_saved_min + ' minutos</strong> com o NEUROAUTH.' });
    }

    // Taxa de reutilização
    if (roi.reuse_rate >= 30) {
      messages.push({ type: 'reuse', icon: '♻', priority: 2,
        text: '<strong>' + roi.reuse_rate + '%</strong> dos seus casos vieram de reutilização inteligente.' });
    }

    // Blueprints
    if (roi.blueprint_count >= 3) {
      messages.push({ type: 'blueprint', icon: '📋', priority: 3,
        text: 'Você usou <strong>' + roi.blueprint_count + ' vezes</strong> seus protocolos salvos.' });
    }

    // Produção suportada
    if (roi.estimated_production_brl >= 10000) {
      messages.push({ type: 'value', icon: '💰', priority: 4,
        text: 'O NEUROAUTH apoiou <strong>' + _fmtBrl(roi.estimated_production_brl) + '</strong> em procedimentos este período.' });
    }

    // Comparação com período anterior
    if (prev && prev.total_guias > 0 && roi.total_guias > 0) {
      var delta = roi.total_guias - prev.total_guias;
      if (delta > 0) {
        messages.push({ type: 'growth', icon: '📈', priority: 5,
          text: 'Você gerou <strong>' + delta + ' guias a mais</strong> do que no período anterior.' });
      }
    }

    // Eficiência
    if (roi.efficiency_gain_pct >= 50) {
      messages.push({ type: 'efficiency', icon: '⚡', priority: 6,
        text: 'Eficiência estimada de <strong>' + roi.efficiency_gain_pct + '%</strong> no preenchimento de guias.' });
    }

    // Fallback — primeiras guias
    if (roi.total_guias > 0 && messages.length === 0) {
      messages.push({ type: 'welcome', icon: '✅', priority: 10,
        text: 'Você gerou <strong>' + roi.total_guias + ' guia' + (roi.total_guias>1?'s':'') + '</strong> com suporte do NEUROAUTH.' });
    }

    messages.sort(function(a,b) { return a.priority - b.priority; });
    return messages;
  }

  /* =========================================================================
   * CONFIGURE
   * ========================================================================= */
  function configure(opts) {
    opts = opts || {};
    if (opts.roiEventStorage)    ROIEventStore.configure(opts.roiEventStorage);
    if (opts.roiSnapshotStorage) ROISnapStore.configure(opts.roiSnapshotStorage);
    Logger.info('roi_engine.configured');
  }

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */
  return {
    VERSION:               VERSION,
    TIME_MODEL:            TIME_MODEL,
    PROCEDURE_VALUE_MODEL: PROCEDURE_VALUE_MODEL,

    configure:             configure,

    // Camada 1 — Time
    calculateTimeSaved:    calculateTimeSaved,

    // Camada 2 — Value
    estimateProcedureValue: estimateProcedureValue,

    // Camada 3 — Snapshot
    buildROISnapshot:      buildROISnapshot,

    // Camada 4 — Aggregation
    calculateROI:          calculateROI,

    // Camada 5 — Doctor dashboard
    getDoctorROI:          getDoctorROI,

    // Camada 6 — Admin dashboard
    getAdminROI:           getAdminROI,

    // Camada 7 — Perception
    buildROIMessages:      buildROIMessages,

    // Camada 8 — Incremental accumulator (real-time, no batch)
    accumulateFromEvent:   accumulateFromEvent,
    getAccumulated:        getAccumulated,
    clearAccumulated:      clearAccumulated,

    // Storage adapters (for configuration)
    MemoryROIEventStorage:          MemoryROIEventStorage,
    APIROIEventStorage:             APIROIEventStorage,
    GoogleSheetsROIEventStorage:    GoogleSheetsROIEventStorage,
    MemoryROISnapshotStorage:       MemoryROISnapshotStorage,
    APIROISnapshotStorage:          APIROISnapshotStorage,
    GoogleSheetsROISnapshotStorage: GoogleSheetsROISnapshotStorage
  };
}));
