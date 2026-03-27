/**
 * neuroauth_access_policy.js
 * NEUROAUTH_ACCESS_POLICY v1.0.0
 *
 * Camada de Política de Acesso — NEUROAUTH Revenue Experience Layer
 *
 * Responsabilidades:
 *   — Avaliar status financeiro de um usuário em tempo real
 *   — Retornar decisão de acesso padronizada e auditável
 *   — Aplicar política de inadimplência progressiva
 *   — Suportar manual override (whitelist, bloqueio emergencial)
 *   — Rastrear guias de cortesia durante grace period
 *
 * Estados de acesso (progressivos, nunca binários):
 *   active         → sem pendência / invoice paga → acesso total
 *   warning        → invoice aberta, vencimento em ≤ 3 dias → acesso total + banner leve
 *   grace_period   → invoice vencida há 1–7 dias → acesso total + cortesia + banner forte
 *   restricted     → invoice vencida há 8–14 dias → novas guias limitadas
 *   blocked        → invoice vencida há ≥ 15 dias → novas guias bloqueadas
 *
 * Princípios imutáveis:
 *   — Histórico e guias existentes NUNCA desaparecem
 *   — Dashboard, extrato e regularização sempre acessíveis
 *   — Regularização restaura acesso imediatamente
 *   — Toda decisão é auditável com correlation_id
 *
 * @version 1.0.0
 * @license Proprietary — NeuroAuth © 2026
 */

