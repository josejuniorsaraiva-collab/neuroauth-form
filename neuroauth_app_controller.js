/**
 * neuroauth_app_controller.js
 * NEUROAUTH App Controller — v1.0.0-alpha
 *
 * Camada fina de orquestração sobre o index.html já hardenizado.
 * Não reescreve nenhum fluxo existente — apenas delega e observa.
 *
 * Três camadas:
 *   1. Adapter Layer  — delegação para funções do index.html
 *   2. State Layer    — merge profundo seguro sobre window.__NA_STATE__
 *   3. Observability  — NA.log() integrado com naLog() existente
 *
 * Restrições respeitadas:
 *   - Não chama collect() fora do fluxo atual
 *   - Não cria autosave
 *   - Não cria listener em beforeunload
 *   - Não altera confirmedSend(), openPreview(), printGuia()
 *   - init() é idempotente — seguro chamar N vezes
 *   - Falha silenciosa e legível se funções do index.html não existirem
 *
 * @version 1.0.0-alpha
 * @license Proprietary — NeuroAuth © 2026
 */

(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.NA = factory();
  }
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* =========================================================================
   * CONSTANTES INTERNAS
   * ========================================================================= */
  var CONTROLLER_VERSION = '1.0.0-alpha';

  /* =========================================================================
   * GUARD DE INICIALIZAÇÃO
   * Impede init() de duplicar listeners ou resetar estado já existente
   * ========================================================================= */
  var _initialized = false;

  /* =========================================================================
   * GUARD DE ENVIO (controller-level)
   * Guard local leve — não conflita com __NA_SENDING__ do index.html.
   * Bloqueia duplo clique no nível do controller antes mesmo de chegar
   * no confirmedSend(). Os dois locks são independentes e cumulativos.
   * ========================================================================= */
  var _sendPending = false;

  /* =========================================================================
   * LAYER 3 — OBSERVABILITY
   * NA.log() integra com naLog() do index.html se disponível.
   * Nunca propaga exceção.
   * ========================================================================= */
  function _log(event, data) {
    try {
      // Delega para naLog() do index.html se existir
      if (typeof naLog === 'function') {
        naLog(event, Object.assign({ _src: 'controller' }, data || {}));
        return;
      }
      // Fallback: console.debug estruturado
      console.debug('[NA:ctrl]', Object.assign({
        event:  event,
        ts:     new Date().toISOString(),
        v:      CONTROLLER_VERSION
      }, data || {}));
    } catch (e) { /* silencioso */ }
  }

  /* =========================================================================
   * LAYER 2 — STATE
   * Opera sobre window.__NA_STATE__ criado pelo index.html.
   * Merge profundo seguro — não sobrescreve objetos aninhados por acidente.
   * ========================================================================= */

  /**
   * Retorna uma cópia rasa do __NA_STATE__ atual.
   * Nunca modifica o original.
   */
  function getState() {
    return Object.assign({}, window.__NA_STATE__ || {});
  }

  /**
   * Merge profundo seguro de `patch` em window.__NA_STATE__.
   * Regras:
   *   - Cria __NA_STATE__ se não existir (fallback defensivo)
   *   - Merge nível 1: Object.assign no objeto raiz
   *   - Merge nível 2: para campos que são objects (payload, compliance, meta, user),
   *     faz assign individual — nunca substitui o objeto todo por um parcial
   *   - dirty, ts, doc_id são escalares — substituídos diretamente
   */
  var DEEP_FIELDS = ['payload', 'compliance', 'meta', 'user'];

  function setStateDeep(patch) {
    if (!patch || typeof patch !== 'object') return;
    if (!window.__NA_STATE__) {
      window.__NA_STATE__ = { payload: null, compliance: null, ts: null, dirty: true };
    }
    var state = window.__NA_STATE__;
    Object.keys(patch).forEach(function (key) {
      var val = patch[key];
      if (val !== null && typeof val === 'object' && !Array.isArray(val) &&
          DEEP_FIELDS.indexOf(key) !== -1 && state[key] && typeof state[key] === 'object') {
        // merge profundo para campos aninhados conhecidos
        state[key] = Object.assign({}, state[key], val);
      } else {
        // escalar, array ou campo novo — substitui diretamente
        state[key] = val;
      }
    });
    _log('state_updated', { keys: Object.keys(patch) });
  }

  /** Marca o estado como sujo — dispara revalidação no próximo send/preview */
  function markDirty() {
    if (window.__NA_STATE__) window.__NA_STATE__.dirty = true;
    // Mantém alias backwards-compat do index.html
    window.__NA_LAST_COMPLIANCE__ = null;
  }

  /** Limpa flag dirty — usado após validação bem-sucedida */
  function clearDirty() {
    if (window.__NA_STATE__) window.__NA_STATE__.dirty = false;
  }

  /* =========================================================================
   * LAYER 1 — ADAPTER
   * Delegação para funções do index.html.
   * Cada método falha de forma segura e legível se a função não existir.
   * ========================================================================= */

  /**
   * NA.handleLogin(email)
   * Delega para naFetchPerfil() que contém as 3 camadas de acesso:
   *   Camada 1 — DEV_BYPASS
   *   Camada 2 — LOCAL_ALPHA_WHITELIST
   *   Camada 3 — Bloqueio amigável / Make.com webhook
   *
   * Retorna { allowed, type, perfil } ou lança com mensagem legível.
   */
  async function handleLogin(email) {
    if (typeof naFetchPerfil !== 'function') {
      _log('login_error', { reason: 'naFetchPerfil_not_found' });
      console.error('[NA:ctrl] naFetchPerfil não encontrada — controller não pode validar login.');
      return { allowed: false, type: 'CONTROLLER_ERROR' };
    }
    var emailNorm = String(email || '').trim().toLowerCase();
    if (!emailNorm || emailNorm.indexOf('@') === -1) {
      _log('login_denied', { type: 'INVALID_EMAIL', email: emailNorm });
      return { allowed: false, type: 'INVALID_EMAIL',
               message: 'E-mail inválido. Verifique o login e tente novamente.' };
    }
    try {
      var perfil = await naFetchPerfil(emailNorm);
      _log('login_granted', { type: perfil.role || 'medico', bypass: !!perfil.bypass });
      return { allowed: true, type: perfil.role || 'medico', perfil: perfil };
    } catch (err) {
      _log('login_denied', { type: 'ACCESS_DENIED', message: err.message });
      return { allowed: false, type: 'ACCESS_DENIED', message: err.message };
    }
  }

  /**
   * NA.handlePreview()
   * Delega para openPreview() — não toca em collect() nem em compliance diretamente.
   */
  function handlePreview() {
    if (typeof openPreview !== 'function') {
      _log('preview_error', { reason: 'openPreview_not_found' });
      console.error('[NA:ctrl] openPreview não encontrada.');
      return;
    }
    _log('preview_requested');
    openPreview();
  }

  /**
   * NA.handleSend()
   * Guard controller-level (leve) + delega para confirmedSend().
   * O guard aqui é uma segunda linha de defesa — confirmedSend() já tem
   * __NA_SENDING__ + watchdog. Os dois locks são independentes e cumulativos.
   */
  async function handleSend() {
    if (_sendPending) {
      _log('send_blocked_duplicate', { src: 'controller_guard' });
      return;
    }
    if (typeof confirmedSend !== 'function') {
      _log('send_error', { reason: 'confirmedSend_not_found' });
      console.error('[NA:ctrl] confirmedSend não encontrada.');
      return;
    }
    _sendPending = true;
    _log('send_requested');
    try {
      await confirmedSend();
    } finally {
      _sendPending = false;
    }
  }

  /**
   * NA.handlePrint(which)
   * Delega para printGuia(which) se existir, senão window.print() como fallback.
   * `which` = 'sadt' | 'opme' | undefined
   */
  function handlePrint(which) {
    _log('print_requested', { which: which || 'default' });
    if (typeof printGuia === 'function') {
      printGuia(which);
    } else {
      console.warn('[NA:ctrl] printGuia não encontrada — usando window.print() como fallback.');
      if (typeof window !== 'undefined' && window.print) window.print();
    }
  }

  /* =========================================================================
   * INIT — idempotente
   * Seguro chamar N vezes. Não duplica listeners. Não reseta estado.
   * ========================================================================= */
  function init() {
    if (_initialized) {
      _log('controller_init_skipped', { reason: 'already_initialized' });
      return;
    }
    // Garante __NA_STATE__ se index.html ainda não criou (fallback defensivo)
    if (!window.__NA_STATE__) {
      window.__NA_STATE__ = { payload: null, compliance: null, ts: null, dirty: true };
    }
    _initialized = true;
    _log('controller_init', { v: CONTROLLER_VERSION });
  }

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */
  return {
    VERSION: CONTROLLER_VERSION,

    // Init
    init: init,

    // Layer 2 — State
    getState:     getState,
    setStateDeep: setStateDeep,
    markDirty:    markDirty,
    clearDirty:   clearDirty,

    // Layer 1 — Adapter
    handleLogin:   handleLogin,
    handlePreview: handlePreview,
    handleSend:    handleSend,
    handlePrint:   handlePrint,

    // Layer 3 — Observability
    log: _log
  };
}));
