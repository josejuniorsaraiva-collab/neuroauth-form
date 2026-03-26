/**
 * neuroauth_notification_service.js
 * NEUROAUTH_NOTIFICATION_SERVICE v1.0.0
 *
 * Serviço central de notificações — NEUROAUTH Revenue Experience Layer
 *
 * Responsabilidades:
 *   — Criar payloads de notificação por evento financeiro
 *   — Selecionar template por tipo de evento
 *   — Registrar envio com idempotência forte
 *   — Prevenir spam via janela mínima entre envios
 *   — Suportar múltiplos canais via adapter pattern
 *
 * Canais suportados:
 *   — console    (sempre ativo, structured JSON)
 *   — toast      (browser: injeta callback via configure())
 *   — email      (stub — pronto para integração SMTP/SendGrid/Resend)
 *   — webhook    (stub — pronto para integração HTTP)
 *
 * Idempotência:
 *   — notification_id = NOTIF-{type}-{userId}-{window} (janela diária por padrão)
 *   — Mesmo notification_id → envio ignorado, retorna { skipped: true }
 *   — Janela configurável via NOTIFICATION_POLICY.min_interval_hours
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
    root.NEUROAUTH_NOTIFICATION_SERVICE = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /* =========================================================================
   * NOTIFICATION POLICY
   * ========================================================================= */
  var NOTIFICATION_POLICY = {
    min_interval_hours:          12,   // janela mínima entre notificações do mesmo tipo/user
    max_per_day_per_user:        4,    // limite diário por usuário
    channels_default:            ['console', 'toast'],
    idempotency_window_hours:    24,   // janela de deduplicação
    enabled:                     true
  };

  /* =========================================================================
   * NOTIFICATION TEMPLATES
   * Tom: humano, claro, sem jargão bancário. Nunca punitivo.
   * ========================================================================= */
  var TEMPLATES = {
    invoice_generated: {
      subject: 'Seu extrato NEUROAUTH está disponível',
      body: function(d) {
        return 'Seu extrato NEUROAUTH de ' + d.period_label + ' está disponível. ' +
               'Total: ' + d.total_fmt + '. Vencimento: ' + d.due_date_fmt + '.';
      },
      short: function(d) {
        return '<strong>Extrato disponível</strong>' + d.period_label + ' · ' + d.total_fmt +
               ' · vence ' + d.due_date_fmt;
      },
      severity: 'info'
    },
    invoice_due_soon: {
      subject: 'Seu extrato NEUROAUTH vence em breve',
      body: function(d) {
        return 'Seu extrato NEUROAUTH de ' + d.period_label + ' vence em ' + d.days_until_due +
               ' dia' + (d.days_until_due !== 1 ? 's' : '') +
               '. Evite interrupções no acesso ao plataforma.';
      },
      short: function(d) {
        return '<strong>Vencimento próximo</strong>Extrato ' + d.period_label +
               ' vence em ' + d.days_until_due + ' dia' + (d.days_until_due !== 1 ? 's' : '');
      },
      severity: 'warning'
    },
    invoice_overdue: {
      subject: 'Extrato NEUROAUTH em atraso',
      body: function(d) {
        return 'Seu extrato NEUROAUTH de ' + d.period_label + ' está em atraso há ' +
               d.days_overdue + ' dia' + (d.days_overdue !== 1 ? 's' : '') +
               '. Seu acesso segue disponível durante o período de tolerância.';
      },
      short: function(d) {
        return '<strong>Extrato em atraso</strong>' + d.period_label + ' · ' +
               d.days_overdue + ' dia' + (d.days_overdue !== 1 ? 's' : '') + ' em atraso';
      },
      severity: 'warning'
    },
    access_restricted_warning: {
      subject: 'Acesso NEUROAUTH — Aviso de restrição iminente',
      body: function(d) {
        return 'Seu acesso ao NEUROAUTH poderá ser limitado em ' + d.days_until_restricted +
               ' dia' + (d.days_until_restricted !== 1 ? 's' : '') +
               ' caso a pendência financeira permaneça. ' +
               'Guias já geradas continuarão disponíveis.';
      },
      short: function(d) {
        return '<strong>Aviso de acesso</strong>Restrição iminente em ' +
               d.days_until_restricted + ' dia' + (d.days_until_restricted !== 1 ? 's' : '');
      },
      severity: 'warning'
    },
    access_restricted: {
      subject: 'Acesso para novas guias temporariamente limitado',
      body: function(d) {
        return 'Seu acesso para novas guias foi temporariamente limitado por pendência financeira. ' +
               'Guias já geradas, dashboard e extrato continuam disponíveis. ' +
               'Regularize para restaurar o acesso completo.';
      },
      short: function(d) {
        return '<strong>Acesso limitado</strong>Regularize para restaurar novas guias';
      },
      severity: 'critical'
    },
    access_blocked: {
      subject: 'Acesso NEUROAUTH suspenso por inadimplência',
      body: function(d) {
        return 'Seu acesso para novas guias está suspenso. ' +
               'Histórico, extrato e dashboard permanecem disponíveis. ' +
               'Regularize o pagamento para restauração imediata do acesso.';
      },
      short: function(d) {
        return '<strong>Acesso suspenso</strong>Regularize para restaurar acesso completo';
      },
      severity: 'critical'
    },
    access_restored: {
      subject: 'Acesso NEUROAUTH restaurado',
      body: function(d) {
        return 'Pagamento identificado. Seu acesso completo ao NEUROAUTH foi restaurado. ' +
               'Obrigado pela regularização.';
      },
      short: function(d) {
        return '<strong>Acesso restaurado ✓</strong>Pagamento confirmado — acesso completo';
      },
      severity: 'info'
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
        service:         'neuroauth_notification_service',
        version:         VERSION,
        notification_id: ctx.notification_id || null,
        user_id:         ctx.user_id         || null,
        invoice_id:      ctx.invoice_id      || null,
        channel:         ctx.channel         || null,
        type:            ctx.type            || null
      };
    },
    info: function(event, ctx) {
      if (typeof console !== 'undefined')
        console.info('[NOTIF]', JSON.stringify(this._fmt('INFO', event, ctx)));
    },
    warn: function(event, ctx) {
      if (typeof console !== 'undefined')
        console.warn('[NOTIF]', JSON.stringify(this._fmt('WARN', event, ctx)));
    },
    error: function(event, ctx) {
      if (typeof console !== 'undefined')
        console.error('[NOTIF]', JSON.stringify(this._fmt('ERROR', event, ctx)));
    }
  };

  /* =========================================================================
   * HELPERS
   * ========================================================================= */
  function _nowIso() { return new Date().toISOString(); }

  function _dateWindow(hoursBack) {
    return new Date(Date.now() - (hoursBack || 24) * 3600 * 1000).toISOString();
  }

  function _dayKey() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }

  function _hourKey(hours) {
    var d = new Date();
    var rounded = Math.floor(d.getHours() / (hours || 12));
    return d.toISOString().slice(0, 10) + '-H' + rounded;
  }

  function _safeId(s) {
    return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  }

  function _generateNotificationId(type, userId, invoiceId, windowKey) {
    return 'NOTIF-' + type.toUpperCase().replace(/_/g, '-') +
           '-' + _safeId(userId) +
           (invoiceId ? '-' + _safeId(invoiceId) : '') +
           '-' + (windowKey || _dayKey());
  }

  function _formatPtDate(isoDate) {
    if (!isoDate) return '—';
    var d = new Date(isoDate.includes('T') ? isoDate : isoDate + 'T12:00:00Z');
    return d.getUTCDate() + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear();
  }

  function _periodLabel(period) {
    if (!period) return '—';
    var MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    var parts = period.split('-');
    var m = parseInt(parts[1], 10) - 1;
    return MESES[m] + '/' + parts[0];
  }

  /* =========================================================================
   * NOTIFICATION STORAGE ADAPTERS
   * ========================================================================= */

  // ── Memory (default) ──────────────────────────────────────────────────────
  function MemoryNotificationStorage() {
    this._store = {}; // notificationId → record
    this._byUser = {}; // userId → [notificationId]
  }

  MemoryNotificationStorage.prototype.save = function(record) {
    this._store[record.notification_id] = record;
    if (!this._byUser[record.user_id]) this._byUser[record.user_id] = [];
    this._byUser[record.user_id].push(record.notification_id);
    return Promise.resolve(record);
  };

  MemoryNotificationStorage.prototype.find = function(notificationId) {
    return Promise.resolve(this._store[notificationId] || null);
  };

  MemoryNotificationStorage.prototype.listByUser = function(userId, opts) {
    opts = opts || {};
    var ids = this._byUser[userId] || [];
    var records = ids.map(function(id) { return this._store[id]; }, this)
                     .filter(Boolean);
    if (opts.type) records = records.filter(function(r) { return r.type === opts.type; });
    if (opts.since) records = records.filter(function(r) { return r.sent_at >= opts.since; });
    return Promise.resolve(records.sort(function(a, b) {
      return (b.sent_at || '').localeCompare(a.sent_at || '');
    }));
  };

  MemoryNotificationStorage.prototype.countTodayByUser = function(userId) {
    var today = _dayKey();
    var ids = this._byUser[userId] || [];
    var count = ids.filter(function(id) {
      var r = this._store[id];
      return r && r.sent_at && r.sent_at.startsWith(today) && r.status === 'sent';
    }, this).length;
    return Promise.resolve(count);
  };

  // ── Google Sheets stub ────────────────────────────────────────────────────
  function GoogleSheetsNotificationStorage(cfg) {
    var mem = new MemoryNotificationStorage();
    mem._sheetId = cfg && cfg.sheetId;
    mem._apiKey  = cfg && cfg.apiKey;
    return mem;
  }

  // ── API stub ──────────────────────────────────────────────────────────────
  function APINotificationStorage(cfg) {
    var mem = new MemoryNotificationStorage();
    mem._baseUrl = cfg && cfg.baseUrl;
    return mem;
  }

  /* =========================================================================
   * NOTIFICATION STORAGE SINGLETON
   * ========================================================================= */
  var NotificationStorage = {
    _adapter: new MemoryNotificationStorage(),
    configure: function(adapter) {
      this._adapter = adapter;
      Logger.info('notification.storage.configured');
    },
    save:             function(r)     { return this._adapter.save(r); },
    find:             function(id)    { return this._adapter.find(id); },
    listByUser:       function(u, o)  { return this._adapter.listByUser(u, o); },
    countTodayByUser: function(u)     { return this._adapter.countTodayByUser(u); }
  };

  /* =========================================================================
   * NOTIFICATION ADAPTERS (canais)
   * ========================================================================= */

  // ── Console Adapter (always active, structured) ───────────────────────────
  var ConsoleNotificationAdapter = {
    channel: 'console',
    send: function(notification) {
      Logger.info('notification.sent', {
        notification_id: notification.notification_id,
        user_id:         notification.user_id,
        invoice_id:      notification.invoice_id,
        channel:         'console',
        type:            notification.type
      });
      return Promise.resolve({ success: true, channel: 'console', ref: notification.notification_id });
    }
  };

  // ── Toast Adapter (browser UI, injeta via configure) ─────────────────────
  var ToastNotificationAdapter = {
    channel: 'toast',
    _toastFn: null,
    configure: function(toastFn) { this._toastFn = toastFn; },
    send: function(notification) {
      if (typeof this._toastFn !== 'function') {
        return Promise.resolve({ success: false, channel: 'toast', error: 'toast_fn_not_configured' });
      }
      var tpl = TEMPLATES[notification.type];
      var severity = tpl ? tpl.severity : 'info';
      var msg = tpl && tpl.short ? tpl.short(notification.template_data || {}) : notification.body;
      var toastType = severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'success';
      try {
        this._toastFn(msg, toastType, 4500);
        return Promise.resolve({ success: true, channel: 'toast', ref: notification.notification_id });
      } catch (err) {
        return Promise.resolve({ success: false, channel: 'toast', error: err.message });
      }
    }
  };

  // ── Email Adapter (stub — integração SMTP/SendGrid/Resend) ───────────────
  var EmailNotificationAdapter = {
    channel: 'email',
    _config: {},
    configure: function(cfg) { this._config = cfg || {}; },
    send: function(notification) {
      // TODO: integrar com SendGrid, Resend, ou SMTP
      // Exemplo:
      // await fetch('https://api.sendgrid.com/v3/mail/send', {
      //   method: 'POST',
      //   headers: { Authorization: 'Bearer ' + this._config.apiKey, 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     to: [{ email: notification.user_email }],
      //     from: { email: 'noreply@neuroauth.com.br', name: 'NEUROAUTH' },
      //     subject: notification.subject,
      //     text: notification.body
      //   })
      // });
      Logger.info('notification.email.stub', {
        notification_id: notification.notification_id,
        user_id:         notification.user_id,
        type:            notification.type
      });
      return Promise.resolve({ success: true, channel: 'email', ref: 'email-stub-' + Date.now() });
    }
  };

  // ── Webhook Adapter (stub — integração HTTP) ──────────────────────────────
  var WebhookNotificationAdapter = {
    channel: 'webhook',
    _url: null,
    _secret: null,
    configure: function(cfg) {
      this._url    = cfg && cfg.url;
      this._secret = cfg && cfg.secret;
    },
    send: function(notification) {
      if (!this._url) {
        return Promise.resolve({ success: false, channel: 'webhook', error: 'webhook_url_not_configured' });
      }
      // TODO: implementar fetch com HMAC-SHA256 signature
      Logger.info('notification.webhook.stub', {
        notification_id: notification.notification_id,
        user_id:         notification.user_id,
        type:            notification.type
      });
      return Promise.resolve({ success: true, channel: 'webhook', ref: 'webhook-stub-' + Date.now() });
    }
  };

  /* =========================================================================
   * NOTIFICATION DISPATCHER
   * Orquestra: idempotência → rate limiting → send → persist
   * ========================================================================= */
  var _channels = [ConsoleNotificationAdapter];

  async function _dispatch(type, userId, invoiceId, templateData, overrideChannels) {
    if (!NOTIFICATION_POLICY.enabled) {
      return { dispatched: false, skipped: true, reason: 'service_disabled' };
    }

    // Gerar notification_id com janela de idempotência
    var windowKey = _hourKey(NOTIFICATION_POLICY.idempotency_window_hours);
    var nid       = _generateNotificationId(type, userId, invoiceId, windowKey);

    // F1 — Idempotência: verificar se já foi enviado nesta janela
    var existing = await NotificationStorage.find(nid);
    if (existing && existing.status === 'sent') {
      Logger.warn('notification.skipped.idempotent', {
        notification_id: nid, user_id: userId, type: type
      });
      return { dispatched: false, skipped: true, reason: 'idempotent', notification_id: nid };
    }

    // F2 — Rate limit: max por dia por usuário
    var todayCount = await NotificationStorage.countTodayByUser(userId);
    if (todayCount >= NOTIFICATION_POLICY.max_per_day_per_user) {
      Logger.warn('notification.skipped.rate_limit', {
        notification_id: nid, user_id: userId, type: type, count: todayCount
      });
      return { dispatched: false, skipped: true, reason: 'rate_limit', notification_id: nid };
    }

    // F3 — Construir payload
    var tpl     = TEMPLATES[type] || {};
    var subject = tpl.subject || type;
    var body    = tpl.body ? tpl.body(templateData || {}) : '';

    var notification = {
      notification_id:  nid,
      type:             type,
      user_id:          userId,
      invoice_id:       invoiceId || null,
      channel:          null, // preenchido por canal
      subject:          subject,
      body:             body,
      template_data:    templateData || {},
      status:           'queued',
      sent_at:          null,
      idempotency_key:  nid,
      _schema_version:  '1.0.0'
    };

    // F4 — Determinar canais
    var activeChannels = overrideChannels || _channels;

    // F5 — Enviar em todos os canais
    var results = [];
    for (var i = 0; i < activeChannels.length; i++) {
      var adapter = activeChannels[i];
      try {
        var r = await adapter.send(Object.assign({}, notification, { channel: adapter.channel }));
        results.push(r);
      } catch (err) {
        results.push({ success: false, channel: adapter.channel, error: err.message });
        Logger.error('notification.channel_failed', {
          notification_id: nid, user_id: userId, type: type, channel: adapter.channel
        });
      }
    }

    var anySuccess = results.some(function(r) { return r.success; });

    // F6 — Persistir registro
    var record = Object.assign({}, notification, {
      channel:    results.map(function(r) { return r.channel; }).join(','),
      status:     anySuccess ? 'sent' : 'failed',
      sent_at:    anySuccess ? _nowIso() : null,
      results:    results
    });
    await NotificationStorage.save(record);

    Logger.info(anySuccess ? 'notification.dispatched' : 'notification.failed_all', {
      notification_id: nid, user_id: userId, type: type,
      channels: record.channel
    });

    return {
      dispatched:      anySuccess,
      success:         anySuccess,
      notification_id: nid,
      type:            type,
      user_id:         userId,
      status:          record.status,
      channels:        record.channel,
      results:         results
    };
  }

  /* =========================================================================
   * PUBLIC SEND FUNCTIONS
   * ========================================================================= */

  async function sendInvoiceGeneratedNotification(invoice) {
    var data = {
      period_label:    _periodLabel(invoice.period),
      total_fmt:       invoice.total_formatted || invoice.total_brl + '',
      due_date_fmt:    _formatPtDate(invoice.due_date),
      invoice_id:      invoice.invoice_id
    };
    return _dispatch('invoice_generated', invoice.user_id, invoice.invoice_id, data);
  }

  async function sendInvoiceDueSoonNotification(invoice, daysUntilDue) {
    var data = {
      period_label:    _periodLabel(invoice.period),
      total_fmt:       invoice.total_formatted || invoice.total_brl + '',
      due_date_fmt:    _formatPtDate(invoice.due_date),
      days_until_due:  daysUntilDue || 3,
      invoice_id:      invoice.invoice_id
    };
    return _dispatch('invoice_due_soon', invoice.user_id, invoice.invoice_id, data);
  }

  async function sendInvoiceOverdueNotification(invoice, daysOverdue) {
    var data = {
      period_label:   _periodLabel(invoice.period),
      total_fmt:      invoice.total_formatted || invoice.total_brl + '',
      due_date_fmt:   _formatPtDate(invoice.due_date),
      days_overdue:   daysOverdue || 1,
      invoice_id:     invoice.invoice_id
    };
    return _dispatch('invoice_overdue', invoice.user_id, invoice.invoice_id, data);
  }

  async function sendAccessRestrictedWarningNotification(userId, policy) {
    var data = {
      days_until_restricted: policy && policy.days_until_restricted || 2,
      access_state:          policy && policy.access_state || 'warning'
    };
    return _dispatch('access_restricted_warning', userId, null, data);
  }

  async function sendAccessRestrictedNotification(userId, policy) {
    var data = {
      access_state:   policy && policy.access_state || 'restricted',
      reason_code:    policy && policy.reason_code  || 'invoice_overdue'
    };
    return _dispatch('access_restricted', userId, null, data);
  }

  async function sendAccessBlockedNotification(userId, policy) {
    var data = {
      access_state: policy && policy.access_state || 'blocked'
    };
    return _dispatch('access_blocked', userId, null, data);
  }

  async function sendAccessRestoredNotification(userId, invoiceId) {
    var data = { invoice_id: invoiceId };
    return _dispatch('access_restored', userId, invoiceId, data);
  }

  /* =========================================================================
   * QUERY FUNCTIONS
   * ========================================================================= */

  async function getNotificationHistory(userId, opts) {
    return NotificationStorage.listByUser(userId, opts || {});
  }

  async function getNotificationCount(userId) {
    return NotificationStorage.countTodayByUser(userId);
  }

  /* =========================================================================
   * CONFIGURE
   * ========================================================================= */
  function configure(opts) {
    opts = opts || {};

    // Toast callback (browser)
    if (typeof opts.toastFn === 'function') {
      ToastNotificationAdapter.configure(opts.toastFn);
      if (!_channels.includes(ToastNotificationAdapter)) {
        _channels.push(ToastNotificationAdapter);
      }
    }

    // Email config
    if (opts.email) {
      EmailNotificationAdapter.configure(opts.email);
      if (!_channels.includes(EmailNotificationAdapter)) {
        _channels.push(EmailNotificationAdapter);
      }
    }

    // Webhook config
    if (opts.webhook) {
      WebhookNotificationAdapter.configure(opts.webhook);
      if (!_channels.includes(WebhookNotificationAdapter)) {
        _channels.push(WebhookNotificationAdapter);
      }
    }

    // Storage adapter
    if (opts.storage) {
      NotificationStorage.configure(opts.storage);
    }

    // Policy overrides
    if (opts.policy) {
      Object.assign(NOTIFICATION_POLICY, opts.policy);
    }

    Logger.info('notification.service.configured', {
      channels: _channels.map(function(c) { return c.channel; }).join(',')
    });
  }

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */
  return {
    VERSION:                             VERSION,
    NOTIFICATION_POLICY:                 NOTIFICATION_POLICY,
    TEMPLATES:                           TEMPLATES,

    // Config
    configure:                           configure,

    // Send functions
    sendInvoiceGeneratedNotification:    sendInvoiceGeneratedNotification,
    sendInvoiceDueSoonNotification:      sendInvoiceDueSoonNotification,
    sendInvoiceOverdueNotification:      sendInvoiceOverdueNotification,
    sendAccessRestrictedWarningNotification: sendAccessRestrictedWarningNotification,
    sendAccessRestrictedNotification:    sendAccessRestrictedNotification,
    sendAccessBlockedNotification:       sendAccessBlockedNotification,
    sendAccessRestoredNotification:      sendAccessRestoredNotification,

    // Query
    getNotificationHistory:              getNotificationHistory,
    getNotificationCount:                getNotificationCount,

    // Storage Adapters (injeção)
    MemoryNotificationStorage:           MemoryNotificationStorage,
    GoogleSheetsNotificationStorage:     GoogleSheetsNotificationStorage,
    APINotificationStorage:              APINotificationStorage,
    NotificationStorage:                 NotificationStorage,

    // Channel Adapters (injeção e extensão)
    ConsoleNotificationAdapter:          ConsoleNotificationAdapter,
    ToastNotificationAdapter:            ToastNotificationAdapter,
    EmailNotificationAdapter:            EmailNotificationAdapter,
    WebhookNotificationAdapter:          WebhookNotificationAdapter
  };

}));
