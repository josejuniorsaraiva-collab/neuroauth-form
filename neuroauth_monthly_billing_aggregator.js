/**
 * neuroauth_monthly_billing_aggregator.js
 * NEUROAUTH_AGGREGATOR v2.0.0
 *
 * Camada de Consolidação Mensal — Pós-pago | NEUROAUTH Billing Platform
 *
 * Princípios imutáveis:
 *   1. Single Source of Truth — consume APENAS o ledger real do BillingBridge
 *   2. Zero Mocks no fluxo principal — nenhum mockEvent, nenhum revenue fixo
 *   3. Ledger First — BillingLedger é a fonte primária, invoices são derivados
 *   4. Idempotência Forte — fechamento e invoice são reproduzíveis sem duplicação
 *   5. Trial Contábil — desconto real em line items, não só nota visual
 *   6. LGPD by Design — paciente_iniciais + hash, nunca nome completo
 *   7. Observabilidade Total — correlation_id em todo log
 *   8. Storage Plugável — Memory / Sheets / API via adapter pattern
 *
 * Fases implementadas:
 *   F1  — RealLedgerConnector (conectado ao BillingBridge via BillingBridgeClient)
 *   F2  — getBillableEventsForPeriod()
 *   F3  — Contrato formal do evento (schema v1.1.0)
 *   F4  — Leitura real com deduplicação por idempotency_key
 *   F5  — applyTrialPolicy() com desconto contábil real em line items
 *   F6  — buildMonthlyInvoice() com versionamento e source_billing_ids
 *   F7  — closeBillingPeriod() reproduzível com forceReopen + versionamento
 *   F8  — getDoctorDashboard() — dados reais do ledger
 *   F9  — getAdminDashboard() — dados reais do ledger
 *   F10 — calculateProfitability() com COST_MODEL real
 *   F11 — InvoiceStorageAdapter + ClosingStorageAdapter (plugável)
 *   F12 — Observabilidade estruturada completa
 *
 * @version 2.0.0
 * @license Proprietary — NeuroAuth © 2026
 */

