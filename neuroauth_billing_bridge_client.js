/**
 * neuroauth_billing_bridge_client.js
 * NEUROAUTH_BILLING_CLIENT v1.0.0
 *
 * Camada 1 — BillingBridgeClient
 *
 * Thin facade sobre neuroauth_billing_bridge.js para uso seguro em UI/frontend.
 * Responsabilidades:
 *   1. Resolver referência ao bridge (global de browser ou require em Node.js)
 *   2. Expor apenas funções seguras — sem acesso direto ao ledger interno
 *   3. Fornecer configure() para injeção de adapter (testes, produção)
 *   4. Nunca duplicar lógica de billing — chamar bridge como caixa preta
 *
 * Princípio imutável herdado do bridge:
 *   "A guia clínica nunca morre por falha de billing."
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
    root.NEUROAUTH_BILLING_CLIENT = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  /* =========================================================================
   * BRIDGE RESOLVER — lazy, tolerante a falha
   * ========================================================================= */

  let _bridge = null;

  function _getBridge() {
    if (_bridge) return _bridge;

    // 1. Injeção explícita via configure() (testes / produção configurada)
    // 2. Browser global após <script src="neuroauth_billing_bridge.js">
    if (typeof NEUROAUTH_BILLING_BRIDGE !== 'undefined') {
      _bridge = NEUROAUTH_BILLING_BRIDGE; // eslint-disable-line no-undef
    }

    // 3. Node.js require (testes, servidor)
    if (!_bridge && typeof require !== 'undefined') {
      try {
        _bridge = require('./neuroauth_billing_bridge');
      } catch (_) {
        // bridge.js não encontrado no path — continuará null
      }
    }

    if (!_bridge) {
      throw new Error(
        '[NEUROAUTH_BILLING_CLIENT] Bridge não disponível. ' +
        'Carregue neuroauth_billing_bridge.js antes deste arquivo, ' +
        'ou injete via BillingBridgeClient.configure({ bridge }).'
      );
    }

    return _bridge;
  }

  /* =========================================================================
   * CONFIGURE — injeção explícita para testes e produção
   * ========================================================================= */

  /**
   * configure({ bridge, ledgerAdapter, reporterMode, reporterConfig })
   *
   * @param {object} bridge          - Referência ao módulo bridge (opcional se já é global)
   * @param {object} ledgerAdapter   - Adapter de ledger (MemoryLedgerAdapter, GoogleSheetsLedgerAdapter, etc.)
   * @param {string} reporterMode    - 'mock' | 'stripe' | 'asaas' | 'api'
   * @param {object} reporterConfig  - Config do reporter (url, apiKey, etc.)
   */
  function configure({ bridge, ledgerAdapter, reporterMode, reporterConfig } = {}) {
    if (bridge) {
      _bridge = bridge;
    }
    const b = _getBridge();
    if (ledgerAdapter) {
      b.BillingLedger.configure(ledgerAdapter);
    }
    if (reporterMode) {
      b.BillingReporter.configure(reporterMode, reporterConfig || {});
    }
  }

  /* =========================================================================
   * CORE — FLUXO CLÍNICO
   * ========================================================================= */

  /**
   * finalizeGuideGeneration(payload, renderResult)
   *
   * Ponto de entrada único do fluxo clínico → billing bridge.
   * Chamado APÓS o render bem-sucedido da guia.
   *
   * Gate: renderResult.success === true é obrigatório.
   * Princípio: "A guia nunca morre por falha de billing."
   *
   * @param {object} payload       - Payload clínico (usuário, paciente, operadora, OPME, etc.)
   * @param {object} renderResult  - { success: true, guia_id, total_pages, engine_version }
   * @returns {Promise<{
   *   success: boolean,
   *   stage: 'render_success' | 'render_failed',
   *   guia_id: string,
   *   billing_id: string,
   *   correlation_id: string,
   *   tier: 'standard' | 'premium',
   *   amount_formatted: string,
   *   guia_protected: boolean,
   *   user_message: string
   * }>}
   */
  async function finalizeGuideGeneration(payload, renderResult) {
    const b = _getBridge();
    return b.GuideGenerationOrchestrator.finalizeGuideGeneration(payload, renderResult);
  }

  /* =========================================================================
   * LEDGER — leitura para agregação e dashboards
   * ========================================================================= */

  /**
   * getLedger(opts) — retorna todos os eventos do ledger (read-only).
   *
   * Fonte primária de verdade para o agregador mensal.
   * O agregador NUNCA deve ter cópia própria dos eventos — usa este método.
   *
   * @param {object} opts - { status, from_date, to_date }
   *   status:    filtra por status ('billing_pending', 'billing_reported', etc.)
   *   from_date: ISO string — eventos a partir desta data
   *   to_date:   ISO string — eventos até esta data
   *
   * @returns {Promise<Array<BillingEvent>>}
   */
  async function getLedger(opts = {}) {
    const b = _getBridge();
    return b.BillingLedger.list(opts);
  }

  /**
   * getLedgerEntry(idempotencyKey) — busca entrada específica.
   *
   * @param {string} idempotencyKey
   * @returns {Promise<BillingEvent|null>}
   */
  async function getLedgerEntry(idempotencyKey) {
    const b = _getBridge();
    return b.BillingLedger.find(idempotencyKey);
  }

  /**
   * updateLedgerStatus(idempotencyKey, newStatus, extra)
   *
   * Atualiza status de um evento no ledger.
   * Usado pelo agregador para marcar eventos como 'billing_reconciled'.
   *
   * @param {string} idempotencyKey
   * @param {string} newStatus
   * @param {object} extra — campos extras para merge (reporter_ref, reported_at, etc.)
   * @returns {Promise<boolean>}
   */
  async function updateLedgerStatus(idempotencyKey, newStatus, extra = {}) {
    const b = _getBridge();
    return b.BillingLedger.updateStatus(idempotencyKey, newStatus, extra);
  }

  /**
   * getLedgerCount() — total de entradas no ledger.
   * @returns {Promise<number>}
   */
  async function getLedgerCount() {
    const b = _getBridge();
    return b.BillingLedger.count();
  }

  /* =========================================================================
   * RECONCILIATION — manutenção de eventos billing_pending
   * ========================================================================= */

  /**
   * reconcile(opts) — re-reporta eventos billing_pending antigos.
   *
   * @param {object} opts - { older_than_minutes: 15 }
   * @returns {Promise<{ recovered: number, failed_again: number, inspected: number }>}
   */
  async function reconcile(opts = {}) {
    const b = _getBridge();
    return b.BillingReconciliation.reconcilePendingBillingEvents(opts);
  }

  /**
   * getReconciliationReport(opts) — relatório de saúde do ledger.
   *
   * @param {object} opts - { from_date, to_date }
   * @returns {Promise<{total_events, reported, pending, failed, reconciliation_rate, total_revenue_brl}>}
   */
  async function getReconciliationReport(opts = {}) {
    const b = _getBridge();
    return b.BillingReconciliation.getReconciliationReport(opts);
  }

  /* =========================================================================
   * OUTBOX — retry queue
   * ========================================================================= */

  /**
   * processOutbox() — processa a fila de retry (outbox pattern).
   * Chame periodicamente para garantir que nenhum evento fique preso.
   */
  async function processOutbox() {
    const b = _getBridge();
    return b.BillingOutbox.processQueue();
  }

  /**
   * getOutboxSnapshot() — snapshot da fila de retry para monitoramento.
   * @returns {Array<{ billing_id, guia_id, attempts, pushed_at, next_attempt_at }>}
   */
  function getOutboxSnapshot() {
    const b = _getBridge();
    return b.BillingOutbox.getQueueSnapshot();
  }

  /* =========================================================================
   * ADAPTERS — reexporta para conveniência de configuração
   * ========================================================================= */

  /**
   * getAdapters() — retorna construtores de adapter do bridge.
   * @returns {{ MemoryLedgerAdapter, GoogleSheetsLedgerAdapter, APILedgerAdapter }}
   */
  function getAdapters() {
    const b = _getBridge();
    return {
      MemoryLedgerAdapter:       b.MemoryLedgerAdapter,
      GoogleSheetsLedgerAdapter: b.GoogleSheetsLedgerAdapter,
      APILedgerAdapter:          b.APILedgerAdapter
    };
  }

  /* =========================================================================
   * CHANGELOG
   * ========================================================================= */
  const CHANGELOG = [
    {
      version: '1.0.0',
      date:    '2026-03-26',
      changes: [
        'ARCH-C001: BillingBridgeClient como camada 1 — thin facade sobre bridge',
        'ARCH-C002: configure() aceita bridge, ledgerAdapter, reporterMode, reporterConfig',
        'ARCH-C003: getLedger(opts) expõe BillingLedger.list() para o agregador mensal',
        'ARCH-C004: updateLedgerStatus() permite que o agregador marque eventos como reconciled',
        'ARCH-C005: processOutbox() e getOutboxSnapshot() para manutenção da fila de retry',
        'ARCH-C006: getAdapters() reexporta construtores do bridge para configuração',
        'ARCH-C007: Zero lógica de billing duplicada — toda chamada delega ao bridge'
      ]
    }
  ];

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */
  return {
    VERSION,
    CHANGELOG,

    // Config
    configure,
    getAdapters,

    // Fluxo clínico
    finalizeGuideGeneration,

    // Ledger (read/write para agregador)
    getLedger,
    getLedgerEntry,
    updateLedgerStatus,
    getLedgerCount,

    // Reconciliação
    reconcile,
    getReconciliationReport,

    // Outbox
    processOutbox,
    getOutboxSnapshot
  };
}));
