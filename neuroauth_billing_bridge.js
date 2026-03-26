/**
 * neuroauth_billing_bridge.js
 * NEUROAUTH_BILLING_BRIDGE v1.1.0 — Arquitetura de Confiança Transacional
 *
 * Princípio imutável:
 *   "A guia clínica nunca morre por falha de billing."
 *
 * Síntese completa:
 *   • Filosfia invisível — UX limpa (pill "Registrado", sem exposição de billing ao médico)
 *   • Ledger-first obrigatório antes de qualquer report externo
 *   • Outbox pattern com retry exponencial (3 tentativas, 2s × 2^n)
 *   • Idempotência determinística forte (guiaId + payload_sig + dia)
 *   • Reconciliação automática para eventos billing_pending > 15 min
 *   • Adapters pluggáveis: Memory (padrão) → Sheets → API própria
 *   • LGPD por padrão: iniciais + SHA-256 em todos os eventos
 *   • Observabilidade estruturada: correlation_id / billing_id / guia_id em todo log
 *   • Guia 100% protegida — renderResult.success é o gate, não o billing
 *
 * @version 1.1.0
 * @license Proprietary — NeuroAuth © 2026
 */

(function (root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.NEUROAUTH_BILLING_BRIDGE = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const VERSION = '1.1.0';

  /* =========================================================================
   * PRICE CATALOG — única fonte de verdade de preços
   * ========================================================================= */
  const PRICE_CATALOG = {
    v1: {
      guia_neuroauth_sadt: {
        sku: 'guia_neuroauth_sadt',
        description: 'Guia SADT NeuroAuth — geração assistida por IA',
        unit_amount: 5.00,
        currency: 'BRL',
        tier: 'standard'
      },
      guia_neuroauth_sadt_opme_premium: {
        sku: 'guia_neuroauth_sadt_opme_premium',
        description: 'Guia SADT OPME Premium NeuroAuth — >5 itens OPME',
        unit_amount: 7.50,
        currency: 'BRL',
        tier: 'premium'
      }
    }
  };

  /* =========================================================================
   * LOGGER ESTRUTURADO — pronto para Sentry / DataDog / CloudWatch
   * ========================================================================= */
  const Logger = {
    _format(level, event, ctx = {}) {
      return {
        ts: new Date().toISOString(),
        level,
        event,
        service: 'neuroauth_billing_bridge',
        version: VERSION,
        correlation_id: ctx.correlation_id || null,
        billing_id:     ctx.billing_id     || null,
        guia_id:        ctx.guia_id        || null,
        user_id:        ctx.user_id        || null,
        ...ctx
      };
    },
    info(event, ctx = {}) {
      if (typeof console !== 'undefined')
        console.info('[BILLING]', JSON.stringify(this._format('INFO', event, ctx)));
    },
    warn(event, ctx = {}) {
      if (typeof console !== 'undefined')
        console.warn('[BILLING]', JSON.stringify(this._format('WARN', event, ctx)));
    },
    error(event, ctx = {}) {
      if (typeof console !== 'undefined')
        console.error('[BILLING]', JSON.stringify(this._format('ERROR', event, ctx)));
    }
  };

  /* =========================================================================
   * HELPERS PUROS E TESTÁVEIS
   * ========================================================================= */

  /**
   * Extrai iniciais LGPD-safe: "José Moura Silva" → "J.M.S."
   */
  function getPacienteIniciais(nome) {
    if (!nome || typeof nome !== 'string') return 'N/A';
    return nome.trim().split(/\s+/).filter(Boolean).map(p => p[0]).join('.').toUpperCase() + '.';
  }

  /**
   * SHA-256 do paciente para LGPD compliance. Async.
   * Fallback robusto para ambientes sem crypto.subtle.
   */
  async function hashPatientIdentity(nome, cpfParcial = '') {
    const raw = `${(nome || '').toLowerCase().trim()}::${(cpfParcial || '').replace(/\D/g, '')}`;
    try {
      const cryptoObj = typeof crypto !== 'undefined'
        ? crypto
        : (typeof require !== 'undefined' ? require('crypto').webcrypto : null);
      const encoded = new TextEncoder().encode(raw);
      const hashBuf = await cryptoObj.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      // Fallback Node.js nativo
      try {
        const nodeCrypto = require('crypto');
        return nodeCrypto.createHash('sha256').update(raw).digest('hex');
      } catch (__) {
        // Last resort: djb2-style
        return raw.split('').reduce((a, c) => (Math.imul(31, a) + c.charCodeAt(0)) | 0, 0)
          .toString(16).padStart(8, '0').toUpperCase();
      }
    }
  }

  function formatProcedimentos(procs) {
    if (!Array.isArray(procs)) return [];
    return procs.map(p => ({
      tuss:     p.tuss_codigo || p.codigo || '',
      descricao: (p.descricao || '').substring(0, 80)
    }));
  }

  function formatOPME(items) {
    if (!Array.isArray(items)) return [];
    return items.map(o => ({
      anvisa: o.anvisa || o.registro_anvisa || '',
      item:   (o.item || o.descricao || '').substring(0, 60),
      qtd:    o.qtd || o.quantidade || 1
    }));
  }

  function normalizeMoney(amount) {
    const num = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(',', '.'));
    const centavos = Math.round(num * 100);
    return {
      amount_brl: num,
      centavos,
      formatted: `R$ ${num.toFixed(2).replace('.', ',')}`
    };
  }

  /**
   * Assinatura determinística do payload — apenas campos de negócio,
   * sem timestamps ou IDs gerados dinamicamente.
   * Retorna objeto estável para serialização.
   */
  function buildPayloadSignature(payload) {
    return {
      operadora:       payload.operadora_nome || payload.tiss_01_operadora_registro_ans || '',
      procedimento:    payload.tiss_41_procedimento_codigo || payload.procedimento_principal || '',
      cid:             payload.tiss_43_cid || '',
      paciente_iniciais: getPacienteIniciais(payload.paciente_nome || payload.tiss_10_nome_beneficiario || ''),
      opme_count:      Array.isArray(payload.opme_itens) ? payload.opme_itens.length : 0,
      opme_hash:       Array.isArray(payload.opme_itens)
        ? payload.opme_itens.map(o => `${o.anvisa || o.registro_anvisa}:${o.qtd || o.quantidade || 1}`).join('|')
        : ''
    };
  }

  /**
   * MurmurHash2-style — determinístico, sem Math.random.
   * Usado internamente para idempotency keys.
   */
  function _murmurHash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0').toUpperCase();
  }

  /**
   * Gera hex aleatório via crypto.getRandomValues (CSPRNG).
   * Fallback: Math.random() em ambientes sem Web Crypto.
   */
  function _randomHex(n) {
    try {
      const cryptoObj = typeof crypto !== 'undefined' ? crypto
        : (typeof require !== 'undefined' ? require('crypto').webcrypto : null);
      const buf = new Uint8Array(Math.ceil(n / 2));
      cryptoObj.getRandomValues(buf);
      return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, n).toUpperCase();
    } catch (_) {
      return Math.floor(Math.random() * Math.pow(16, n)).toString(16).padStart(n, '0').toUpperCase();
    }
  }

  /* =========================================================================
   * BILLING IDENTITY — IDs imutáveis e determinísticos
   * ========================================================================= */
  const BillingIdentity = {
    /**
     * NG-YYYYMMDD-HHMMSS-{12 hex CSPRNG}
     */
    generateGuiaId() {
      const d = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
      return `NG-${d.slice(0, 8)}-${d.slice(8, 14)}-${_randomHex(12)}`;
    },

    /**
     * BL-YYYYMMDD-HHMMSS-{12 hex CSPRNG}
     */
    generateBillingId() {
      const d = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
      return `BL-${d.slice(0, 8)}-${d.slice(8, 14)}-${_randomHex(12)}`;
    },

    /**
     * COR-{20 hex CSPRNG} — liga guia, billing e report na mesma trace
     */
    generateCorrelationId() {
      return `COR-${_randomHex(20)}`;
    },

    /**
     * Idempotency key determinística: mesmo guiaId + mesmo payload_sig + mesmo dia → mesmo key.
     * Garante exatamente uma entrada no ledger por tentativa de faturamento de guia.
     */
    generateIdempotencyKey(payload, guiaId) {
      const day = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
      const sig = JSON.stringify(buildPayloadSignature(payload));
      const raw = [payload.user_id || 'anon', guiaId, sig, day].join('::');
      return `IK-${_murmurHash(raw)}`;
    }
  };

  /* =========================================================================
   * ADAPTERS DE LEDGER
   * ========================================================================= */

  /**
   * MemoryLedgerAdapter — padrão em browser/dev/testes.
   * Deduplicação por idempotency_key em memória.
   */
  class MemoryLedgerAdapter {
    constructor() {
      this._store = new Map();
      this._seq = 0;
    }

    async write(event) {
      if (this._store.has(event.idempotency_key)) {
        Logger.info('billing.ledger.duplicate_ignored', {
          idempotency_key: event.idempotency_key,
          billing_id: event.billing_id
        });
        return { mode: 'duplicate_ignored', idempotency_key: event.idempotency_key };
      }
      this._store.set(event.idempotency_key, {
        ...event, _seq: ++this._seq, _stored_at: new Date().toISOString()
      });
      Logger.info('billing.ledger.inserted', { billing_id: event.billing_id, sku: event.sku });
      return { mode: 'inserted', idempotency_key: event.idempotency_key };
    }

    async find(key) { return this._store.get(key) || null; }

    async list({ status, from_date, to_date } = {}) {
      let entries = Array.from(this._store.values());
      if (status)    entries = entries.filter(e => e.status === status);
      if (from_date) entries = entries.filter(e => e.generated_at >= from_date);
      if (to_date)   entries = entries.filter(e => e.generated_at <= to_date);
      return entries;
    }

    async updateStatus(key, newStatus, extra = {}) {
      const entry = this._store.get(key);
      if (!entry) return false;
      Object.assign(entry, { status: newStatus, _updated_at: new Date().toISOString(), ...extra });
      return true;
    }

    async count() { return this._store.size; }
  }

  /**
   * GoogleSheetsLedgerAdapter — skeleton para Make/Zapier/Apps Script.
   */
  class GoogleSheetsLedgerAdapter {
    constructor({ sheetsUrl, sheetName = 'BillingLedger' } = {}) {
      this.sheetsUrl = sheetsUrl;
      this.sheetName = sheetName;
      this._fallback = new MemoryLedgerAdapter();
    }

    async write(event) {
      if (!this.sheetsUrl) {
        Logger.warn('billing.ledger.sheets.no_url', { fallback: 'memory' });
        return this._fallback.write(event);
      }
      try {
        // TODO: Implementar fetch para Google Apps Script Web App endpoint
        // const res = await fetch(this.sheetsUrl, {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify({ action: 'append', sheet: this.sheetName, row: event })
        // });
        // const data = await res.json();
        // return { mode: data.duplicate ? 'duplicate_ignored' : 'inserted' };
        Logger.warn('billing.ledger.sheets.not_implemented_yet', { billing_id: event.billing_id });
        return this._fallback.write(event);
      } catch (err) {
        Logger.error('billing.ledger.sheets.write_failed', { error: err.message });
        return { mode: 'failed', error: err.message };
      }
    }

    async find(key) { return this._fallback.find(key); }
    async list(opts) { return this._fallback.list(opts); }
    async updateStatus(key, status, extra) { return this._fallback.updateStatus(key, status, extra); }
    async count() { return this._fallback.count(); }
  }

  /**
   * APILedgerAdapter — skeleton para REST API própria ou parceiro.
   */
  class APILedgerAdapter {
    constructor({ baseUrl, apiKey, timeout = 5000 } = {}) {
      this.baseUrl = baseUrl;
      this.apiKey  = apiKey;
      this.timeout = timeout;
      this._fallback = new MemoryLedgerAdapter();
    }

    async write(event) {
      if (!this.baseUrl) {
        Logger.warn('billing.ledger.api.no_url', { fallback: 'memory' });
        return this._fallback.write(event);
      }
      try {
        // TODO: Implementar
        // const res = await fetch(`${this.baseUrl}/billing/events`, {
        //   method: 'POST',
        //   headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        //   body: JSON.stringify(event)
        // });
        // if (res.status === 409) return { mode: 'duplicate_ignored' };
        // if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // return { mode: 'inserted', ...(await res.json()) };
        Logger.warn('billing.ledger.api.not_implemented_yet', { billing_id: event.billing_id });
        return this._fallback.write(event);
      } catch (err) {
        Logger.error('billing.ledger.api.write_failed', { error: err.message });
        return { mode: 'failed', error: err.message };
      }
    }

    async find(key) { return this._fallback.find(key); }
    async list(opts) { return this._fallback.list(opts); }
    async updateStatus(key, status, extra) { return this._fallback.updateStatus(key, status, extra); }
    async count() { return this._fallback.count(); }
  }

  /**
   * BillingLedger — fachada pública com strategy pattern.
   * Ledger-first: sempre grava antes de qualquer report externo.
   */
  const BillingLedger = {
    _adapter: new MemoryLedgerAdapter(),

    configure(adapter) {
      this._adapter = adapter;
      Logger.info('billing.ledger.configured', { adapter: adapter.constructor.name });
    },

    async write(event)                   { return this._adapter.write(event); },
    async find(key)                      { return this._adapter.find(key); },
    async list(opts)                     { return this._adapter.list(opts); },
    async updateStatus(key, status, extra){ return this._adapter.updateStatus(key, status, extra); },
    async count()                        { return this._adapter.count(); }
  };

  /* =========================================================================
   * BILLING OUTBOX — retry assíncrono com backoff exponencial
   * ========================================================================= */
  const BillingOutbox = {
    _queue:       [],
    _processing:  false,
    _maxRetries:  3,
    _retryDelayMs: 2000,

    push(event) {
      this._queue.push({
        event,
        attempts:       0,
        pushed_at:      new Date().toISOString(),
        next_attempt_at: Date.now()
      });
      Logger.info('billing.outbox.pushed', {
        billing_id: event.billing_id,
        queue_size: this._queue.length
      });
    },

    async processQueue() {
      if (this._processing || this._queue.length === 0) return;
      this._processing = true;
      const now = Date.now();
      const ready = this._queue.filter(item =>
        item.next_attempt_at <= now && item.attempts < this._maxRetries
      );

      for (const item of ready) {
        item.attempts++;
        try {
          const result = await BillingReporter.report(item.event);
          if (result.success) {
            await BillingLedger.updateStatus(item.event.idempotency_key, 'billing_reported', {
              reporter_ref: result.reporter_ref,
              reported_at:  new Date().toISOString()
            });
            this._queue = this._queue.filter(q => q !== item);
            Logger.info('billing.outbox.processed', {
              billing_id: item.event.billing_id,
              attempts:   item.attempts
            });
          } else {
            throw new Error(result.error || 'reporter_failure');
          }
        } catch (err) {
          const delay = this._retryDelayMs * Math.pow(2, item.attempts - 1);
          item.next_attempt_at = Date.now() + delay;
          Logger.warn('billing.outbox.retry_scheduled', {
            billing_id:      item.event.billing_id,
            attempts:        item.attempts,
            next_attempt_ms: delay,
            error:           err.message
          });
          if (item.attempts >= this._maxRetries) {
            Logger.error('billing.outbox.max_retries_exceeded', {
              billing_id: item.event.billing_id
            });
            this._queue = this._queue.filter(q => q !== item);
          }
        }
      }
      this._processing = false;
    },

    getQueueSnapshot() {
      return this._queue.map(item => ({
        billing_id:      item.event.billing_id,
        guia_id:         item.event.guia_id,
        attempts:        item.attempts,
        pushed_at:       item.pushed_at,
        next_attempt_at: new Date(item.next_attempt_at).toISOString()
      }));
    }
  };

  /* =========================================================================
   * BILLING REPORTER — mock funcional + skeletons Stripe/Asaas/API
   * ========================================================================= */
  const BillingReporter = {
    _mode:   'mock',
    _config: {},

    configure(mode = 'mock', config = {}) {
      this._mode   = mode;
      this._config = config;
      Logger.info('billing.reporter.configured', { mode });
    },

    /**
     * report() NUNCA bloqueia. Em falha, evento vai para o Outbox.
     */
    async report(event) {
      try {
        switch (this._mode) {
          case 'mock':   return await this._reportMock(event);
          case 'stripe': return await this._reportStripe(event);
          case 'asaas':  return await this._reportAsaas(event);
          case 'api':    return await this._reportAPI(event);
          default:       return await this._reportMock(event);
        }
      } catch (err) {
        Logger.error('billing.reporter.unhandled_error', {
          mode: this._mode, billing_id: event.billing_id, error: err.message
        });
        return { success: false, error: err.message };
      }
    },

    async _reportMock(event) {
      await new Promise(r => setTimeout(r, 50));
      const ref = `MOCK-${Date.now()}`;
      Logger.info('billing.reporter.mock.success', {
        billing_id: event.billing_id, sku: event.sku,
        amount: event.amount_formatted, ref
      });
      return { success: true, reporter_ref: ref, mode: 'mock' };
    },

    async _reportStripe(event) {
      // TODO: Implementar Stripe
      Logger.warn('billing.reporter.stripe.not_implemented', { billing_id: event.billing_id });
      return { success: false, error: 'stripe_not_implemented' };
    },

    async _reportAsaas(event) {
      // TODO: Implementar Asaas
      // const res = await fetch('https://www.asaas.com/api/v3/payments', {
      //   method: 'POST',
      //   headers: { 'access_token': this._config.asaas_key, 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     customer: event.user_id, value: event.amount_brl,
      //     dueDate: new Date().toISOString().split('T')[0], description: event.sku
      //   })
      // });
      Logger.warn('billing.reporter.asaas.not_implemented', { billing_id: event.billing_id });
      return { success: false, error: 'asaas_not_implemented' };
    },

    async _reportAPI(event) {
      if (!this._config.url) return { success: false, error: 'api_url_not_configured' };
      try {
        const res = await fetch(this._config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this._config.apiKey ? { 'Authorization': `Bearer ${this._config.apiKey}` } : {})
          },
          body: JSON.stringify(event)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { success: true, reporter_ref: data.id || data.ref, mode: 'api' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  };

  /* =========================================================================
   * BUILD BILLING EVENT — única fonte de verdade do payload faturável
   * Status vocabulary: 'billing_pending' | 'billing_reported' | 'billing_failed'
   * ========================================================================= */
  async function buildBillingEvent(payload, renderResult, correlationId) {
    const guiaId     = renderResult.guia_id || BillingIdentity.generateGuiaId();
    const billingId  = BillingIdentity.generateBillingId();
    const ik         = BillingIdentity.generateIdempotencyKey(payload, guiaId);

    const opmeCount  = Array.isArray(payload.opme_itens) ? payload.opme_itens.length : 0;
    const isPremium  = opmeCount > 5;
    const priceEntry = isPremium
      ? PRICE_CATALOG.v1.guia_neuroauth_sadt_opme_premium
      : PRICE_CATALOG.v1.guia_neuroauth_sadt;
    const money = normalizeMoney(priceEntry.unit_amount);

    const patientHash = await hashPatientIdentity(
      payload.paciente_nome || payload.tiss_10_nome_beneficiario || '',
      payload.paciente_cpf_parcial || ''
    );

    return {
      // === Identidade ===
      guia_id:         guiaId,
      billing_id:      billingId,
      correlation_id:  correlationId,
      idempotency_key: ik,

      // === Produto / Preço ===
      sku:              priceEntry.sku,
      sku_description:  priceEntry.description,
      tier:             priceEntry.tier,
      amount_brl:       money.amount_brl,
      centavos:         money.centavos,
      amount_formatted: money.formatted,
      currency:         priceEntry.currency,
      catalog_version:  'v1',

      // === Dados da guia (sem PII) ===
      operadora:        payload.operadora_nome || payload.tiss_15_nome_plano || 'desconhecida',
      procedimento_tuss: payload.tiss_41_procedimento_codigo || '',
      procedimento_desc: (
        payload.tiss_42_procedimento_descricao ||
        payload.tiss_46_proc_descricao ||
        ''
      ).substring(0, 80),
      cid:              payload.tiss_43_cid || '',
      total_pages:      renderResult.total_pages || 2,
      opme_count:       opmeCount,
      procedimentos:    formatProcedimentos(payload.procedimentos || []),
      opme_itens:       formatOPME(payload.opme_itens || []),

      // === Paciente (LGPD-safe) ===
      paciente_iniciais:   getPacienteIniciais(
        payload.paciente_nome || payload.tiss_10_nome_beneficiario || ''
      ),
      patient_identity_hash: patientHash,

      // === Usuário / Sessão ===
      user_id:    payload.user_id  || 'anon',
      session_id: payload.session_id || null,
      medico_crm: payload.medico_crm || payload.tiss_23_numero_conselho_sol || null,

      // === Feature flags ===
      autofill_used: !!payload.autofill_used,

      // === Status lifecycle ===
      // billing_pending → billing_reported | billing_failed
      status:      'billing_pending',
      generated_at: new Date().toISOString(),
      reported_at:  null,
      reporter_ref: null,
      retries:      0,

      // === Auditoria ===
      _schema_version: '1.1.0'
    };
  }

  /* =========================================================================
   * GUIDE GENERATION ORCHESTRATOR
   * Ponto de entrada principal — chamado APÓS render bem-sucedido.
   *
   * Gate: renderResult.success === true
   *   → true  → processa billing (ledger-first → async report → outbox fallback)
   *   → false → retorna imediatamente sem billing
   *
   * Retorno garante: guia_protected: true em qualquer cenário de falha de billing.
   * ========================================================================= */
  const GuideGenerationOrchestrator = {
    async finalizeGuideGeneration(payload, renderResult) {
      const correlationId = BillingIdentity.generateCorrelationId();

      // Gate: apenas processa billing se render foi bem-sucedido
      if (!renderResult || !renderResult.success) {
        Logger.warn('billing.orchestrator.render_not_successful', {
          correlation_id: correlationId,
          guia_id: renderResult && renderResult.guia_id
        });
        return {
          success:      false,
          stage:        'render_failed',
          guia_protected: false,
          correlation_id: correlationId
        };
      }

      Logger.info('billing.orchestrator.start', {
        correlation_id: correlationId,
        guia_id:        renderResult.guia_id,
        user_id:        payload.user_id || 'anon'
      });

      // === 1. Construir evento ===
      let event;
      try {
        event = await buildBillingEvent(payload, renderResult, correlationId);
      } catch (err) {
        Logger.error('billing.orchestrator.build_event_failed', {
          correlation_id: correlationId,
          error: err.message
        });
        return {
          success:        true,   // guia OK
          stage:          'render_success',
          guia_protected: true,
          billing_status: 'build_failed',
          correlation_id: correlationId,
          user_message:   'Guia gerada com sucesso.'
        };
      }

      // === 2. Ledger-first (síncrono — deduplicação garantida) ===
      let ledgerResult;
      try {
        ledgerResult = await BillingLedger.write(event);
      } catch (err) {
        Logger.error('billing.orchestrator.ledger_write_failed', {
          correlation_id: correlationId, billing_id: event.billing_id, error: err.message
        });
        BillingOutbox.push(event);
        return {
          success:        true,
          stage:          'render_success',
          guia_id:        event.guia_id,
          billing_id:     event.billing_id,
          guia_protected: true,
          billing_status: 'queued_after_ledger_failure',
          correlation_id: correlationId,
          user_message:   'Guia gerada com sucesso.'
        };
      }

      if (ledgerResult.mode === 'duplicate_ignored') {
        Logger.info('billing.orchestrator.idempotent_duplicate', {
          correlation_id: correlationId, idempotency_key: event.idempotency_key
        });
        return {
          success:        true,
          stage:          'render_success',
          guia_id:        event.guia_id,
          billing_id:     event.billing_id,
          correlation_id: correlationId,
          ledger_status:  'duplicate_ignored',
          billing_status: 'duplicate_ignored',
          sku:            event.sku,
          tier:           event.tier,
          amount_formatted: event.amount_formatted,
          guia_protected: true,
          user_message:   'Guia gerada com sucesso.'
        };
      }

      // === 3. Report externo — ASSÍNCRONO (fire-and-forget com outbox fallback) ===
      Promise.resolve().then(async () => {
        try {
          const reportResult = await BillingReporter.report(event);
          if (reportResult.success) {
            await BillingLedger.updateStatus(event.idempotency_key, 'billing_reported', {
              reporter_ref: reportResult.reporter_ref,
              reported_at:  new Date().toISOString()
            });
            Logger.info('billing.orchestrator.reported', {
              correlation_id: correlationId, billing_id: event.billing_id,
              reporter_ref: reportResult.reporter_ref, sku: event.sku
            });
          } else {
            throw new Error(reportResult.error || 'reporter_failure');
          }
        } catch (err) {
          Logger.warn('billing.orchestrator.report_queued', {
            correlation_id: correlationId, billing_id: event.billing_id, error: err.message
          });
          BillingOutbox.push(event);
        }
      });

      Logger.info('billing.orchestrator.finalized', {
        correlation_id: correlationId, billing_id: event.billing_id,
        guia_id: event.guia_id, sku: event.sku, tier: event.tier,
        amount: event.amount_formatted
      });

      return {
        success:          true,
        stage:            'render_success',
        guia_id:          event.guia_id,
        billing_id:       event.billing_id,
        correlation_id:   correlationId,
        ledger_status:    ledgerResult.mode,
        billing_report_status: 'queued',
        sku:              event.sku,
        tier:             event.tier,
        amount_formatted: event.amount_formatted,
        guia_protected:   true,
        user_message:     'Guia gerada com sucesso.'
      };
    }
  };

  /* =========================================================================
   * BILLING RECONCILIATION
   * Verifica eventos 'billing_pending' antigos e tenta re-reportar.
   * ========================================================================= */
  const BillingReconciliation = {
    async reconcilePendingBillingEvents({ older_than_minutes = 15 } = {}) {
      const threshold = new Date(Date.now() - older_than_minutes * 60 * 1000).toISOString();
      const pending   = await BillingLedger.list({ status: 'billing_pending' });
      const stale     = pending.filter(e => e.generated_at <= threshold);

      Logger.info('billing.reconciliation.start', {
        total_pending: pending.length,
        stale_count:   stale.length,
        threshold
      });

      let recovered = 0, failed_again = 0;
      for (const event of stale) {
        try {
          const result = await BillingReporter.report(event);
          if (result.success) {
            await BillingLedger.updateStatus(event.idempotency_key, 'billing_reported', {
              reporter_ref: result.reporter_ref,
              reported_at:  new Date().toISOString(),
              reconciled:   true
            });
            recovered++;
          } else {
            failed_again++;
          }
        } catch (_) {
          failed_again++;
        }
      }

      Logger.info('billing.reconciliation.done', { recovered, failed_again });
      return { recovered, failed_again, inspected: stale.length };
    },

    async getReconciliationReport({ from_date, to_date } = {}) {
      const all      = await BillingLedger.list({ from_date, to_date });
      const total    = all.length;
      const reported = all.filter(e => e.status === 'billing_reported').length;
      const pending  = all.filter(e => e.status === 'billing_pending').length;
      const failed   = all.filter(e => e.status === 'billing_failed').length;
      const revenue  = all
        .filter(e => e.status === 'billing_reported')
        .reduce((sum, e) => sum + (e.amount_brl || 0), 0);
      const byTier = {
        standard: all.filter(e => e.tier === 'standard').length,
        premium:  all.filter(e => e.tier === 'premium').length
      };

      return {
        period:                { from_date, to_date },
        total_events:          total,
        reported,
        pending,
        failed,
        reconciliation_rate:   total > 0 ? `${((reported / total) * 100).toFixed(1)}%` : '0%',
        total_revenue_brl:     parseFloat(revenue.toFixed(2)),
        total_revenue_formatted: `R$ ${revenue.toFixed(2).replace('.', ',')}`,
        by_tier:               byTier,
        generated_at:          new Date().toISOString()
      };
    }
  };

  /* =========================================================================
   * EXEMPLO DE EVENTO FATURÁVEL (documentação de referência)
   * ========================================================================= */
  const EXAMPLE_BILLING_EVENT = {
    guia_id:          'NG-20260325-225800-9K7P2XA1B2C3',
    billing_id:       'BL-20260325-225801-F6E5D4C3B2A1',
    correlation_id:   'COR-8F3K9P2X4Y6Z1W3E5R',
    idempotency_key:  'IK-DEADBEEF41C6CE57',
    sku:              'guia_neuroauth_sadt_opme_premium',
    sku_description:  'Guia SADT OPME Premium NeuroAuth — >5 itens OPME',
    tier:             'premium',
    amount_brl:       7.50,
    centavos:         750,
    amount_formatted: 'R$ 7,50',
    currency:         'BRL',
    catalog_version:  'v1',
    operadora:        'Bradesco Saúde',
    procedimento_tuss:'30715016',
    procedimento_desc:'Artrodese Lombar (Fixação Posterior)',
    cid:              'M43.1',
    total_pages:      3,
    opme_count:       8,
    paciente_iniciais:'J.M.S.',
    patient_identity_hash: 'a3f2d1e9c8b7a6f5e4d3c2b1a0987654321f...',
    user_id:          'med_dr_123',
    medico_crm:       'CRM/SP 123456',
    autofill_used:    true,
    status:           'billing_reported',
    generated_at:     '2026-03-25T22:58:00.123Z',
    reported_at:      '2026-03-25T22:58:01.456Z',
    reporter_ref:     'MOCK-1711405081456',
    _schema_version:  '1.1.0'
  };

  /* =========================================================================
   * CHANGELOG
   * ========================================================================= */
  const CHANGELOG = [
    {
      version: '1.1.0',
      date:    '2026-03-25',
      changes: [
        'ARCH-001: renderResult.success como gate obrigatório em finalizeGuideGeneration',
        'ARCH-002: Status vocabulary padronizado: billing_pending | billing_reported | billing_failed',
        'ARCH-003: buildBillingEvent promovido a função pública testável (separada do orchestrator)',
        'ARCH-004: buildPayloadSignature retorna objeto estável (JSON.stringify para determinismo)',
        'ARCH-005: Síntese filosofia invisível (UX) + robustez transacional (ledger-first, outbox, reconciliação)',
        'KEEP-001: MurmurHash2-style mantido para idempotency keys (determinístico)',
        'KEEP-002: crypto.getRandomValues mantido para IDs (CSPRNG > Math.random)',
        'KEEP-003: SHA-256 via crypto.subtle mantido para hash LGPD',
        'KEEP-004: Todos os adapters mantidos (Memory/Sheets/API) com fallback gracioso',
        'KEEP-005: BillingOutbox.processQueue() completo com backoff exponencial',
        'KEEP-006: BillingReconciliation com status billing_pending (atualizado)',
        'ADD-001: user_message: "Guia gerada com sucesso." em todos os retornos de sucesso',
        'ADD-002: stage: "render_success" | "render_failed" para rastreabilidade'
      ]
    },
    {
      version: '1.0.0',
      date:    '2026-03-25',
      changes: ['Implementação inicial completa com 5 camadas (BillingIdentity, BillingLedger, BillingOutbox, BillingReporter, GuideGenerationOrchestrator)']
    }
  ];

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */
  return {
    VERSION,

    // Core
    BillingIdentity,
    BillingLedger,
    BillingOutbox,
    BillingReporter,
    BillingReconciliation,
    GuideGenerationOrchestrator,

    // Adapters (para configure())
    MemoryLedgerAdapter,
    GoogleSheetsLedgerAdapter,
    APILedgerAdapter,

    // Catálogo
    PRICE_CATALOG,
    EXAMPLE_BILLING_EVENT,
    CHANGELOG,

    // Helpers públicos e testáveis
    getPacienteIniciais,
    hashPatientIdentity,
    buildPayloadSignature,
    buildBillingEvent,
    normalizeMoney,
    formatProcedimentos,
    formatOPME,
    Logger
  };
}));
