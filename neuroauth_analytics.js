/**
 * NEUROAUTH Analytics Engine v2.0.0
 * Painel de Controle do Fundador — Alpha Observability Layer
 *
 * Responsabilidades:
 *  1. Coletor global (UMD singleton) — track() para todos os módulos
 *  2. Agregação por usuário: guias, reutilizações, minutos economizados
 *  3. Métricas de aceitação de reuso (reuse_acceptance_rate)
 *  4. Risk flags automáticos por usuário: 3 regras configuráveis
 *  5. Snapshot estruturado para tomada de decisão do fundador
 *  6. Founder Dashboard v1 — cards detalhados + sumário global
 *
 * Eventos suportados (v2.0.0):
 *   GUIDE_GENERATED        — qualquer guia gerada (fresh + reuse + blueprint)
 *   FRESH_GUIDE_GENERATED  — alias semântico para GUIDE_GENERATED autofill_mode='fresh'
 *   REUSE_SUCCESS          — reutilização de caso ad-hoc aplicada com sucesso
 *   BLUEPRINT_APPLIED      — blueprint de protocolo aplicado com sucesso
 *   REUSE_SHOWN            — painel de reuso exibido ao médico (antecede REUSE_SUCCESS)
 *   GUIDE_EDITED_POST_APPLY— médico editou guia após aplicar reuso/blueprint (risco)
 *
 * Campos de evento (quando disponíveis):
 *   user_id, user_email, guia_id, blueprint_id, ts,
 *   autofill_mode, time_saved_estimate_min
 *
 * Risk flags por usuário:
 *   many_guides_zero_blueprint — muitas guias sem usar blueprints
 *   high_edit_after_apply      — edições excessivas após reuso (baixa qualidade dos protocolos)
 *   inactive_recently          — sem atividade por INACTIVE_DAYS_THRESHOLD dias
 *
 * Design Constraints:
 *  - LGPD-safe: NUNCA armazena dados de pacientes. user_email é do médico (não paciente)
 *  - Offline-first: localStorage com memory fallback (Node-safe)
 *  - Fire-and-forget: track() nunca lança exceção
 *  - Incremental: cada evento acumula sem recalcular histórico
 *  - Backward compatible: todos os contratos v1.0.0 preservados
 *
 * Global UMD: NEUROAUTH_ANALYTICS
 *
 * Changelog:
 *   v2.0.0 — Eventos REUSE_SHOWN + FRESH_GUIDE_GENERATED + GUIDE_EDITED_POST_APPLY;
 *            campos user_email, fresh_guides, reuse_shown, edit_after_apply_count,
 *            reuse_acceptance_rate, last_activity_at, risk_flags;
 *            3 regras de risco estruturadas; Founder Dashboard v1 completo.
 *   v1.0.0 — MVP: GUIDE_GENERATED, REUSE_SUCCESS, BLUEPRINT_APPLIED; dashboard básico.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NEUROAUTH_ANALYTICS = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis :
  typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  var VERSION       = '2.0.0';
  var STORAGE_KEY   = 'NEUROAUTH_ANALYTICS_V1'; // mesma chave — backward compat

  /* ── Thresholds configuráveis ──────────────────────────────────────────── */
  var MAX_EVENTS                 = 2000;  // compacta ao exceder
  var RISK_GUIDE_THRESHOLD       = 5;    // guias para acionar many_guides_zero_blueprint
  var EDIT_AFTER_APPLY_THRESHOLD = 3;    // edições pós-reuso para acionar high_edit_after_apply
  var INACTIVE_DAYS_THRESHOLD    = 7;    // dias sem atividade para acionar inactive_recently

  /* =========================================================================
   * STORAGE ADAPTER — localStorage com memory fallback (Node-safe)
   * ========================================================================= */
  var _memFallback = {};
  var Storage = {
    _canUseLS: (function() {
      try {
        if (typeof localStorage === 'undefined') return false;
        var k = '__NA_TEST__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true;
      } catch(e) { return false; }
    })(),

    get: function(key) {
      try {
        if (this._canUseLS) {
          var raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : null;
        }
        return _memFallback[key] ? JSON.parse(_memFallback[key]) : null;
      } catch(e) { return null; }
    },

    set: function(key, value) {
      try {
        var serialized = JSON.stringify(value);
        if (this._canUseLS) {
          localStorage.setItem(key, serialized);
        } else {
          _memFallback[key] = serialized;
        }
      } catch(e) { /* quota exceeded — silencioso */ }
    },

    remove: function(key) {
      try {
        if (this._canUseLS) { localStorage.removeItem(key); }
        else { delete _memFallback[key]; }
      } catch(e) {}
    }
  };

  /* =========================================================================
   * CAMPOS PROIBIDOS — LGPD: NUNCA persistir dados de pacientes
   * Nota: user_email NÃO está aqui — é email do médico, não paciente.
   * ========================================================================= */
  var FORBIDDEN_FIELDS = [
    'nome_paciente', 'nome', 'patient_name',
    'carteirinha', 'numero_carteira', 'carteira',
    'cpf', 'rg', 'data_nascimento', 'nascimento', 'birth_date',
    'endereco', 'telefone', 'email', 'contato',
    'cid', 'diagnostico', 'hipotese_diagnostica',
    'justificativa_clinica', 'justificativa', 'anamnese', 'laudo',
    'medico_nome', 'crm',
    'tiss_72_justificativa_clinica', 'tiss_cid'
  ];

  function _sanitize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var copy = {};
    Object.keys(obj).forEach(function(k) {
      if (FORBIDDEN_FIELDS.indexOf(k) === -1) {
        copy[k] = obj[k];
      }
    });
    return copy;
  }

  /* =========================================================================
   * HELPERS
   * ========================================================================= */
  function _nowMs()  { return Date.now(); }
  function _daysSince(ts) {
    return Math.floor((_nowMs() - (ts || 0)) / 86400000);
  }

  /* =========================================================================
   * INTERNAL STORE OPERATIONS
   * ========================================================================= */
  function _load() {
    var stored = Storage.get(STORAGE_KEY);
    if (!stored || typeof stored !== 'object') {
      return { events: [], users: {}, meta: { version: VERSION, created_at: _nowMs() } };
    }
    if (!stored.events) stored.events = [];
    if (!stored.users)  stored.users  = {};
    if (!stored.meta)   stored.meta   = { version: VERSION, created_at: _nowMs() };
    return stored;
  }

  function _save(data) {
    if (data.events && data.events.length > MAX_EVENTS) {
      data.events = data.events.slice(-MAX_EVENTS);
    }
    Storage.set(STORAGE_KEY, data);
  }

  /* =========================================================================
   * USER STATS — acumulação incremental por usuário
   * =========================================================================
   * Estrutura v2.0.0 por usuário (novos campos marcados com ★):
   * {
   *   user_id:                 string,
   *   user_email:              string|null,  ★ email do médico (LGPD-safe)
   *   guides:                  number,       — total de guias (todos os tipos)
   *   fresh_guides:            number,       ★ guias sem reuso (autofill_mode='fresh')
   *   reuse_count:             number,       — reutilizações (success + blueprint)
   *   blueprint_applications:  number,       — backward compat
   *   blueprint_applied:       number,       ★ alias de blueprint_applications
   *   reuse_shown:             number,       ★ vezes que painel de reuso foi exibido
   *   edit_after_apply_count:  number,       ★ edições pós-reuso
   *   minutes_saved:           number,
   *   hours_saved:             number,
   *   first_seen:              timestamp,
   *   last_seen:               timestamp,
   *   last_activity_at:        timestamp,    ★ alias explícito de last_seen
   * }
   * ========================================================================= */
  function _getOrCreateUser(users, userId) {
    if (!users[userId]) {
      var now = _nowMs();
      users[userId] = {
        user_id:                userId,
        user_email:             null,
        guides:                 0,
        fresh_guides:           0,
        reuse_count:            0,
        blueprint_applications: 0,
        blueprint_applied:      0,
        reuse_shown:            0,
        edit_after_apply_count: 0,
        minutes_saved:          0,
        hours_saved:            0,
        first_seen:             now,
        last_seen:              now,
        last_activity_at:       now
      };
    }
    // Migração silenciosa de campos v1 → v2 (usuários pré-existentes em storage)
    var u = users[userId];
    if (u.fresh_guides           === undefined) u.fresh_guides           = 0;
    if (u.reuse_shown            === undefined) u.reuse_shown            = 0;
    if (u.edit_after_apply_count === undefined) u.edit_after_apply_count = 0;
    if (u.blueprint_applied      === undefined) u.blueprint_applied      = u.blueprint_applications || 0;
    if (u.user_email             === undefined) u.user_email             = null;
    if (u.last_activity_at       === undefined) u.last_activity_at       = u.last_seen || _nowMs();
    return u;
  }

  function _applyEventToUser(user, event) {
    var ts = event.ts || _nowMs();
    user.last_seen       = ts;
    user.last_activity_at = ts;

    // Captura user_email do médico se fornecido (nunca sobrescreve com null)
    if (event.user_email && typeof event.user_email === 'string') {
      user.user_email = event.user_email;
    }

    var type = event.type;

    // FRESH_GUIDE_GENERATED = alias semântico para GUIDE_GENERATED fresh
    // Normaliza para o handler unificado
    if (type === 'FRESH_GUIDE_GENERATED') {
      type = 'GUIDE_GENERATED';
      event = Object.assign({}, event, { autofill_mode: event.autofill_mode || 'fresh' });
    }

    switch (type) {

      case 'GUIDE_GENERATED':
        user.guides += 1;
        // Contabiliza fresh_guides apenas para modo fresh explícito
        var mode = event.autofill_mode || '';
        if (mode === 'fresh' || mode === '' || mode === 'none') {
          user.fresh_guides += 1;
        }
        break;

      case 'REUSE_SHOWN':
        // Painel de reuso exibido ao médico — precede REUSE_SUCCESS
        user.reuse_shown += 1;
        break;

      case 'REUSE_SUCCESS': {
        user.reuse_count += 1;
        var modeIsBlueprint = event.autofill_mode === 'blueprint' ||
                              event.mode === 'blueprint' ||
                              event.blueprint_id != null;
        if (modeIsBlueprint) {
          user.blueprint_applications += 1;
          user.blueprint_applied      += 1;
        }
        var rMins = event.time_saved_estimate_min
                 || event.time_saved_min
                 || (modeIsBlueprint ? 14 : 12);
        user.minutes_saved += rMins;
        user.hours_saved    = user.minutes_saved / 60;
        break;
      }

      case 'BLUEPRINT_APPLIED':
        user.reuse_count            += 1;
        user.blueprint_applications += 1;
        user.blueprint_applied      += 1;
        var bpMins = event.time_saved_estimate_min || event.time_saved_min || 14;
        user.minutes_saved += bpMins;
        user.hours_saved    = user.minutes_saved / 60;
        break;

      case 'GUIDE_EDITED_POST_APPLY':
        // Médico editou guia gerada por reuso/blueprint — sinaliza ajuste pós-protocolo
        user.edit_after_apply_count += 1;
        break;

      default:
        /* eventos desconhecidos armazenados mas não agregados */
        break;
    }
  }

  /* =========================================================================
   * RISK FLAGS — avaliação por usuário
   * =========================================================================
   * Retorna array de strings com as flags ativas para um usuário.
   * Nunca lança.
   * ========================================================================= */
  var RISK_RULES = [
    {
      id: 'many_guides_zero_blueprint',
      label: 'Não usa blueprints',
      description: 'Gerou muitas guias sem nenhuma aplicação de blueprint',
      check: function(u) {
        return u.guides > RISK_GUIDE_THRESHOLD && u.blueprint_applied === 0;
      }
    },
    {
      id: 'high_edit_after_apply',
      label: 'Edita após reuso',
      description: 'Edita guias com frequência após aplicar reuso — protocolos podem não servir',
      check: function(u) {
        return u.edit_after_apply_count >= EDIT_AFTER_APPLY_THRESHOLD;
      }
    },
    {
      id: 'inactive_recently',
      label: 'Inativo recentemente',
      description: 'Sem atividade nos últimos ' + INACTIVE_DAYS_THRESHOLD + ' dias',
      check: function(u) {
        return _daysSince(u.last_activity_at || u.last_seen) >= INACTIVE_DAYS_THRESHOLD;
      }
    }
  ];

  function _computeRiskFlags(user) {
    var flags = [];
    for (var i = 0; i < RISK_RULES.length; i++) {
      try {
        if (RISK_RULES[i].check(user)) {
          flags.push(RISK_RULES[i].id);
        }
      } catch(_) {}
    }
    return flags;
  }

  function _computeReuseAcceptanceRate(user) {
    if (!user.reuse_shown || user.reuse_shown === 0) return null; // não exibido ainda
    return Math.round((user.reuse_count / user.reuse_shown) * 100);
  }

  /* Enriquece o objeto de usuário com campos computados — NÃO persiste */
  function _enrichUser(user) {
    var enriched = Object.assign({}, user);
    enriched.risk_flags           = _computeRiskFlags(user);
    enriched.reuse_acceptance_rate = _computeReuseAcceptanceRate(user);
    return enriched;
  }

  /* =========================================================================
   * INTERNAL STORE OPERATIONS
   * ========================================================================= */
  function _load() {
    var stored = Storage.get(STORAGE_KEY);
    if (!stored || typeof stored !== 'object') {
      return { events: [], users: {}, meta: { version: VERSION, created_at: _nowMs() } };
    }
    if (!stored.events) stored.events = [];
    if (!stored.users)  stored.users  = {};
    if (!stored.meta)   stored.meta   = { version: VERSION, created_at: _nowMs() };
    return stored;
  }

  function _save(data) {
    if (data.events && data.events.length > MAX_EVENTS) {
      data.events = data.events.slice(-MAX_EVENTS);
    }
    Storage.set(STORAGE_KEY, data);
  }

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */

  /**
   * track(event)
   * Registra um evento de comportamento. Nunca lança exceção.
   *
   * Campos esperados no event:
   *   type: 'GUIDE_GENERATED'|'FRESH_GUIDE_GENERATED'|'REUSE_SHOWN'|
   *         'REUSE_SUCCESS'|'BLUEPRINT_APPLIED'|'GUIDE_EDITED_POST_APPLY'
   *   user_id:                 string  (obrigatório para agregação)
   *   user_email:              string  (email do médico — LGPD-safe, opcional)
   *   guia_id:                 string  (opcional)
   *   blueprint_id:            string  (opcional)
   *   ts:                      number  (timestamp ms, default: Date.now())
   *   autofill_mode:           'fresh'|'reuse'|'blueprint'  (opcional)
   *   time_saved_estimate_min: number  (opcional)
   *
   * @param {Object} event
   */
  function track(event) {
    try {
      if (!event || typeof event !== 'object') return;

      var safe = _sanitize(event);
      safe.ts = safe.ts || _nowMs();

      var data   = _load();
      var userId = safe.user_id || 'anonymous';
      var user   = _getOrCreateUser(data.users, userId);

      _applyEventToUser(user, safe);
      data.events.push(safe);
      _save(data);
    } catch(e) {
      try { console.warn('[NEUROAUTH_ANALYTICS] track error:', e.message); } catch(_) {}
    }
  }

  /**
   * snapshot()
   * Retorna o estado completo do analytics store (raw, sem enriquecimento).
   * @returns {{ events: Array, users: Object, meta: Object }}
   */
  function snapshot() {
    return _load();
  }

  /**
   * getUserStats(userId)
   * Retorna estatísticas enriquecidas de um usuário (inclui risk_flags e
   * reuse_acceptance_rate).
   * @param {string} userId
   * @returns {Object|null}
   */
  function getUserStats(userId) {
    var data = _load();
    var raw  = data.users[userId];
    if (!raw) return null;
    return _enrichUser(_getOrCreateUser(data.users, userId));
  }

  /**
   * getAllUsers()
   * Retorna array de todos os usuários enriquecidos, ordenado por guides desc.
   * @returns {Array}
   */
  function getAllUsers() {
    var data  = _load();
    var users = Object.keys(data.users).map(function(k) {
      return _enrichUser(_getOrCreateUser(data.users, k));
    });
    return users.sort(function(a, b) { return b.guides - a.guides; });
  }

  /**
   * getUserRiskFlags(userId)
   * Retorna array de risk flag IDs ativos para o usuário.
   * @param {string} userId
   * @returns {Array<string>}
   */
  function getUserRiskFlags(userId) {
    var stats = getUserStats(userId);
    if (!stats) return [];
    return stats.risk_flags || [];
  }

  /**
   * detectRisk()
   * Retorna todos os usuários com pelo menos uma flag de risco ativa.
   * Inclui detalhes das flags.
   * @returns {Array<{ user: Object, flags: Array<string> }>}
   */
  function detectRisk() {
    var result = [];
    try {
      var users = getAllUsers();
      users.forEach(function(u) {
        if (u.risk_flags && u.risk_flags.length > 0) {
          result.push({ user: u, flags: u.risk_flags });
          try {
            console.warn(
              '[NEUROAUTH_ANALYTICS] RISCO: user_id=' + u.user_id +
              ' flags=[' + u.risk_flags.join(',') + ']' +
              ' guides=' + u.guides +
              ' blueprint_applied=' + u.blueprint_applied +
              ' edit_after_apply=' + u.edit_after_apply_count +
              ' inativo_dias=' + _daysSince(u.last_activity_at)
            );
          } catch(_) {}
        }
      });
    } catch(e) {
      try { console.warn('[NEUROAUTH_ANALYTICS] detectRisk error:', e.message); } catch(_) {}
    }
    return result;
  }

  /**
   * getGlobalSummary()
   * Retorna totais globais para a visão executiva.
   * @returns {Object}
   */
  function getGlobalSummary() {
    var data   = _load();
    var users  = Object.keys(data.users).map(function(k) {
      return _getOrCreateUser(data.users, k);
    });

    var totalGuides       = 0;
    var totalFreshGuides  = 0;
    var totalReuse        = 0;
    var totalBlueprintApp = 0;
    var totalReuseShown   = 0;
    var totalMinutes      = 0;
    var activeUsers       = 0;
    var powerUsers        = 0;
    var atRiskUsers       = 0;

    users.forEach(function(u) {
      totalGuides       += u.guides              || 0;
      totalFreshGuides  += u.fresh_guides        || 0;
      totalReuse        += u.reuse_count         || 0;
      totalBlueprintApp += u.blueprint_applied   || 0;
      totalReuseShown   += u.reuse_shown         || 0;
      totalMinutes      += u.minutes_saved       || 0;
      if ((u.guides || 0) > 0) activeUsers++;
      if ((u.reuse_count || 0) > 0) powerUsers++;
      if (_computeRiskFlags(u).length > 0) atRiskUsers++;
    });

    var reuseRatePct = totalGuides > 0
      ? Math.round((totalReuse / totalGuides) * 100) : 0;

    var reuseAcceptancePct = totalReuseShown > 0
      ? Math.round((totalReuse / totalReuseShown) * 100) : null;

    return {
      total_users:             users.length,
      active_users:            activeUsers,
      power_users:             powerUsers,
      at_risk_users:           atRiskUsers,
      total_guides:            totalGuides,
      total_fresh_guides:      totalFreshGuides,
      total_reuse:             totalReuse,
      total_blueprint_applied: totalBlueprintApp,
      total_reuse_shown:       totalReuseShown,
      reuse_rate_pct:          reuseRatePct,
      reuse_acceptance_pct:    reuseAcceptancePct,
      total_hours_saved:       totalMinutes / 60,
      total_events:            data.events.length
    };
  }

  /**
   * renderFounderDashboard(containerId?)
   * Injeta o HTML do Painel do Fundador no container especificado.
   * @param {string} [containerId='founder-dashboard']
   * @returns {string} HTML gerado
   */
  function renderFounderDashboard(containerId) {
    var targetId = containerId || 'founder-dashboard';
    var html     = _buildDashboardHTML();

    if (typeof document !== 'undefined') {
      var el = document.getElementById(targetId);
      if (el) {
        el.innerHTML = html;
        var refreshBtn = el.querySelector('[data-action="fd-refresh"]');
        if (refreshBtn) {
          refreshBtn.addEventListener('click', function() { renderFounderDashboard(targetId); });
        }
        var riskBtn = el.querySelector('[data-action="fd-risk"]');
        if (riskBtn) {
          riskBtn.addEventListener('click', function() {
            var risky = detectRisk();
            var msg = risky.length === 0
              ? 'Nenhum usuário em risco detectado.'
              : risky.length + ' usuário(s) em risco:\n' + risky.map(function(r) {
                  return r.user.user_id + ' [' + r.flags.join(', ') + ']';
                }).join('\n');
            if (typeof showToast === 'function') {
              showToast(
                '<strong>' + (risky.length > 0 ? '⚠ Risco Detectado' : '✓ Sem Riscos') + '</strong> ' + msg,
                risky.length > 0 ? 'warning' : 'success', 5000
              );
            } else {
              alert(msg);
            }
          });
        }
      }
    }

    return html;
  }

  /* ── HTML builders ──────────────────────────────────────────────────────── */

  var _RISK_LABELS = {
    many_guides_zero_blueprint: '⚠ Sem blueprints',
    high_edit_after_apply:      '✏ Edita após reuso',
    inactive_recently:          '💤 Inativo'
  };

  function _buildDashboardHTML() {
    var summary = getGlobalSummary();
    var users   = getAllUsers();
    var ts      = new Date().toLocaleString('pt-BR');

    var atRisk    = summary.at_risk_users || 0;
    var riskBadge = atRisk > 0
      ? '<span class="fd-risk-badge">⚠ ' + atRisk + ' em risco</span>'
      : '<span class="fd-ok-badge">✓ Saudável</span>';

    /* ── Header ── */
    var html = '<div class="fd-header">'
      + '<div class="fd-title">📊 Painel do Fundador'
      + '  <span class="fd-version">v' + VERSION + '</span>'
      + '  ' + riskBadge
      + '</div>'
      + '<div class="fd-subtitle">Atualizado em ' + ts + '</div>'
      + '<div class="fd-actions">'
      + '  <button class="fd-btn" data-action="fd-refresh">↺ Atualizar</button>'
      + '  <button class="fd-btn fd-btn-warn" data-action="fd-risk">⚠ Detectar Riscos</button>'
      + '</div>'
      + '</div>';

    /* ── Global summary grid ── */
    var acceptanceTxt = summary.reuse_acceptance_pct !== null
      ? summary.reuse_acceptance_pct + '%' : '—';

    html += '<div class="fd-summary-grid">'
      + _fdStat('Ativos',          summary.active_users,        'fd-stat-blue')
      + _fdStat('Power Users',     summary.power_users,         'fd-stat-green')
      + _fdStat('Em Risco',        summary.at_risk_users,       atRisk > 0 ? 'fd-stat-amber' : 'fd-stat-blue')
      + _fdStat('Guias Geradas',   summary.total_guides,        'fd-stat-blue')
      + _fdStat('Blueprints',      summary.total_blueprint_applied, 'fd-stat-green')
      + _fdStat('Taxa de Reuso',   summary.reuse_rate_pct + '%','fd-stat-amber')
      + _fdStat('Aceitação Reuso', acceptanceTxt,               'fd-stat-green')
      + _fdStat('Horas Economiz.', (summary.total_hours_saved).toFixed(1) + 'h', 'fd-stat-green')
      + '</div>';

    /* ── Per-user cards ── */
    html += '<div class="fd-users-header">Usuários (' + users.length + ')</div>';
    html += '<div class="fd-user-list">';

    if (users.length === 0) {
      html += '<div class="fd-empty">Nenhum dado ainda. Gere algumas guias para começar.</div>';
    } else {
      users.forEach(function(u) {
        var flags   = u.risk_flags || [];
        var isRisky = flags.length > 0;
        var isPower = (u.reuse_count || 0) > 0 && !isRisky;

        var cardClass = 'fd-card';
        if (isRisky)       cardClass += ' fd-card-risk';
        else if (isPower)  cardClass += ' fd-card-power';

        /* status badge */
        var badge = '';
        if (isRisky) {
          badge = flags.map(function(f) {
            return '<span class="fd-badge fd-badge-risk">' + (_RISK_LABELS[f] || f) + '</span>';
          }).join(' ');
        } else if (isPower) {
          badge = '<span class="fd-badge fd-badge-power">⚡ Power</span>';
        }

        /* reuse acceptance */
        var acceptTxt = (u.reuse_acceptance_rate !== null && u.reuse_acceptance_rate !== undefined)
          ? u.reuse_acceptance_rate + '%' : '—';

        /* display email if available */
        var emailLine = u.user_email
          ? '<div class="fd-card-email">' + _escHtml(u.user_email) + '</div>'
          : '';

        html += '<div class="' + cardClass + '">'
          + '<div class="fd-card-head">'
          + '  <div class="fd-card-user-block">'
          + '    <span class="fd-card-user">' + _escHtml(u.user_id) + '</span>'
          + emailLine
          + '  </div>'
          + '  <div class="fd-card-badges">' + badge + '</div>'
          + '</div>'
          + '<div class="fd-card-stats">'
          + _fdCS(u.guides,            'Guias')
          + _fdCS(u.fresh_guides,      'Fresh')
          + _fdCS(u.blueprint_applied, 'Blueprint')
          + _fdCS(u.reuse_shown,       'Shown')
          + _fdCS(acceptTxt,           'Aceitação')
          + _fdCS((u.hours_saved || 0).toFixed(1) + 'h', 'Economiz.')
          + '</div>'
          + '<div class="fd-card-footer">'
          + '1º acesso: ' + new Date(u.first_seen).toLocaleDateString('pt-BR')
          + ' · Último: ' + new Date(u.last_activity_at || u.last_seen).toLocaleDateString('pt-BR')
          + (u.edit_after_apply_count > 0
              ? ' · Edições pós-reuso: <strong>' + u.edit_after_apply_count + '</strong>'
              : '')
          + '</div>'
          + '</div>';
      });
    }

    html += '</div>'; // .fd-user-list
    return html;
  }

  function _fdStat(label, value, cls) {
    return '<div class="fd-stat ' + cls + '">'
      + '<div class="fd-stat-val">' + value + '</div>'
      + '<div class="fd-stat-lbl">' + label + '</div>'
      + '</div>';
  }

  function _fdCS(value, label) {
    return '<div class="fd-cs">'
      + '<span class="fd-cs-val">' + value + '</span>'
      + '<span class="fd-cs-lbl">' + label + '</span>'
      + '</div>';
  }

  function _escHtml(s) {
    if (typeof s !== 'string') return String(s || '');
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /**
   * clearAll()
   * Remove todos os dados de analytics. Use apenas em dev/testes.
   */
  function clearAll() {
    Storage.remove(STORAGE_KEY);
  }

  /* =========================================================================
   * CSS DO PAINEL — injetado uma vez quando o módulo carrega no browser
   * ========================================================================= */
  (function _injectCSS() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('neuroauth-analytics-css')) return;
    var style = document.createElement('style');
    style.id  = 'neuroauth-analytics-css';
    style.textContent = [
      '#founder-dashboard { font-family: system-ui,sans-serif; font-size: 13px; color: #0e1723; }',
      '.fd-header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 12px 0 8px; border-bottom: 1px solid #dde3ec; margin-bottom: 12px; }',
      '.fd-title { font-size: 15px; font-weight: 700; color: #1b3f6b; flex: 1; }',
      '.fd-version { font-size: 10px; font-weight: 400; color: #8595a6; margin-left: 4px; }',
      '.fd-subtitle { font-size: 11px; color: #8595a6; width: 100%; }',
      '.fd-actions { display: flex; gap: 6px; }',
      '.fd-btn { padding: 4px 10px; border: 1px solid #b0bfce; border-radius: 5px; background: #fff; cursor: pointer; font-size: 12px; color: #2558a0; }',
      '.fd-btn:hover { background: #f1f4f8; }',
      '.fd-btn-warn { color: #b45309; border-color: #f59e0b; }',
      '.fd-risk-badge { font-size: 11px; background: #fef9ed; color: #b45309; border: 1px solid #f59e0b; border-radius: 99px; padding: 1px 8px; }',
      '.fd-ok-badge { font-size: 11px; background: #eaf6f1; color: #0e7a50; border: 1px solid #9dd9c0; border-radius: 99px; padding: 1px 8px; }',
      '.fd-summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-bottom: 16px; }',
      '.fd-stat { padding: 10px 12px; border-radius: 8px; background: #f8fafc; border: 1px solid #dde3ec; }',
      '.fd-stat-val { font-size: 20px; font-weight: 700; line-height: 1.1; }',
      '.fd-stat-lbl { font-size: 10px; color: #8595a6; margin-top: 2px; text-transform: uppercase; letter-spacing: .4px; }',
      '.fd-stat-blue .fd-stat-val { color: #2558a0; }',
      '.fd-stat-green .fd-stat-val { color: #0e7a50; }',
      '.fd-stat-amber .fd-stat-val { color: #b45309; }',
      '.fd-users-header { font-weight: 600; font-size: 12px; color: #3a4a5e; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .5px; }',
      '.fd-user-list { display: flex; flex-direction: column; gap: 8px; }',
      '.fd-card { border: 1px solid #dde3ec; border-radius: 8px; padding: 10px 12px; background: #fff; }',
      '.fd-card-power { border-color: #9dd9c0; background: #f4fbf7; }',
      '.fd-card-risk { border-color: #f59e0b; background: #fef9ed; }',
      '.fd-card-head { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }',
      '.fd-card-user-block { flex: 1; overflow: hidden; }',
      '.fd-card-user { font-weight: 600; color: #1b3f6b; font-size: 12px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.fd-card-email { font-size: 10px; color: #8595a6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.fd-card-badges { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }',
      '.fd-badge { font-size: 10px; padding: 1px 7px; border-radius: 99px; white-space: nowrap; }',
      '.fd-badge-power { background: #eaf6f1; color: #0e7a50; border: 1px solid #9dd9c0; }',
      '.fd-badge-risk { background: #fef9ed; color: #b45309; border: 1px solid #f59e0b; }',
      '.fd-card-stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; margin-bottom: 8px; }',
      '.fd-cs { text-align: center; }',
      '.fd-cs-val { font-size: 15px; font-weight: 700; color: #1b3f6b; display: block; }',
      '.fd-cs-lbl { font-size: 9px; color: #8595a6; text-transform: uppercase; letter-spacing: .4px; }',
      '.fd-card-footer { font-size: 10px; color: #8595a6; border-top: 1px solid #f0f4f8; padding-top: 6px; margin-top: 4px; }',
      '.fd-empty { color: #8595a6; font-style: italic; padding: 16px 0; text-align: center; }'
    ].join('\n');
    document.head.appendChild(style);
  })();

  /* =========================================================================
   * PUBLIC API EXPORT
   * ========================================================================= */
  return {
    VERSION:                VERSION,
    track:                  track,
    snapshot:               snapshot,
    getUserStats:           getUserStats,
    getAllUsers:             getAllUsers,
    getUserRiskFlags:       getUserRiskFlags,
    getGlobalSummary:       getGlobalSummary,
    detectRisk:             detectRisk,
    renderFounderDashboard: renderFounderDashboard,
    clearAll:               clearAll
  };
}));