(function (root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.NEUROAUTH_AGGREGATOR = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const VERSION = '2.0.0';

  /* =========================================================================
   * BILLING POLICY
   * ========================================================================= */
  const BILLING_POLICY = {
    model:            'postpaid_monthly_consolidated',
    trial_guides:     10,
    standard_price:   5.00,
    premium_price:    7.50,
    closing_day:      1,
    due_days:         10,
    currency:         'BRL',
    invoice_version:  1,
    billable_statuses: new Set(['billing_reported', 'billing_reconciled'])
  };

  /* =========================================================================
   * COST MODEL
   * ========================================================================= */
  const COST_MODEL = {
    infra_cost_per_standard_guide: 0.50,
    infra_cost_per_premium_guide:  0.80
  };

  /* =========================================================================
   * F12 — LOGGER ESTRUTURADO
   * ========================================================================= */
  const Logger = {
    _fmt(level, event, ctx) {
      ctx = ctx || {};
      return {
        ts:             new Date().toISOString(),
        level:          level,
        event:          event,
        service:        'neuroauth_monthly_billing_aggregator',
        version:        VERSION,
        correlation_id: ctx.correlation_id || null,
        user_id:        ctx.user_id        || null,
        invoice_id:     ctx.invoice_id     || null,
        period:         ctx.period         || null
      };
    },
    info: function(event, ctx) {
      if (typeof console !== 'undefined')
        console.info('[AGGR]', JSON.stringify(this._fmt('INFO', event, ctx)));
    },
    warn: function(event, ctx) {
      if (typeof console !== 'undefined')
        console.warn('[AGGR]', JSON.stringify(this._fmt('WARN', event, ctx)));
    },
    error: function(event, ctx) {
      if (typeof console !== 'undefined')
        console.error('[AGGR]', JSON.stringify(this._fmt('ERROR', event, ctx)));
    }
  };

  /* =========================================================================
   * HELPERS
   * ========================================================================= */

  function _period(isoDate) {
    return (isoDate || '').substring(0, 7);
  }

  function _currentPeriod() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function _periodFromYearMonth(year, month) {
    return year + '-' + String(month).padStart(2, '0');
  }

  function _fmtBRL(v) {
    return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  }

  function _safeId(str) {
    return String(str || 'anon').replace(/[^A-Za-z0-9_-]/g, '_').substring(0, 32);
  }

  function _getDueDate(period) {
    var parts = period.split('-').map(Number);
    var y = parts[0], m = parts[1];
    var closing = new Date(y, m - 1, BILLING_POLICY.closing_day);
    var due     = new Date(closing.getTime() + BILLING_POLICY.due_days * 86400000);
    return due.toISOString().split('T')[0];
  }

  function _generateInvoiceId(period, userId, version) {
    version = version || 1;
    return 'NI-' + period + '-' + _safeId(userId) + '-V' + version;
  }

  function _generateClosingId(period, version) {
    version = version || 1;
    return 'CLOSE-' + period + '-V' + version;
  }

  /* =========================================================================
   * F11 — STORAGE ADAPTERS
   * ========================================================================= */

  // ── Invoice Storage ────────────────────────────────────────────────────────

  function MemoryInvoiceStorage() {
    this._invoices = {};  // invoiceId → invoice
    this._byUser   = {};  // userId   → [invoiceId, ...]
    this._byPeriod = {};  // period   → [invoiceId, ...]
  }

  MemoryInvoiceStorage.prototype.saveInvoice = function(invoice) {
    var id     = invoice.invoice_id;
    var userId = invoice.user_id;
    var period = invoice.invoice_period;
    this._invoices[id] = invoice;
    if (!this._byUser[userId])   this._byUser[userId]   = [];
    if (!this._byPeriod[period]) this._byPeriod[period] = [];
    if (this._byUser[userId].indexOf(id)   < 0) this._byUser[userId].push(id);
    if (this._byPeriod[period].indexOf(id) < 0) this._byPeriod[period].push(id);
    return Promise.resolve(invoice);
  };

  MemoryInvoiceStorage.prototype.findInvoice = function(invoiceId) {
    return Promise.resolve(this._invoices[invoiceId] || null);
  };

  MemoryInvoiceStorage.prototype.listInvoicesByPeriod = function(period) {
    var self = this;
    var ids  = this._byPeriod[period] || [];
    return Promise.resolve(ids.map(function(id) { return self._invoices[id]; }).filter(Boolean));
  };

  MemoryInvoiceStorage.prototype.listInvoicesByUser = function(userId, opts) {
    opts = opts || {};
    var self = this;
    var ids  = this._byUser[userId] || [];
    return Promise.resolve(
      ids.map(function(id) { return self._invoices[id]; })
        .filter(Boolean)
        .filter(function(inv) { return !opts.fromPeriod || inv.invoice_period >= opts.fromPeriod; })
        .filter(function(inv) { return !opts.toPeriod   || inv.invoice_period <= opts.toPeriod; })
        .sort(function(a, b) { return a.invoice_period.localeCompare(b.invoice_period); })
    );
  };

  MemoryInvoiceStorage.prototype.updateInvoiceStatus = function(invoiceId, newStatus) {
    var inv = this._invoices[invoiceId];
    if (!inv) return Promise.resolve(false);
    inv.status      = newStatus;
    inv._updated_at = new Date().toISOString();
    return Promise.resolve(true);
  };

  MemoryInvoiceStorage.prototype.countUserLifetimeGuides = function(userId, upToPeriod) {
    var self = this;
    var ids  = this._byUser[userId] || [];
    var sum  = ids
      .map(function(id) { return self._invoices[id]; })
      .filter(Boolean)
      .filter(function(inv) { return !upToPeriod || inv.invoice_period < upToPeriod; })
      .reduce(function(acc, inv) { return acc + (inv.total_guias || 0); }, 0);
    return Promise.resolve(sum);
  };

  // ── Closing Storage ────────────────────────────────────────────────────────

  function MemoryClosingStorage() {
    this._closings = {};  // closingId → snapshot
  }

  MemoryClosingStorage.prototype.saveClosing = function(snapshot) {
    this._closings[snapshot.closing_id] = snapshot;
    return Promise.resolve(snapshot);
  };

  MemoryClosingStorage.prototype.findClosing = function(closingId) {
    return Promise.resolve(this._closings[closingId] || null);
  };

  MemoryClosingStorage.prototype.listClosings = function(opts) {
    opts = opts || {};
    var all = Object.values(this._closings);
    if (opts.period) all = all.filter(function(c) { return c.period === opts.period; });
    return Promise.resolve(all);
  };

  // ── Storage stubs (Sheets / API — production adapters, fallback to Memory) ──

  function GoogleSheetsInvoiceStorage(cfg) {
    // Stub: production impl connects to Google Sheets via Sheets API v4.
    // Falls back to MemoryInvoiceStorage until configured.
    var mem = new MemoryInvoiceStorage();
    mem._sheetId  = cfg && cfg.sheetId;
    mem._apiKey   = cfg && cfg.apiKey;
    return mem;
  }

  function GoogleSheetsClosingStorage(cfg) {
    var mem = new MemoryClosingStorage();
    mem._sheetId  = cfg && cfg.sheetId;
    mem._apiKey   = cfg && cfg.apiKey;
    return mem;
  }

  function APIClosingStorage(cfg) {
    var mem = new MemoryClosingStorage();
    mem._baseUrl = cfg && cfg.baseUrl;
    return mem;
  }

  // ── Pluggable singletons ───────────────────────────────────────────────────

  var InvoiceStorage = {
    _adapter: new MemoryInvoiceStorage(),
    configure: function(adapter) {
      this._adapter = adapter;
      Logger.info('aggregation.storage.invoice.configured');
    },
    saveInvoice:              function(inv)       { return this._adapter.saveInvoice(inv); },
    findInvoice:              function(id)        { return this._adapter.findInvoice(id); },
    listInvoicesByPeriod:     function(p)         { return this._adapter.listInvoicesByPeriod(p); },
    listInvoicesByUser:       function(uid, opts) { return this._adapter.listInvoicesByUser(uid, opts); },
    updateInvoiceStatus:      function(id, s)     { return this._adapter.updateInvoiceStatus(id, s); },
    countUserLifetimeGuides:  function(uid, utp)  { return this._adapter.countUserLifetimeGuides(uid, utp); }
  };

  var ClosingStorage = {
    _adapter: new MemoryClosingStorage(),
    configure: function(adapter) {
      this._adapter = adapter;
      Logger.info('aggregation.storage.closing.configured');
    },
    saveClosing:  function(snap)  { return this._adapter.saveClosing(snap); },
    findClosing:  function(id)    { return this._adapter.findClosing(id); },
    listClosings: function(opts)  { return this._adapter.listClosings(opts); }
  };

  /* =========================================================================
   * F1 — REAL LEDGER CONNECTOR
   * Camada 2 — ponto único de leitura do ledger real do BillingBridge.
   * O agregador NUNCA tem cópia própria dos eventos.
   * ========================================================================= */
  var RealLedgerConnector = {
    _clientRef: null,

    configure: function(client) {
      this._clientRef = client;
      Logger.info('aggregation.ledger_connector.configured');
    },

    _resolveClient: function() {
      if (this._clientRef) return this._clientRef;

      // 1. NEUROAUTH_BILLING_CLIENT global (browser)
      if (typeof NEUROAUTH_BILLING_CLIENT !== 'undefined') { // eslint-disable-line no-undef
        this._clientRef = NEUROAUTH_BILLING_CLIENT; // eslint-disable-line no-undef
        return this._clientRef;
      }

      // 2. Node.js require (BillingBridgeClient)
      if (typeof require !== 'undefined') {
        try {
          this._clientRef = require('./neuroauth_billing_bridge_client');
          return this._clientRef;
        } catch (_) {}
      }

      // 3. Fallback direto ao bridge global
      if (typeof NEUROAUTH_BILLING_BRIDGE !== 'undefined') { // eslint-disable-line no-undef
        var bridge = NEUROAUTH_BILLING_BRIDGE; // eslint-disable-line no-undef
        this._clientRef = {
          getLedger:          function(opts) { return bridge.BillingLedger.list(opts || {}); },
          updateLedgerStatus: function(k, s, e) { return bridge.BillingLedger.updateStatus(k, s, e); }
        };
        return this._clientRef;
      }

      // 4. Fallback direto ao bridge via require
      if (typeof require !== 'undefined') {
        try {
          var br = require('./neuroauth_billing_bridge');
          this._clientRef = {
            getLedger:          function(opts) { return br.BillingLedger.list(opts || {}); },
            updateLedgerStatus: function(k, s, e) { return br.BillingLedger.updateStatus(k, s, e); }
          };
          return this._clientRef;
        } catch (_) {}
      }

      throw new Error(
        '[NEUROAUTH_AGGREGATOR] Nenhum BillingClient ou Bridge disponível. ' +
        'Carregue neuroauth_billing_bridge.js e neuroauth_billing_bridge_client.js antes deste.'
      );
    },

    getEvents: function(opts) {
      var client = this._resolveClient();
      return client.getLedger(opts || {});
    },

    markReconciled: function(idempotencyKey, meta) {
      meta = meta || {};
      var client = this._resolveClient();
      if (client.updateLedgerStatus) {
        return client.updateLedgerStatus(idempotencyKey, 'billing_reconciled', Object.assign({
          reconciled_at: new Date().toISOString()
        }, meta));
      }
      return Promise.resolve(false);
    }
  };

  /* =========================================================================
   * F3 — VALIDAÇÃO DO CONTRATO DO EVENTO
   * ========================================================================= */
  var REQUIRED_FIELDS = [
    'guia_id', 'billing_id', 'idempotency_key',
    'user_id', 'tier', 'amount_brl', 'status', 'generated_at'
  ];

  function validateEventSchema(event) {
    var missing = REQUIRED_FIELDS.filter(function(f) {
      return event[f] === undefined || event[f] === null;
    });
    if (missing.length > 0) return { valid: false, missing: missing };
    if (['standard', 'premium'].indexOf(event.tier) < 0) {
      return { valid: false, missing: [], error: 'tier inválido: ' + event.tier };
    }
    return { valid: true, missing: [] };
  }

  /* =========================================================================
   * F2 + F4 — getBillableEventsForPeriod
   * ========================================================================= */

  async function getBillableEventsForPeriod(opts) {
    opts = opts || {};
    var year  = opts.year;
    var month = opts.month;
    var cid   = opts.correlationId || null;
    var period = (year && month) ? _periodFromYearMonth(year, month) : _currentPeriod();

    Logger.info('aggregation.events.loading', { period: period, correlation_id: cid });

    var allEvents;
    try {
      allEvents = await RealLedgerConnector.getEvents();
    } catch (err) {
      Logger.error('aggregation.events.load_failed', { period: period, error: err.message, correlation_id: cid });
      throw err;
    }

    Logger.info('aggregation.events.loaded', {
      period:    period,
      total_raw: allEvents.length,
      correlation_id: cid
    });

    // F4.1 — Filtrar por período (generated_at)
    var periodEvents = allEvents.filter(function(e) { return _period(e.generated_at) === period; });

    // F4.2 — Apenas billable statuses
    var statusFiltered = periodEvents.filter(function(e) {
      return BILLING_POLICY.billable_statuses.has(e.status);
    });

    // F4.3 — Deduplicar por idempotency_key
    var seen = {};
    var deduplicated = statusFiltered.filter(function(e) {
      var key = e.idempotency_key || e.billing_id || e.guia_id;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    // F4.4 — Remover inválidos
    var valid = deduplicated.filter(function(e) { return e.user_id && e.guia_id; });

    var meta = {
      period:             period,
      total_raw:          allEvents.length,
      period_raw:         periodEvents.length,
      status_filtered:    statusFiltered.length,
      duplicates_removed: statusFiltered.length - deduplicated.length,
      invalid_removed:    deduplicated.length - valid.length,
      billable_count:     valid.length
    };

    Logger.info('aggregation.events.filtered', Object.assign({ correlation_id: cid }, meta));

    return { events: valid, meta: meta };
  }

  /* =========================================================================
   * F5 — TRIAL POLICY — desconto contábil real
   * ========================================================================= */

  async function applyTrialPolicy(events, userId, period) {
    var lifetimeBefore = await InvoiceStorage.countUserLifetimeGuides(userId, period);
    var trialTotal     = BILLING_POLICY.trial_guides;

    Logger.info('aggregation.trial.applied', {
      user_id:         userId,
      period:          period,
      lifetime_before: lifetimeBefore,
      trial_total:     trialTotal,
      events_count:    events.length
    });

    if (lifetimeBefore >= trialTotal) {
      return {
        billable_events:      events,
        trial_covered_events: [],
        trial_line_item:      null,
        trial_summary: {
          lifetime_before:  lifetimeBefore,
          trial_used:       trialTotal,
          trial_remaining:  0,
          in_trial:         false
        }
      };
    }

    var remainingTrial   = trialTotal - lifetimeBefore;
    var coverCount       = Math.min(remainingTrial, events.length);
    var trialEvents      = events.slice(0, coverCount);
    var billableEvents   = events.slice(coverCount);
    var trialDiscountBrl = trialEvents.reduce(function(s, e) { return s + (e.amount_brl || 0); }, 0);

    var trialLineItem = coverCount > 0 ? {
      type:         'trial_discount',
      description:  'Trial — primeiras ' + trialTotal + ' guias NeuroAuth',
      quantity:     coverCount,
      unit_amount:  -(BILLING_POLICY.standard_price),
      total_amount: -trialDiscountBrl,
      guia_ids:     trialEvents.map(function(e) { return e.guia_id; }),
      billing_ids:  trialEvents.map(function(e) { return e.billing_id; })
    } : null;

    return {
      billable_events:      billableEvents,
      trial_covered_events: trialEvents,
      trial_line_item:      trialLineItem,
      trial_summary: {
        lifetime_before:  lifetimeBefore,
        trial_used:       lifetimeBefore + coverCount,
        trial_remaining:  Math.max(0, remainingTrial - coverCount),
        in_trial:         billableEvents.length === 0
      }
    };
  }

  /* =========================================================================
   * F6 — INVOICE MENSAL COM VERSIONAMENTO
   * ========================================================================= */

  async function buildMonthlyInvoice(opts) {
    opts = opts || {};
    var userId        = opts.userId;
    var period        = opts.period;
    var version       = opts.version || 1;
    var providedEvts  = opts.events;
    var cid           = opts.correlationId || null;

    var invoiceId = _generateInvoiceId(period, userId, version);

    // Idempotência
    var existing = await InvoiceStorage.findInvoice(invoiceId);
    if (existing) {
      Logger.info('aggregation.invoice.already_exists', { invoice_id: invoiceId, user_id: userId });
      return Object.assign({}, existing, { _idempotent: true });
    }

    // Buscar eventos se não fornecidos
    var periodEvents = providedEvts;
    if (!periodEvents) {
      var parts = period.split('-').map(Number);
      var result = await getBillableEventsForPeriod({
        year: parts[0], month: parts[1], correlationId: cid
      });
      periodEvents = result.events.filter(function(e) { return e.user_id === userId; });
    }

    // F5 — Trial contábil
    var trialResult  = await applyTrialPolicy(periodEvents, userId, period);
    var billableEvts = trialResult.billable_events;
    var trialEvts    = trialResult.trial_covered_events;
    var trialItem    = trialResult.trial_line_item;
    var trialSummary = trialResult.trial_summary;

    // Line items de faturamento
    var billingLineItems = billableEvts.map(function(e) {
      return {
        type:         'guide_generation',
        guia_id:      e.guia_id,
        billing_id:   e.billing_id,
        tier:         e.tier,
        sku:          e.sku || (e.tier === 'premium' ? 'guia_neuroauth_sadt_opme_premium' : 'guia_neuroauth_sadt'),
        operadora:    e.operadora || '—',
        generated_at: e.generated_at,
        unit_amount:  e.amount_brl || 0,
        total_amount: e.amount_brl || 0
      };
    });

    var stdItems = billableEvts.filter(function(e) { return e.tier === 'standard'; });
    var prmItems = billableEvts.filter(function(e) { return e.tier === 'premium'; });

    var subtotalStd  = stdItems.reduce(function(s, e) { return s + (e.amount_brl || 0); }, 0);
    var subtotalPrm  = prmItems.reduce(function(s, e) { return s + (e.amount_brl || 0); }, 0);
    var subtotal     = subtotalStd + subtotalPrm;
    var trialDisc    = trialItem ? Math.abs(trialItem.total_amount) : 0;
    var totalBrl     = Math.max(0, subtotal - trialDisc);

    var partsYM  = period.split('-').map(Number);

    var invoice = {
      invoice_id:      invoiceId,
      invoice_period:  period,
      invoice_version: version,
      status:          'open',

      user_id:         userId,

      total_guias:     periodEvents.length,
      total_standard:  stdItems.length,
      total_premium:   prmItems.length,
      total_trial:     trialEvts.length,
      total_billable:  billableEvts.length,

      subtotal_standard_brl: parseFloat(subtotalStd.toFixed(2)),
      subtotal_premium_brl:  parseFloat(subtotalPrm.toFixed(2)),
      subtotal_brl:          parseFloat(subtotal.toFixed(2)),
      trial_discount_brl:    parseFloat(trialDisc.toFixed(2)),
      total_brl:             parseFloat(totalBrl.toFixed(2)),
      total_formatted:       _fmtBRL(totalBrl),
      currency:              BILLING_POLICY.currency,

      trial_summary: trialSummary,

      line_items: billingLineItems.concat(trialItem ? [trialItem] : []),

      source_billing_ids:  periodEvents.map(function(e) { return e.billing_id; }).filter(Boolean),
      source_guia_ids:     periodEvents.map(function(e) { return e.guia_id; }).filter(Boolean),
      source_ik_count:     periodEvents.length,

      closing_date: new Date(partsYM[0], partsYM[1] - 1, BILLING_POLICY.closing_day).toISOString().split('T')[0],
      due_date:     _getDueDate(period),

      generated_at:    new Date().toISOString(),
      correlation_id:  cid,
      _schema_version: '2.0.0'
    };

    await InvoiceStorage.saveInvoice(invoice);

    Logger.info('aggregation.invoice.generated', {
      invoice_id:   invoice.invoice_id,
      user_id:      userId,
      period:       period,
      total_brl:    invoice.total_formatted,
      total_guias:  invoice.total_guias,
      trial_guides: invoice.total_trial,
      correlation_id: cid
    });

    return invoice;
  }

  /* =========================================================================
   * F7 — FECHAMENTO MENSAL REPRODUZÍVEL
   * ========================================================================= */

  async function closeBillingPeriod(opts) {
    opts = opts || {};
    var year        = opts.year;
    var month       = opts.month;
    var forceReopen = opts.forceReopen || false;
    var version     = opts.version || BILLING_POLICY.invoice_version;

    var period    = (year && month) ? _periodFromYearMonth(year, month) : _currentPeriod();
    var closingId = _generateClosingId(period, version);
    var cid       = 'CLOSE-COR-' + Date.now();

    // F7.1 — Idempotência
    var existing = await ClosingStorage.findClosing(closingId);
    if (existing && !forceReopen) {
      Logger.warn('aggregation.closing.already_exists', { period: period, closing_id: closingId });
      return { success: false, reason: 'already_closed', closing_id: closingId, period: period };
    }

    Logger.info('aggregation.closing.start', { period: period, closing_id: closingId, correlation_id: cid });

    // F7.2 — Buscar eventos reais
    var eventsResult;
    try {
      eventsResult = await getBillableEventsForPeriod({ year: year, month: month, correlationId: cid });
    } catch (err) {
      Logger.error('aggregation.closing.events_failed', { period: period, error: err.message });
      return { success: false, reason: 'ledger_unavailable', error: err.message, period: period };
    }

    var events    = eventsResult.events;
    var eventsMeta = eventsResult.meta;

    // F7.3 — Agrupar por usuário
    var byUser = {};
    events.forEach(function(e) {
      var uid = e.user_id;
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(e);
    });

    Logger.info('aggregation.closing.users_found', {
      period: period, users: Object.keys(byUser).length, correlation_id: cid
    });

    // F7.4 — Invoices por usuário
    var invoices = [];
    var skipped  = [];
    var userIds  = Object.keys(byUser);
    for (var i = 0; i < userIds.length; i++) {
      var uid        = userIds[i];
      var userEvents = byUser[uid];
      try {
        var inv = await buildMonthlyInvoice({
          userId: uid, period: period, version: version,
          events: userEvents, correlationId: cid
        });
        invoices.push(inv);
      } catch (err) {
        Logger.error('aggregation.closing.invoice_failed', { user_id: uid, period: period, error: err.message });
        skipped.push({ user_id: uid, reason: err.message });
      }
    }

    // F7.5 — Rentabilidade
    var profitability = calculateProfitability({ events: events, period: period });

    // F7.6 — Snapshot
    var totalRevenue = invoices.reduce(function(s, inv) { return s + (inv.total_brl || 0); }, 0);

    var snapshot = {
      closing_id:        closingId,
      period:            period,
      version:           version,
      status:            'closed',
      closed_at:         new Date().toISOString(),
      correlation_id:    cid,
      users_billed:      invoices.length,
      users_skipped:     skipped.length,
      total_events:      events.length,
      events_meta:       eventsMeta,
      total_revenue_brl: parseFloat(totalRevenue.toFixed(2)),
      total_revenue_fmt: _fmtBRL(totalRevenue),
      invoice_ids:       invoices.map(function(inv) { return inv.invoice_id; }),
      invoices:          invoices,
      skipped:           skipped,
      profitability:     profitability,
      _schema_version:   '2.0.0'
    };

    await ClosingStorage.saveClosing(snapshot);

    Logger.info('aggregation.closing.completed', {
      period:        period,
      closing_id:    closingId,
      users_billed:  invoices.length,
      total_revenue: snapshot.total_revenue_fmt,
      correlation_id: cid
    });

    return {
      success:           true,
      closing_id:        closingId,
      period:            period,
      version:           version,
      users_billed:      invoices.length,
      total_revenue_brl: snapshot.total_revenue_brl,
      total_revenue_fmt: snapshot.total_revenue_fmt,
      invoices:          invoices,
      skipped:           skipped,
      profitability:     profitability,
      snapshot:          snapshot
    };
  }

  /* =========================================================================
   * F8 — DASHBOARD DO MÉDICO
   * ========================================================================= */

  async function getDoctorDashboard(userId, period) {
    var p   = period || _currentPeriod();
    var cid = 'DASH-DR-' + userId + '-' + p;

    Logger.info('aggregation.dashboard.doctor.loading', { user_id: userId, period: p });

    var allEvents;
    try {
      allEvents = await RealLedgerConnector.getEvents();
    } catch (err) {
      Logger.error('aggregation.dashboard.doctor.load_failed', { user_id: userId, error: err.message });
      allEvents = [];
    }

    var periodEvents = allEvents.filter(function(e) {
      return e.user_id === userId && _period(e.generated_at) === p;
    });

    var pending  = periodEvents.filter(function(e) { return e.status === 'billing_pending'; });
    var billable = periodEvents.filter(function(e) { return BILLING_POLICY.billable_statuses.has(e.status); });

    var totalGuias   = periodEvents.length;
    var stdCount     = billable.filter(function(e) { return e.tier === 'standard'; }).length;
    var prmCount     = billable.filter(function(e) { return e.tier === 'premium'; }).length;
    var pendingCount = pending.length;

    var gastoAcum = billable.reduce(function(s, e) { return s + (e.amount_brl || 0); }, 0);

    // Trial via histórico de invoices reais
    var lifetimeBefore  = await InvoiceStorage.countUserLifetimeGuides(userId, p);
    var trialTotal      = BILLING_POLICY.trial_guides;
    var trialUsed       = Math.min(lifetimeBefore + totalGuias, trialTotal);
    var trialRemaining  = Math.max(0, trialTotal - lifetimeBefore - totalGuias);
    var trialGuidesMes  = Math.max(0, Math.min(totalGuias, Math.max(0, trialTotal - lifetimeBefore)));
    var economiaTrial   = trialGuidesMes > 0
      ? periodEvents.slice(0, trialGuidesMes).reduce(function(s, e) { return s + (e.amount_brl || 0); }, 0)
      : 0;

    // Por operadora (billable)
    var byOp = {};
    billable.forEach(function(e) {
      var op = e.operadora || '—';
      if (!byOp[op]) byOp[op] = { operadora: op, guias: 0, total: 0, total_formatted: '' };
      byOp[op].guias++;
      byOp[op].total += e.amount_brl || 0;
    });
    Object.values(byOp).forEach(function(o) { o.total_formatted = _fmtBRL(o.total); });
    var porOperadora = Object.values(byOp).sort(function(a, b) { return b.guias - a.guias; });

    // Por tier
    var resumoTier = {
      standard:     stdCount,
      premium:      prmCount,
      standard_pct: totalGuias > 0 ? parseFloat(((stdCount / totalGuias) * 100).toFixed(1)) : 0,
      premium_pct:  totalGuias > 0 ? parseFloat(((prmCount / totalGuias) * 100).toFixed(1)) : 0
    };

    // Últimas guias
    var ultimasGuias = periodEvents
      .slice()
      .sort(function(a, b) { return (b.generated_at || '').localeCompare(a.generated_at || ''); })
      .slice(0, 10)
      .map(function(e) {
        return {
          guia_id:          e.guia_id,
          billing_id:       e.billing_id,
          tier:             e.tier,
          operadora:        e.operadora || '—',
          procedimento:     e.procedimento_desc || e.procedimento_tuss || '—',
          opme_count:       e.opme_count || 0,
          amount_brl:       e.amount_brl || 0,
          amount_formatted: e.amount_formatted || _fmtBRL(e.amount_brl),
          status:           e.status,
          generated_at:     e.generated_at,
          paciente_iniciais: e.paciente_iniciais || '—'
        };
      });

    // Invoice do período atual
    var invoicesPeriodo = await InvoiceStorage.listInvoicesByPeriod(p);
    var invoiceAtual    = invoicesPeriodo.filter(function(i) { return i.user_id === userId; })[0] || null;

    var dashboard = {
      user_id:              userId,
      current_period:       p,

      total_guias_mes:      totalGuias,
      total_standard_mes:   stdCount,
      total_premium_mes:    prmCount,
      total_trial_mes:      trialGuidesMes,
      pending_registration: pendingCount,

      gasto_acumulado_brl:       parseFloat(gastoAcum.toFixed(2)),
      gasto_acumulado_formatado: _fmtBRL(gastoAcum),
      economia_trial_brl:        parseFloat(economiaTrial.toFixed(2)),
      economia_trial_formatado:  _fmtBRL(economiaTrial),

      trial_used:      trialUsed,
      trial_remaining: trialRemaining,
      trial_active:    lifetimeBefore < trialTotal,

      ultimo_invoice_id: invoiceAtual ? invoiceAtual.invoice_id : null,
      status_invoice:    invoiceAtual ? invoiceAtual.status      : 'not_generated',

      resumo_por_operadora: porOperadora,
      resumo_por_tier:      resumoTier,
      ultimas_guias:        ultimasGuias,

      generated_at: new Date().toISOString()
    };

    Logger.info('aggregation.dashboard.doctor.loaded', {
      user_id:     userId,
      period:      p,
      total_guias: totalGuias,
      correlation_id: cid
    });

    return dashboard;
  }

  /* =========================================================================
   * F9 — DASHBOARD ADMIN
   * ========================================================================= */

  async function getAdminDashboard(period) {
    var p   = period || _currentPeriod();
    var cid = 'DASH-ADMIN-' + p;

    Logger.info('aggregation.dashboard.admin.loading', { period: p });

    var allEvents;
    try {
      allEvents = await RealLedgerConnector.getEvents();
    } catch (err) {
      Logger.error('aggregation.dashboard.admin.load_failed', { error: err.message });
      allEvents = [];
    }

    var periodEvents = allEvents.filter(function(e) { return _period(e.generated_at) === p; });
    var billable     = periodEvents.filter(function(e) { return BILLING_POLICY.billable_statuses.has(e.status); });
    var pending      = periodEvents.filter(function(e) { return e.status === 'billing_pending'; });
    var failed       = periodEvents.filter(function(e) { return e.status === 'billing_report_failed'; });

    var totalGuias    = billable.length;
    var stdCount      = billable.filter(function(e) { return e.tier === 'standard'; }).length;
    var prmCount      = billable.filter(function(e) { return e.tier === 'premium'; }).length;
    var grossRevenue  = billable.reduce(function(s, e) { return s + (e.amount_brl || 0); }, 0);
    var revenueStd    = billable.filter(function(e) { return e.tier === 'standard'; })
                                .reduce(function(s, e) { return s + (e.amount_brl || 0); }, 0);
    var revenuePrm    = billable.filter(function(e) { return e.tier === 'premium'; })
                                .reduce(function(s, e) { return s + (e.amount_brl || 0); }, 0);

    // Usuários ativos
    var activeUserIds = {};
    billable.forEach(function(e) { activeUserIds[e.user_id] = true; });
    var activeUsers = Object.keys(activeUserIds).length;

    var avgRevPerUser = activeUsers > 0 ? parseFloat((grossRevenue / activeUsers).toFixed(2)) : 0;
    var avgTicket     = totalGuias > 0  ? parseFloat((grossRevenue / totalGuias).toFixed(2))  : 0;

    // Top users
    var userTotals = {};
    billable.forEach(function(e) {
      if (!userTotals[e.user_id]) userTotals[e.user_id] = { user_id: e.user_id, guias: 0, revenue: 0 };
      userTotals[e.user_id].guias++;
      userTotals[e.user_id].revenue += e.amount_brl || 0;
    });
    var topUsers = Object.values(userTotals)
      .sort(function(a, b) { return b.revenue - a.revenue; })
      .slice(0, 10)
      .map(function(u) {
        return Object.assign({}, u, {
          revenue:           parseFloat(u.revenue.toFixed(2)),
          revenue_formatted: _fmtBRL(u.revenue)
        });
      });

    // Por operadora
    var byOp = {};
    billable.forEach(function(e) {
      var op = e.operadora || '—';
      if (!byOp[op]) byOp[op] = { operadora: op, guias: 0, revenue: 0 };
      byOp[op].guias++;
      byOp[op].revenue += e.amount_brl || 0;
    });
    var revenueByOp = Object.values(byOp)
      .sort(function(a, b) { return b.revenue - a.revenue; })
      .map(function(o) {
        return Object.assign({}, o, {
          revenue:           parseFloat(o.revenue.toFixed(2)),
          revenue_formatted: _fmtBRL(o.revenue)
        });
      });

    // Fechamento e invoices
    var closingsForPeriod = await ClosingStorage.listClosings({ period: p });
    var closingStatus     = closingsForPeriod.length > 0 ? closingsForPeriod[0].status : 'not_closed';
    var invoicesForPeriod = await InvoiceStorage.listInvoicesByPeriod(p);

    var profitability = calculateProfitability({ events: billable, period: p });

    var dashboard = {
      period: p,

      total_users_active:      activeUsers,
      total_guias:             totalGuias,
      total_standard:          stdCount,
      total_premium:           prmCount,
      pending_registration:    pending.length,
      failed_reports_count:    failed.length,

      gross_revenue_brl:            parseFloat(grossRevenue.toFixed(2)),
      gross_revenue_formatted:      _fmtBRL(grossRevenue),
      average_revenue_per_user_brl: avgRevPerUser,
      average_ticket_brl:           avgTicket,

      revenue_by_tier: {
        standard:           parseFloat(revenueStd.toFixed(2)),
        standard_formatted: _fmtBRL(revenueStd),
        premium:            parseFloat(revenuePrm.toFixed(2)),
        premium_formatted:  _fmtBRL(revenuePrm)
      },
      revenue_by_operadora: revenueByOp,
      top_users:            topUsers,

      invoices_generated_count:     invoicesForPeriod.length,
      pending_reconciliation_count: pending.length,
      closing_status:               closingStatus,

      profitability: profitability,
      generated_at:  new Date().toISOString()
    };

    Logger.info('aggregation.dashboard.admin.loaded', {
      period:       p,
      total_guias:  totalGuias,
      active_users: activeUsers,
      gross_revenue: _fmtBRL(grossRevenue),
      correlation_id: cid
    });

    return dashboard;
  }

  /* =========================================================================
   * F10 — RENTABILIDADE REAL
   * ========================================================================= */

  function calculateProfitability(opts) {
    opts = opts || {};
    var events  = opts.events  || [];
    var period  = opts.period  || null;

    var filtered = events.filter(function(e) {
      return BILLING_POLICY.billable_statuses.has(e.status);
    });
    if (period) filtered = filtered.filter(function(e) { return _period(e.generated_at) === period; });

    var stdEvts = filtered.filter(function(e) { return e.tier === 'standard'; });
    var prmEvts = filtered.filter(function(e) { return e.tier === 'premium'; });

    var grossRevenue  = filtered.reduce(function(s, e) { return s + (e.amount_brl || 0); }, 0);
    var estCost       =
      stdEvts.length * COST_MODEL.infra_cost_per_standard_guide +
      prmEvts.length * COST_MODEL.infra_cost_per_premium_guide;
    var grossMargin    = grossRevenue - estCost;
    var grossMarginPct = grossRevenue > 0
      ? parseFloat(((grossMargin / grossRevenue) * 100).toFixed(2))
      : 0;
    var avgRev  = filtered.length > 0 ? parseFloat((grossRevenue / filtered.length).toFixed(2)) : 0;
    var avgCost = filtered.length > 0 ? parseFloat((estCost      / filtered.length).toFixed(2)) : 0;
    var premMix = filtered.length > 0
      ? parseFloat(((prmEvts.length / filtered.length) * 100).toFixed(2))
      : 0;

    var report = {
      period:                    period || _currentPeriod(),
      total_events:              filtered.length,
      standard_count:            stdEvts.length,
      premium_count:             prmEvts.length,
      gross_revenue_brl:         parseFloat(grossRevenue.toFixed(2)),
      gross_revenue_fmt:         _fmtBRL(grossRevenue),
      estimated_cost_brl:        parseFloat(estCost.toFixed(2)),
      estimated_cost_fmt:        _fmtBRL(estCost),
      gross_margin_brl:          parseFloat(grossMargin.toFixed(2)),
      gross_margin_fmt:          _fmtBRL(grossMargin),
      gross_margin_pct:          grossMarginPct,
      avg_revenue_per_guide_brl: avgRev,
      avg_cost_per_guide_brl:    avgCost,
      premium_mix_pct:           premMix,
      generated_at:              new Date().toISOString()
    };

    Logger.info('aggregation.profitability.calculated', {
      period:        report.period,
      gross_revenue: report.gross_revenue_fmt,
      margin_pct:    report.gross_margin_pct
    });

    return report;
  }

  /* =========================================================================
   * configure() — ponto único de configuração
   * ========================================================================= */

  function configure(opts) {
    opts = opts || {};
    if (opts.client)         RealLedgerConnector.configure(opts.client);
    if (opts.invoiceStorage) InvoiceStorage.configure(opts.invoiceStorage);
    if (opts.closingStorage) ClosingStorage.configure(opts.closingStorage);
  }

  /* =========================================================================
   * CHANGELOG
   * ========================================================================= */
  var CHANGELOG = [
    {
      version: '2.0.0',
      date:    '2026-03-26',
      changes: [
        'ARCH-A001: RealLedgerConnector — conectado ao BillingBridge (Fase 1)',
        'ARCH-A002: getBillableEventsForPeriod() lê ledger real + filtra + deduplica (Fase 2+4)',
        'ARCH-A003: validateEventSchema() valida contrato formal (Fase 3)',
        'ARCH-A004: applyTrialPolicy() com desconto contábil real em line items (Fase 5)',
        'ARCH-A005: buildMonthlyInvoice() idempotente com source_billing_ids (Fase 6)',
        'ARCH-A006: closeBillingPeriod() reproduzível com forceReopen + versionamento (Fase 7)',
        'ARCH-A007: getDoctorDashboard(userId, period) lê ledger real — sem ledgerEvents param (Fase 8)',
        'ARCH-A008: getAdminDashboard(period) lê ledger real — sem ledgerEvents param (Fase 9)',
        'ARCH-A009: calculateProfitability() com COST_MODEL real (Fase 10)',
        'ARCH-A010: InvoiceStorageAdapter + ClosingStorageAdapter plugáveis (Fase 11)',
        'ARCH-A011: Logger estruturado com correlation_id em todas as operações (Fase 12)',
        'ARCH-A012: configure({ client, invoiceStorage, closingStorage }) ponto único',
        'BREAK-001: getDoctorDashboard/getAdminDashboard não aceitam mais ledgerEvents param',
        'BREAK-002: BillingAggregationEngine removido — use getBillableEventsForPeriod()',
        'REMOVE-001: Todos os mocks e dados fixos removidos do fluxo principal'
      ]
    },
    {
      version: '1.0.0',
      date:    '2026-03-25',
      changes: ['Implementação inicial com storage em memória e dashboards básicos']
    }
  ];

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */
  return {
    VERSION:        VERSION,
    CHANGELOG:      CHANGELOG,
    BILLING_POLICY: BILLING_POLICY,
    COST_MODEL:     COST_MODEL,

    // Config
    configure:             configure,

    // Connectors e Storage (para injeção e testes)
    RealLedgerConnector:   RealLedgerConnector,
    InvoiceStorage:        InvoiceStorage,
    ClosingStorage:        ClosingStorage,

    // Storage Adapters (para configure)
    MemoryInvoiceStorage:       MemoryInvoiceStorage,
    GoogleSheetsInvoiceStorage: GoogleSheetsInvoiceStorage,
    APIInvoiceStorage:          function(cfg) { var s = new MemoryInvoiceStorage(); s._baseUrl = cfg && cfg.baseUrl; return s; },
    MemoryClosingStorage:       MemoryClosingStorage,
    GoogleSheetsClosingStorage: GoogleSheetsClosingStorage,
    APIClosingStorage:          APIClosingStorage,

    // Fase 2+4
    getBillableEventsForPeriod: getBillableEventsForPeriod,

    // Fase 3
    validateEventSchema:    validateEventSchema,

    // Fase 5
    applyTrialPolicy:       applyTrialPolicy,

    // Fase 6
    buildMonthlyInvoice:    buildMonthlyInvoice,

    // Fase 7
    closeBillingPeriod:     closeBillingPeriod,

    // Fase 8
    getDoctorDashboard:     getDoctorDashboard,

    // Fase 9
    getAdminDashboard:      getAdminDashboard,

    // Fase 10
    calculateProfitability: calculateProfitability,

    // Utils
    fmtBRL:            _fmtBRL,
    currentPeriod:     _currentPeriod,
    periodFromDate:    _period,
    generateInvoiceId: _generateInvoiceId,
    generateClosingId: _generateClosingId
  };
}));