(function (root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.NEUROAUTH_ACCESS_POLICY = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var VERSION = '1.2.0';

  /* =========================================================================
   * DELINQUENCY POLICY — configurável
   * ========================================================================= */
  var DELINQUENCY_POLICY = {
    // Dias antes do vencimento para emitir aviso
    due_soon_days:                   3,

    // Dias de tolerância após vencimento antes de restringir
    grace_period_days:               7,

    // Dias após vencimento para entrar em restrição total
    restricted_after_days:           8,

    // Dias após vencimento para bloqueio completo de novas guias
    blocked_after_days:              15,

    // Guias de cortesia durante grace period
    courtesy_guides_during_grace:    3,

    // Novas guias premium bloqueadas no estado 'restricted' (antes do bloqueio total)
    block_premium_when_restricted:   true,

    // Bloquear TODAS as novas guias no estado 'restricted' (false = apenas premium)
    block_all_when_restricted:       false,

    // Histórico e guias já geradas sempre disponíveis
    preserve_existing_guides:        true,

    // Dashboard e extrato sempre acessíveis, mesmo no estado 'blocked'
    allow_dashboard_when_blocked:    true,

    // Regularização dentro do produto (não expulsa o usuário)
    allow_payment_recovery_when_blocked: true
  };

  /* =========================================================================
   * ACCESS STATES — definições canônicas
   * ========================================================================= */
  var ACCESS_STATES = {
    active: {
      access_state:              'active',
      allow_render:              true,
      allow_new_guides:          true,
      allow_new_premium_guides:  true,
      allow_download_existing:   true,
      allow_historical_access:   true,
      allow_dashboard:           true,
      allow_payment_recovery:    true,
      show_billing_banner:       false,
      severity:                  'info'
    },
    warning: {
      access_state:              'warning',
      allow_render:              true,
      allow_new_guides:          true,
      allow_new_premium_guides:  true,
      allow_download_existing:   true,
      allow_historical_access:   true,
      allow_dashboard:           true,
      allow_payment_recovery:    true,
      show_billing_banner:       true,
      severity:                  'warning'
    },
    grace_period: {
      access_state:              'grace_period',
      allow_render:              true,
      allow_new_guides:          true,
      allow_new_premium_guides:  true,
      allow_download_existing:   true,
      allow_historical_access:   true,
      allow_dashboard:           true,
      allow_payment_recovery:    true,
      show_billing_banner:       true,
      severity:                  'warning'
    },
    restricted: {
      access_state:              'restricted',
      allow_render:              false, // default — pode ser true para standard se block_all=false
      allow_new_guides:          false,
      allow_new_premium_guides:  false,
      allow_download_existing:   true,
      allow_historical_access:   true,
      allow_dashboard:           true,
      allow_payment_recovery:    true,
      show_billing_banner:       true,
      severity:                  'critical'
    },
    blocked: {
      access_state:              'blocked',
      allow_render:              false,
      allow_new_guides:          false,
      allow_new_premium_guides:  false,
      allow_download_existing:   true,
      allow_historical_access:   true,
      allow_dashboard:           true,
      allow_payment_recovery:    true,
      show_billing_banner:       true,
      severity:                  'critical'
    }
  };

  /* =========================================================================
   * LOGGER ESTRUTURADO
   * ========================================================================= */
  var Logger = {
    _fmt: function(level, event, ctx) {
      ctx = ctx || {};
      return {
        ts:              new Date().toISOString(),
        level:           level,
        event:           event,
        service:         'neuroauth_access_policy',
        version:         VERSION,
        correlation_id:  ctx.correlation_id  || null,
        user_id:         ctx.user_id         || null,
        invoice_id:      ctx.invoice_id      || null,
        access_state:    ctx.access_state    || null,
        reason_code:     ctx.reason_code     || null
      };
    },
    info: function(event, ctx) {
      if (typeof console !== 'undefined')
        console.info('[POLICY]', JSON.stringify(this._fmt('INFO', event, ctx)));
    },
    warn: function(event, ctx) {
      if (typeof console !== 'undefined')
        console.warn('[POLICY]', JSON.stringify(this._fmt('WARN', event, ctx)));
    },
    error: function(event, ctx) {
      if (typeof console !== 'undefined')
        console.error('[POLICY]', JSON.stringify(this._fmt('ERROR', event, ctx)));
    }
  };

  /* =========================================================================
   * HELPERS
   * ========================================================================= */
  function _nowIso() { return new Date().toISOString(); }

  function _daysBetween(isoA, isoB) {
    var a = new Date(isoA), b = new Date(isoB || _nowIso());
    return Math.floor((b - a) / (1000 * 60 * 60 * 24));
  }

  function _formatPtDate(isoDate) {
    if (!isoDate) return '—';
    var d = new Date(isoDate.includes('T') ? isoDate : isoDate + 'T12:00:00Z');
    return d.getUTCDate() + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear();
  }

  function _generateCid() {
    return 'POLICY-COR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  /* =========================================================================
   * ACCESS POLICY STORAGE ADAPTERS
   * ========================================================================= */

  // ── Memory (default) ──────────────────────────────────────────────────────
  function MemoryAccessPolicyStorage() {
    this._overrides  = {};  // userId → override record
    this._evaluations = {}; // userId → last evaluation record
  }

  MemoryAccessPolicyStorage.prototype.saveOverride = function(userId, override) {
    this._overrides[userId] = Object.assign({ created_at: _nowIso() }, override);
    return Promise.resolve(this._overrides[userId]);
  };

  MemoryAccessPolicyStorage.prototype.getOverride = function(userId) {
    return Promise.resolve(this._overrides[userId] || null);
  };

  MemoryAccessPolicyStorage.prototype.deleteOverride = function(userId) {
    delete this._overrides[userId];
    return Promise.resolve(true);
  };

  MemoryAccessPolicyStorage.prototype.saveEvaluation = function(userId, evaluation) {
    this._evaluations[userId] = evaluation;
    return Promise.resolve(evaluation);
  };

  MemoryAccessPolicyStorage.prototype.getLastEvaluation = function(userId) {
    return Promise.resolve(this._evaluations[userId] || null);
  };

  MemoryAccessPolicyStorage.prototype.listOverrides = function() {
    return Promise.resolve(Object.values(this._overrides));
  };

  // ── API stub ──────────────────────────────────────────────────────────────
  function APIAccessPolicyStorage(cfg) {
    var mem = new MemoryAccessPolicyStorage();
    mem._baseUrl = cfg && cfg.baseUrl;
    return mem;
  }

  // ── Sheets stub ───────────────────────────────────────────────────────────
  function GoogleSheetsAccessPolicyStorage(cfg) {
    var mem = new MemoryAccessPolicyStorage();
    mem._sheetId = cfg && cfg.sheetId;
    return mem;
  }

  /* =========================================================================
   * ACCESS POLICY STORAGE SINGLETON
   * ========================================================================= */
  var PolicyStorage = {
    _adapter: new MemoryAccessPolicyStorage(),
    configure: function(adapter) {
      this._adapter = adapter;
      Logger.info('access_policy.storage.configured');
    },
    saveOverride:       function(uid, o) { return this._adapter.saveOverride(uid, o); },
    getOverride:        function(uid)    { return this._adapter.getOverride(uid); },
    deleteOverride:     function(uid)    { return this._adapter.deleteOverride(uid); },
    saveEvaluation:     function(uid, e) { return this._adapter.saveEvaluation(uid, e); },
    getLastEvaluation:  function(uid)    { return this._adapter.getLastEvaluation(uid); },
    listOverrides:      function()       { return this._adapter.listOverrides(); }
  };

  /* =========================================================================
   * AGGREGATOR CONNECTOR (para busca de invoices reais)
   * ========================================================================= */
  var _aggregatorRef = null;

  function _resolveAggregator() {
    if (_aggregatorRef)                                           return _aggregatorRef;
    if (typeof NEUROAUTH_AGGREGATOR !== 'undefined')              return NEUROAUTH_AGGREGATOR;
    try { return require('./neuroauth_monthly_billing_aggregator'); } catch(e) {}
    return null;
  }

  async function _fetchUserInvoices(userId) {
    var aggregator = _resolveAggregator();
    if (!aggregator) return [];
    try {
      var currentPeriod = new Date().toISOString().slice(0, 7);
      var invoices = await aggregator.InvoiceStorage.listInvoicesByUser(userId, {});
      return invoices || [];
    } catch (err) {
      Logger.warn('access_policy.invoice_fetch_failed', { user_id: userId, error: err.message });
      return [];
    }
  }

  /* =========================================================================
   * COURTESY GUIDE TRACKER
   * Rastreia guias de cortesia usadas durante o grace period
   * ========================================================================= */
  var _courtesyUsed = {}; // userId → count (in-memory, pode ser persistido)

  function _getCourtesyUsed(userId) {
    return _courtesyUsed[userId] || 0;
  }

  function _incrementCourtesy(userId) {
    _courtesyUsed[userId] = (_courtesyUsed[userId] || 0) + 1;
    return _courtesyUsed[userId];
  }

  function _resetCourtesy(userId) {
    _courtesyUsed[userId] = 0;
  }

  /* =========================================================================
   * CORE: EVALUATE ACCESS
   * ========================================================================= */
  async function evaluate(userId, opts) {
    opts = opts || {};
    var cid = opts.correlation_id || _generateCid();
    var now = _nowIso();

    Logger.info('access_policy.evaluated', { user_id: userId, correlation_id: cid });

    // F1 — Verificar manual override primeiro
    var override = await PolicyStorage.getOverride(userId);
    if (override && !override.expired) {
      // Verificar se o override expirou
      if (override.expires_at && override.expires_at < now) {
        await PolicyStorage.deleteOverride(userId);
        Logger.info('access_policy.override.expired', { user_id: userId, correlation_id: cid });
      } else {
        var overrideState = ACCESS_STATES[override.state] || ACCESS_STATES.active;
        var overrideDecision = _buildDecision(override.state, overrideState, {
          reason_code:    'manual_override',
          message_user:   override.message || 'Acesso controlado manualmente.',
          invoice_id:     null,
          invoice_status: 'manual_override',
          due_date:       null,
          days_overdue:   0,
          days_until_due: null,
          days_until_restricted: null,
          courtesy_guides_remaining: DELINQUENCY_POLICY.courtesy_guides_during_grace,
          correlation_id: cid,
          override_by:    override.by || 'admin',
          evaluated_at:   now
        });
        await PolicyStorage.saveEvaluation(userId, overrideDecision);
        Logger.info('access_policy.override.applied', {
          user_id: userId, access_state: override.state, correlation_id: cid
        });
        return overrideDecision;
      }
    }

    // F2 — Dados de invoice (injetados ou reais)
    var invoiceStatus = opts.invoice_status;
    var daysOverdue   = opts.days_overdue;
    var daysUntilDue  = opts.days_until_due;
    var invoiceId     = opts.invoice_id || null;
    var dueDate       = opts.due_date   || null;

    // Se não injetado, buscar do agregador
    if (invoiceStatus === undefined) {
      var invoices = await _fetchUserInvoices(userId);
      // Pegar a invoice mais recente/relevante
      var latestInvoice = invoices
        .filter(function(inv) { return inv.status !== 'paid'; })
        .sort(function(a, b) { return (b.period || '').localeCompare(a.period || ''); })[0];

      if (!latestInvoice) {
        // Sem invoice pendente → ativo
        var paidInvoice = invoices[0] || null;
        invoiceStatus = paidInvoice ? 'paid' : 'none';
        daysOverdue   = 0;
        daysUntilDue  = null;
        invoiceId     = paidInvoice && paidInvoice.invoice_id;
      } else {
        invoiceId  = latestInvoice.invoice_id;
        invoiceStatus = latestInvoice.status || 'open';
        dueDate    = latestInvoice.due_date  || null;

        if (dueDate) {
          var dueDays = _daysBetween(now, dueDate);
          daysOverdue   = dueDays < 0 ? Math.abs(dueDays) : 0;
          daysUntilDue  = dueDays >= 0 ? dueDays : 0;
        } else {
          daysOverdue  = 0;
          daysUntilDue = 10;
        }
      }
    }

    // F2.5 — Normalizar daysUntilDue quando invoice_status foi injetado sem
    // informação de vencimento (days_until_due omitido ou null).
    //
    // BUG C2-3: se caller passa { invoice_status:'open', days_overdue:0 } sem
    // days_until_due, as condições de estado verificam `daysUntilDue !== null`
    // mas undefined !== null é TRUE enquanto undefined > 3 é FALSE — todas as
    // branches ativas falham e o fluxo cai no else-blocked incorretamente.
    // O caminho auto-fetch já aplicava daysUntilDue=10 como default seguro;
    // agora o caminho injetado faz o mesmo para manter comportamento consistente.
    //
    // BUG C3-2: days_overdue=-1 (negativo, ex: calculado como "ainda faltam dias")
    // era truthy em JS e não era normalizado para 0 pelo ||0. Condição estendida
    // para <= 0: qualquer valor não-positivo = sem atraso real.
    if (daysOverdue === undefined || daysOverdue === null) daysOverdue = 0;
    if ((daysUntilDue === null || daysUntilDue === undefined) && daysOverdue <= 0) {
      daysUntilDue = 10; // default conservador: sem data, assume prazo futuro
    }

    // F3 — Determinar estado de acesso
    var state, reasonCode, messageUser;
    var courtesyRemaining = DELINQUENCY_POLICY.courtesy_guides_during_grace;
    var daysUntilRestricted = null;

    if (invoiceStatus === 'none' || invoiceStatus === 'paid' || invoiceStatus === 'trial') {
      // Trial ou pago ou sem invoice
      state       = 'active';
      reasonCode  = invoiceStatus === 'paid' ? 'invoice_paid' : 'no_invoice';
      messageUser = 'Sua conta está em dia.';

    } else if (daysOverdue <= 0 && daysUntilDue !== null && daysUntilDue > DELINQUENCY_POLICY.due_soon_days) {
      // Invoice aberta, vencimento ainda distante
      state       = 'active';
      reasonCode  = 'invoice_open';
      messageUser = 'Você tem uma fatura aberta.';

    } else if (daysOverdue <= 0 && daysUntilDue !== null && daysUntilDue <= DELINQUENCY_POLICY.due_soon_days) {
      // Vencimento próximo
      state       = 'warning';
      reasonCode  = 'invoice_due_soon';
      messageUser = 'Sua fatura vence em ' + daysUntilDue + ' dia' + (daysUntilDue !== 1 ? 's' : '') + '.';

    } else if (daysOverdue > 0 && daysOverdue <= DELINQUENCY_POLICY.grace_period_days) {
      // Em atraso, dentro do grace period
      state       = 'grace_period';
      reasonCode  = 'invoice_overdue';
      daysUntilRestricted = DELINQUENCY_POLICY.restricted_after_days - daysOverdue;
      var courtesyUsed = _getCourtesyUsed(userId);
      courtesyRemaining = Math.max(0, DELINQUENCY_POLICY.courtesy_guides_during_grace - courtesyUsed);
      messageUser = 'Sua fatura está em atraso há ' + daysOverdue + ' dia' + (daysOverdue !== 1 ? 's' : '') +
                    '. Você ainda tem ' + courtesyRemaining + ' guia' + (courtesyRemaining !== 1 ? 's' : '') +
                    ' de cortesia disponível' + (courtesyRemaining !== 1 ? 'is' : '') + '.';

    } else if (daysOverdue > DELINQUENCY_POLICY.grace_period_days && daysOverdue < DELINQUENCY_POLICY.blocked_after_days) {
      // Restrito — além do grace period, antes do bloqueio total
      state       = 'restricted';
      reasonCode  = 'invoice_overdue';
      messageUser = 'Seu acesso para novas guias está temporariamente limitado. ' +
                    'Guias já geradas e histórico estão disponíveis.';

    } else {
      // Bloqueado
      state       = 'blocked';
      reasonCode  = 'invoice_overdue';
      messageUser = 'Seu acesso para novas guias está suspenso por inadimplência. ' +
                    'Regularize para restabelecer o acesso imediatamente.';
    }

    // F4 — Aplicar política para estado 'restricted': respeitar configuração de bloqueio parcial
    var baseState = Object.assign({}, ACCESS_STATES[state]);
    if (state === 'restricted' && !DELINQUENCY_POLICY.block_all_when_restricted) {
      // Bloquear apenas premium, permitir standard
      baseState.allow_new_guides         = true;
      baseState.allow_new_premium_guides = false;
      baseState.allow_render             = true;
    }

    // F5 — Construir decisão
    var decision = _buildDecision(state, baseState, {
      reason_code:             reasonCode,
      message_user:            messageUser,
      invoice_id:              invoiceId,
      invoice_status:          invoiceStatus,
      due_date:                dueDate,
      due_date_formatted:      _formatPtDate(dueDate),
      days_overdue:            daysOverdue || 0,
      days_until_due:          daysUntilDue,
      days_until_restricted:   daysUntilRestricted,
      courtesy_guides_remaining: courtesyRemaining,
      correlation_id:          cid,
      evaluated_at:            now
    });

    // F6 — Persistir avaliação para auditoria
    await PolicyStorage.saveEvaluation(userId, decision);

    // F7 — Log por estado
    var logEvent = 'access_policy.evaluated';
    if (state === 'restricted') logEvent = 'access_policy.restricted';
    if (state === 'blocked')    logEvent = 'access_policy.blocked';

    Logger.info(logEvent, {
      user_id:      userId,
      access_state: state,
      reason_code:  reasonCode,
      invoice_id:   invoiceId,
      days_overdue: daysOverdue,
      correlation_id: cid
    });

    return decision;
  }

  function _buildDecision(state, stateBase, extra) {
    return Object.assign({}, stateBase, extra, {
      access_state: state,
      _schema_version: '1.0.0'
    });
  }

  /* =========================================================================
   * COURTESY GUIDE OPERATIONS
   * ========================================================================= */
  function useCourtesyGuide(userId) {
    var used  = _incrementCourtesy(userId);
    var remaining = Math.max(0, DELINQUENCY_POLICY.courtesy_guides_during_grace - used);
    Logger.info('access_policy.courtesy_guide_used', {
      user_id: userId, courtesy_used: used, courtesy_remaining: remaining
    });
    return { used: used, remaining: remaining };
  }

  function resetCourtesyGuides(userId) {
    _resetCourtesy(userId);
    Logger.info('access_policy.courtesy_guide_reset', { user_id: userId });
  }

  /* =========================================================================
   * MANUAL OVERRIDE
   * ========================================================================= */
  async function setOverride(userId, state, opts) {
    opts = opts || {};
    if (!ACCESS_STATES[state]) {
      throw new Error('Invalid access state: ' + state);
    }
    var override = {
      user_id:     userId,
      state:       state,
      message:     opts.message || null,
      by:          opts.by      || 'admin',
      reason:      opts.reason  || null,
      expires_at:  opts.expires_at || null,
      created_at:  new Date().toISOString()
    };
    await PolicyStorage.saveOverride(userId, override);
    Logger.info('access_policy.override.set', {
      user_id: userId, access_state: state, correlation_id: opts.correlation_id
    });
    return override;
  }

  async function clearOverride(userId) {
    await PolicyStorage.deleteOverride(userId);
    Logger.info('access_policy.override.cleared', { user_id: userId });
    return true;
  }

  async function getOverride(userId) {
    return PolicyStorage.getOverride(userId);
  }

  async function listOverrides() {
    return PolicyStorage.listOverrides();
  }

  /* =========================================================================
   * RESTORATION (pagamento confirmado)
   * ========================================================================= */
  async function restoreAccess(userId, opts) {
    opts = opts || {};
    // Limpar override se houver
    await PolicyStorage.deleteOverride(userId);
    // Resetar guias de cortesia
    _resetCourtesy(userId);
    Logger.info('access_policy.restored', {
      user_id:    userId,
      invoice_id: opts.invoice_id,
      by:         opts.by || 'payment_confirmation'
    });
    return evaluate(userId, { invoice_status: 'paid', days_overdue: 0, invoice_id: opts.invoice_id });
  }

  /* =========================================================================
   * CONFIGURE
   * ========================================================================= */
  function configure(opts) {
    opts = opts || {};

    if (opts.aggregator) {
      _aggregatorRef = opts.aggregator;
    }

    if (opts.storage) {
      PolicyStorage.configure(opts.storage);
    }

    if (opts.policy) {
      Object.assign(DELINQUENCY_POLICY, opts.policy);
    }

    Logger.info('access_policy.configured');
  }

  /* =========================================================================
   * QUICK EVALUATE (sincrono, para uso sem await em contextos simples)
   * Usa opts injetados — não acessa storage
   * ========================================================================= */
  function evaluateSync(opts) {
    opts = opts || {};

    var userId        = opts.user_id        || null;
    var invoiceStatus = opts.invoice_status || 'none';
    var daysOverdue   = opts.days_overdue   || 0;
    var daysUntilDue  = opts.days_until_due !== undefined ? opts.days_until_due : null;

    // BUG C2-2: daysUntilDue=null/undefined com daysOverdue=0 causava todas as
    // condições de estado baseadas em daysUntilDue falharem (undefined>3 = false,
    // undefined<=3 = false), fazendo o fluxo cair no else-blocked incorretamente.
    // BUG C3-2: days_overdue=-1 (negativo) é truthy em JS, não era tratado como
    // "sem atraso" pelo ||0 nem pela condição === 0 acima. O mesmo resultado:
    // bypass da normalização → else → blocked para invoice sem atraso real.
    // Condição estendida para <= 0: qualquer valor não-positivo = sem atraso.
    if ((daysUntilDue === null || daysUntilDue === undefined) && daysOverdue <= 0) {
      daysUntilDue = 10; // default conservador: sem data, assume prazo futuro
    }

    // ── Courtesy remaining (reads from in-memory _courtesyUsed) ──────────
    var courtesyUsedCount = userId ? (_courtesyUsed[userId] || 0) : 0;
    var courtesyRemaining = Math.max(0,
      DELINQUENCY_POLICY.courtesy_guides_during_grace - courtesyUsedCount
    );

    // ── Synchronous override check (in-memory adapter only) ──────────────
    if (userId && PolicyStorage._adapter && PolicyStorage._adapter._overrides) {
      var override = PolicyStorage._adapter._overrides[userId];
      if (override && (!override.expires_at || new Date(override.expires_at) > new Date())) {
        var ovStateObj = Object.assign({}, ACCESS_STATES[override.state]);
        // Grace period courtesy logic also applies to overrides
        if (override.state === 'grace_period') {
          ovStateObj.allow_new_guides = courtesyRemaining > 0;
        }
        return Object.assign({}, ovStateObj, {
          access_state:            override.state,
          reason_code:             'manual_override',
          override_reason:         override.reason,
          message_user:            override.message || 'Acesso controlado manualmente.',
          invoice_status:          invoiceStatus,
          days_overdue:            daysOverdue,
          days_until_due:          daysUntilDue,
          courtesy_guides_remaining: courtesyRemaining,
          evaluated_at:            new Date().toISOString(),
          _schema_version:         '1.0.0'
        });
      }
    }

    var state, reasonCode, messageUser;

    if (invoiceStatus === 'none' || invoiceStatus === 'paid' || invoiceStatus === 'trial') {
      state = 'active'; reasonCode = 'no_invoice'; messageUser = 'Sua conta está em dia.';
    } else if (daysOverdue <= 0 && daysUntilDue !== null && daysUntilDue > DELINQUENCY_POLICY.due_soon_days) {
      state = 'active'; reasonCode = 'invoice_open'; messageUser = 'Você tem uma fatura aberta.';
    } else if (daysOverdue <= 0 && daysUntilDue !== null && daysUntilDue <= DELINQUENCY_POLICY.due_soon_days) {
      state = 'warning'; reasonCode = 'invoice_due_soon';
      messageUser = 'Sua fatura vence em ' + daysUntilDue + ' dia' + (daysUntilDue !== 1 ? 's' : '') + '.';
    } else if (daysOverdue > 0 && daysOverdue <= DELINQUENCY_POLICY.grace_period_days) {
      state = 'grace_period'; reasonCode = 'invoice_overdue';
      messageUser = 'Fatura em atraso. Acesso com cortesia disponível.';
    } else if (daysOverdue > DELINQUENCY_POLICY.grace_period_days && daysOverdue < DELINQUENCY_POLICY.blocked_after_days) {
      state = 'restricted'; reasonCode = 'invoice_overdue';
      messageUser = 'Acesso para novas guias temporariamente limitado.';
    } else {
      state = 'blocked'; reasonCode = 'invoice_overdue';
      messageUser = 'Acesso suspenso por inadimplência.';
    }

    var baseState = Object.assign({}, ACCESS_STATES[state]);

    // Grace period: allow_new_guides only if courtesy guides remain
    if (state === 'grace_period') {
      baseState.allow_new_guides        = courtesyRemaining > 0;
      baseState.allow_new_premium_guides = DELINQUENCY_POLICY.block_premium_when_restricted
        ? false : courtesyRemaining > 0;
    }

    return Object.assign({}, baseState, {
      reason_code:             reasonCode,
      message_user:            messageUser,
      invoice_status:          invoiceStatus,
      days_overdue:            daysOverdue,
      days_until_due:          daysUntilDue,
      courtesy_guides_remaining: courtesyRemaining,
      evaluated_at:            new Date().toISOString(),
      _schema_version:         '1.0.0'
    });
  }

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */
  return {
    VERSION:           VERSION,
    DELINQUENCY_POLICY: DELINQUENCY_POLICY,
    ACCESS_STATES:     ACCESS_STATES,

    // Config
    configure:         configure,

    // Core evaluation
    evaluate:          evaluate,
    evaluateSync:      evaluateSync,

    // Courtesy
    useCourtesyGuide:  useCourtesyGuide,
    resetCourtesyGuides: resetCourtesyGuides,

    // Override (admin)
    setOverride:       setOverride,
    clearOverride:     clearOverride,
    getOverride:       getOverride,
    listOverrides:     listOverrides,

    // Restoration
    restoreAccess:     restoreAccess,

    // Storage adapters
    MemoryAccessPolicyStorage:        MemoryAccessPolicyStorage,
    APIAccessPolicyStorage:           APIAccessPolicyStorage,
    GoogleSheetsAccessPolicyStorage:  GoogleSheetsAccessPolicyStorage,
    PolicyStorage:                    PolicyStorage
  };

}));
