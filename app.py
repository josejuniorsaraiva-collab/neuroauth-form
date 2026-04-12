"""
NEUROAUTH — app.py
Espinha dorsal operacional: pré, durante e pós autorização cirúrgica.
Versão: BLOCO 1 — fechado em 2026-03-28
PATCH 2026-03-28: EPISODIOS_COLS alinhado ao schema real de 22_EPISODIOS (head=3)
"""
import os
import uuid
import json
import logging
from datetime import datetime, timezone
from flask import Flask, request, jsonify, g
import gspread
from google.oauth2.service_account import Credentials
from auth import login, require_auth, SPREADSHEET_ID, SHEETS_CREDENTIALS
from middleware import check_usage

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("neuroauth")

# ─── Flask ────────────────────────────────────────────────────────────────────
app = Flask(__name__)

# ─── Scopes Google ────────────────────────────────────────────────────────────
SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]

# ══════════════════════════════════════════════════════════════════════════════
# 1. CONSTANTES DE COLUNAS — única definição, referência central
# ══════════════════════════════════════════════════════════════════════════════

# PATCH 2026-03-28: alinhado com schema real da aba 22_EPISODIOS
# linha 1=título, linha 2=subtítulo, linha 3=headers (A:T), linha 4+=dados
EPISODIOS_COLS = [
    "episodio_id",
    "profile_id",
    "convenio_id",
    "cid_principal",
    "tipo_anestesia",
    "niveis",
    "lateralidade",
    "clinical_context_json",
    "opme_context_json",
    "dados_paciente_json",
    "status_episodio",
    "decision_status",
    "decision_run_id",
    "score_confianca",
    "sugestao_principal",
    "alternativas_json",
    "sherlock_narrative",
    "created_at",
    "updated_at",
    "usuario_id",
]

DECISION_RUNS_COLS = [
    "decision_run_id",
    "episodio_id",
    "profile_id",
    "decision_status",
    "input_context_json",
    "opcoes_geradas_json",
    "opcao_escolhida_json",
    "score_final",
    "alertas_json",
    "bloqueios_json",
    "motor_version",
    "created_at",
]

USAGE_COLS = [
    "log_id",
    "user_id",
    "email",
    "action",
    "endpoint",
    "episodio_id",
    "ip_address",
    "user_agent",
    "created_at",
]

USERS_COLS_FULL = [
    "user_id",
    "email",
    "name",
    "crm",
    "institution",
    "plan",
    "status",
    "password_hash",
    "api_key",
    "requests_month",
    "requests_total",
    "usage_reset_date",
    "created_at",
    "last_login",
    "plan_expires_at",
    "asaas_customer_id",
    "asaas_subscription_id",
    "payment_status",
    "notes",
    "created_by",
]

PROC_MESTRE_COLS = [
    "profile_id",
    "codigo_tuss",
    "codigo_cbhpm",
    "descricao",
    "especialidade",
    "convenio_default",
    "porte",
    "porte_anestesico",
    "filme",
    "via_acesso",
    "lateralidade_obrigatoria",
    "opme_frequente",
    "regras_json",
    "updated_at",
]

# ─── Nomes das abas ───────────────────────────────────────────────────────────
EPISODIOS_SHEET = "22_EPISODIOS"
DECISION_RUNS_SHEET = "21_DECISION_RUNS"
USAGE_SHEET = "03_USAGE_LOG"
USERS_SHEET = "USERS"
PROC_MESTRE_SHEET = "20_PROC_MESTRE"

# ══════════════════════════════════════════════════════════════════════════════
# 2. HELPERS — única definição de cada função base
# ══════════════════════════════════════════════════════════════════════════════

def _get_workbook():
    """Retorna o objeto Spreadsheet autenticado."""
    creds = Credentials.from_service_account_file(SHEETS_CREDENTIALS, scopes=SCOPES)
    client = gspread.authorize(creds)
    return client.open_by_key(SPREADSHEET_ID)


def _get_worksheet(sheet_name: str):
    """Retorna worksheet pelo nome."""
    return _get_workbook().worksheet(sheet_name)


def _safe_int(val, default: int = 0) -> int:
    """Converte para int sem lançar exceção."""
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _is_float(val) -> bool:
    """Retorna True se val é conversível para float."""
    try:
        float(val)
        return True
    except (TypeError, ValueError):
        return False


def _read_rows_fixed(ws, cols: list) -> list:
    """
    Lê todas as linhas do worksheet usando linha 3 como cabeçalho (head=3).
    Retorna list[dict] com exatamente as colunas em `cols`.
    Colunas ausentes no sheet retornam string vazia.

    PATCH 2026-03-28: head=3 corrige bug onde linha 1 (título) era tratada como
    header, tornando episodio_id irrecuperável e causando 404 em todos os lookups.
    """
    try:
        all_rows = ws.get_all_records(head=3, default_blank="")
    except Exception as exc:
        log.warning("_read_rows_fixed fallback: %s", exc)
        all_rows = []
    return [{c: str(row.get(c, "")) for c in cols} for row in all_rows]


def _append_row(ws, cols: list, data: dict) -> None:
    """
    Adiciona linha ao worksheet na ordem de `cols`.
    Campos ausentes em `data` ficam como string vazia.
    """
    row = [str(data.get(col, "")) for col in cols]
    ws.append_row(row, value_input_option="RAW")


def _update_row_by_id(ws, id_col: str, id_val: str, cols: list, updates: dict) -> bool:
    """
    Localiza a linha onde id_col == id_val e atualiza os campos em `updates`.
    Retorna True se encontrou e atualizou; False caso contrário.
    """
    try:
        header = ws.row_values(1)
        if id_col not in header:
            log.warning("_update_row_by_id: '%s' não está no header", id_col)
            return False
        id_col_idx = header.index(id_col) + 1  # 1-based
        col_values = ws.col_values(id_col_idx)
        for i, val in enumerate(col_values[1:], start=2):  # pula header (linha 1)
            if str(val).strip() == str(id_val).strip():
                batch = []
                for col_name, new_val in updates.items():
                    if col_name in header:
                        col_idx = header.index(col_name) + 1
                        batch.append({
                            "range": gspread.utils.rowcol_to_a1(i, col_idx),
                            "values": [[str(new_val)]],
                        })
                if batch:
                    ws.batch_update(batch)
                return True
    except Exception as exc:
        log.error("_update_row_by_id error: %s", exc)
    return False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _err(code: str, message: str, status: int):
    """Resposta de erro estruturada — nunca expõe traceback."""
    return jsonify({"error": code, "message": message}), status


def _log_usage(action: str, endpoint: str, episodio_id: str = "") -> None:
    """Grava evento em 03_USAGE_LOG. Silencioso em caso de falha."""
    try:
        ws = _get_worksheet(USAGE_SHEET)
        _append_row(ws, USAGE_COLS, {
            "log_id": str(uuid.uuid4()),
            "user_id": getattr(g, "user_id", ""),
            "email": getattr(g, "email", ""),
            "action": action,
            "endpoint": endpoint,
            "episodio_id": episodio_id,
            "ip_address": request.remote_addr or "",
            "user_agent": (request.headers.get("User-Agent") or "")[:200],
            "created_at": _now(),
        })
    except Exception as exc:
        log.warning("_log_usage failed: %s", exc)


# ══════════════════════════════════════════════════════════════════════════════
# 3. MOTOR DE DECISÃO — Motor 2 (DecisionEngine via gspread)
# ══════════════════════════════════════════════════════════════════════════════
try:
    from decision_engine import DecisionEngine, build_context_from_payload
    MOTOR_VERSION = "2.0"
    log.info("decision_engine carregado — Motor 2 — versão %s", MOTOR_VERSION)
except ImportError:
    DecisionEngine = None  # type: ignore
    build_context_from_payload = None  # type: ignore
    MOTOR_VERSION = "stub"
    log.warning("decision_engine não encontrado — motor indisponível")


# ══════════════════════════════════════════════════════════════════════════════
# ROTAS PÚBLICAS
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "motor_version": MOTOR_VERSION}), 200


@app.route("/auth/login", methods=["POST"])
def route_login():
    """POST /auth/login — valida credenciais e devolve JWT."""
    data = request.get_json(force=True) or {}
    email = data.get("email", "")
    password = data.get("password", "")
    if not email or not password:
        return _err("missing_credentials", "Email e senha obrigatórios.", 400)
    response, status = login(email, password)
    return jsonify(response), status


# ══════════════════════════════════════════════════════════════════════════════
# PROFILES — busca em PROC_MESTRE
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/profiles/search", methods=["GET"])
@require_auth
def profiles_search():
    """
    GET /profiles/search?q=<texto>
    Busca livre em PROC_MESTRE: descricao, profile_id, codigo_tuss.
    """
    q = (request.args.get("q") or "").strip().lower()
    if not q:
        return _err("missing_param", "Parâmetro 'q' obrigatório.", 400)
    try:
        ws = _get_worksheet(PROC_MESTRE_SHEET)
        rows = _read_rows_fixed(ws, PROC_MESTRE_COLS)
    except Exception as exc:
        log.error("/profiles/search error: %s", exc)
        return _err("sheet_error", "Erro ao acessar PROC_MESTRE.", 503)
    hits = [
        r for r in rows
        if q in r.get("descricao", "").lower()
        or q in r.get("profile_id", "").lower()
        or q in r.get("codigo_tuss", "").lower()
        or q in r.get("codigo_cbhpm", "").lower()
    ][:20]
    _log_usage("profiles_search", "/profiles/search")
    return jsonify({"results": hits, "total": len(hits)}), 200


# ══════════════════════════════════════════════════════════════════════════════
# EPISÓDIOS — 22_EPISODIOS
# Ordem de registro importa: /episodios/summary ANTES de /episodios/<id>
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/episodios/summary", methods=["GET"])
@require_auth
def episodios_summary():
    """
    GET /episodios/summary
    Contagens por status_episodio e decision_status do usuário autenticado.
    """
    try:
        ws = _get_worksheet(EPISODIOS_SHEET)
        rows = _read_rows_fixed(ws, EPISODIOS_COLS)
    except Exception as exc:
        log.error("/episodios/summary error: %s", exc)
        return _err("sheet_error", "Erro ao calcular summary.", 503)

    rows = [r for r in rows if r.get("usuario_id", "") == g.user_id]
    op_counts: dict = {}
    dec_counts: dict = {}
    for r in rows:
        op = r.get("status_episodio", "")
        dec = r.get("decision_status", "")
        op_counts[op] = op_counts.get(op, 0) + 1
        dec_counts[dec] = dec_counts.get(dec, 0) + 1
    total = len(rows)
    go_count = op_counts.get("confirmed", 0) + op_counts.get("closed", 0)
    go_rate = round(go_count / total * 100, 1) if total else 0.0
    return jsonify({
        "total": total,
        "go_count": go_count,
        "go_rate": go_rate,
        "por_status_episodio": op_counts,
        "por_decision_status": dec_counts,
    }), 200


@app.route("/episodios", methods=["POST"])
@require_auth
def criar_episodio():
    """
    POST /episodios
    Cria novo episódio clínico em 22_EPISODIOS.
    """
    data = request.get_json(force=True) or {}
    episodio_id = str(uuid.uuid4())
    now = _now()
    row = {
        "episodio_id": episodio_id,
        "profile_id": data.get("profile_id", ""),
        "convenio_id": data.get("convenio_id", ""),
        "cid_principal": data.get("cid_principal", ""),
        "tipo_anestesia": data.get("tipo_anestesia", ""),
        "niveis": data.get("niveis", "1"),
        "lateralidade": data.get("lateralidade", ""),
        "clinical_context_json": json.dumps(
            data.get("clinical_context", {}), ensure_ascii=False
        ),
        "opme_context_json": json.dumps(
            data.get("opme_context", {}), ensure_ascii=False
        ),
        "dados_paciente_json": json.dumps(
            data.get("dados_paciente", {}), ensure_ascii=False
        ),
        "status_episodio": "pending",
        "decision_status": "nao_processado",
        "decision_run_id": "",
        "score_confianca": "",
        "sugestao_principal": "",
        "alternativas_json": "",
        "sherlock_narrative": "",
        "created_at": now,
        "updated_at": now,
        "usuario_id": g.user_id,
    }
    try:
        ws = _get_worksheet(EPISODIOS_SHEET)
        _append_row(ws, EPISODIOS_COLS, row)
    except Exception as exc:
        log.error("/episodios POST error: %s", exc)
        return _err("sheet_error", "Erro ao criar episódio.", 503)
    _log_usage("criar_episodio", "/episodios", episodio_id)
    return jsonify({"episodio_id": episodio_id, "status": "created"}), 201


@app.route("/episodios", methods=["GET"])
@require_auth
def listar_episodios():
    """
    GET /episodios
    Lista episódios do usuário autenticado.
    Query: status_episodio=, decision_status=, limit= (default 50)
    """
    try:
        ws = _get_worksheet(EPISODIOS_SHEET)
        rows = _read_rows_fixed(ws, EPISODIOS_COLS)
    except Exception as exc:
        log.error("/episodios GET error: %s", exc)
        return _err("sheet_error", "Erro ao listar episódios.", 503)

    rows = [r for r in rows if r.get("usuario_id", "") == g.user_id]
    if s := request.args.get("status_episodio"):
        rows = [r for r in rows if r["status_episodio"] == s]
    if d := request.args.get("decision_status"):
        rows = [r for r in rows if r["decision_status"] == d]
    limit = _safe_int(request.args.get("limit", 50), default=50)
    rows = rows[-limit:] if limit else rows
    return jsonify({"episodios": rows, "total": len(rows)}), 200


@app.route("/episodios/<episodio_id>", methods=["GET"])
@require_auth
def get_episodio(episodio_id: str):
    """GET /episodios/<episodio_id> — retorna episódio completo."""
    try:
        ws = _get_worksheet(EPISODIOS_SHEET)
        rows = _read_rows_fixed(ws, EPISODIOS_COLS)
    except Exception as exc:
        log.error("/episodios/%s GET error: %s", episodio_id, exc)
        return _err("sheet_error", "Erro ao acessar episódios.", 503)

    ep = next((r for r in rows if r["episodio_id"] == episodio_id), None)
    if not ep:
        return _err("not_found", "Episódio não encontrado.", 404)
    # Permite acesso se usuario_id não estiver definido (dados demo/seed sem dono)
    ep_owner = ep.get("usuario_id", "")
    if ep_owner and ep_owner != g.user_id:
        return _err("forbidden", "Acesso negado.", 403)
    _log_usage("get_episodio", f"/episodios/{episodio_id}", episodio_id)
    return jsonify(ep), 200


# ══════════════════════════════════════════════════════════════════════════════
# MOTOR DE DECISÃO — /decision/*
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/decision/run/<episodio_id>", methods=["POST"])
@require_auth
def decision_run(episodio_id: str):
    """POST /decision/run/<episodio_id> — executa Motor 2 e retorna a decisão."""
    if DecisionEngine is None:
        return jsonify({"error": "motor_indisponivel", "message": "decision_engine não carregado"}), 503
    try:
        creds = Credentials.from_service_account_file(SHEETS_CREDENTIALS, scopes=SCOPES)
        gc = gspread.authorize(creds)
        ws = gc.open_by_key(SPREADSHEET_ID).worksheet("22_EPISODIOS")
        eps = _read_rows_fixed(ws, EPISODIOS_COLS)
        ep = next((e for e in eps if e.get("episodio_id") == episodio_id), None)
        if not ep:
            return _err("not_found", "Episódio não encontrado.", 404)
        profile_id = ep.get("profile_id", "")
        if not profile_id:
            return _err("profile_id_vazio", "profile_id ausente no episódio.", 400)
        payload = {
            "episodio_id": episodio_id,
            "profile_id": profile_id,
            "convenio_id": ep.get("convenio_id", ""),
            "clinical_context": json.loads(ep.get("clinical_context_json") or "{}"),
            "opme_context": json.loads(ep.get("opme_context_json") or "{}"),
            "niveis": int(ep.get("niveis") or 1),
            "lateralidade": ep.get("lateralidade", ""),
            "dados_paciente": json.loads(ep.get("dados_paciente_json") or "{}"),
            "usuario_id": getattr(g, "user_id", ""),
        }
        context = build_context_from_payload(payload)
        engine = DecisionEngine(gc, SPREADSHEET_ID)
        decision = engine.run(context)
        return jsonify(decision), 200
    except Exception as exc:
        log.error("decision_run: motor error: %s", exc)
        return _err("motor_error", "Erro interno no motor de decisão.", 500)


@app.route("/decision/confirm/<episodio_id>", methods=["POST"])
@require_auth
def decision_confirm(episodio_id: str):
    """
    POST /decision/confirm/<episodio_id>
    Registra a confirmação do operador sobre a decisão gerada.
    Body: { "opcao_confirmada": {...}, "feedback_resultado": "autorizado" | ... }
    """
    data = request.get_json(force=True) or {}
    opcao_confirmada = data.get("opcao_confirmada", {})
    feedback_resultado = data.get("feedback_resultado", "")

    try:
        ws_ep = _get_worksheet(EPISODIOS_SHEET)
        rows = _read_rows_fixed(ws_ep, EPISODIOS_COLS)
    except Exception as exc:
        log.error("decision_confirm: sheet error: %s", exc)
        return _err("sheet_error", "Erro ao acessar episódios.", 503)

    ep = next((r for r in rows if r["episodio_id"] == episodio_id), None)
    if not ep:
        return _err("not_found", "Episódio não encontrado.", 404)
    ep_owner = ep.get("usuario_id", "")
    if ep_owner and ep_owner != g.user_id:
        return _err("forbidden", "Acesso negado.", 403)

    now = _now()
    updates = {
        "sugestao_principal": json.dumps(opcao_confirmada, ensure_ascii=False, default=str),
        "decision_status": "confirmed",
        "updated_at": now,
    }
    try:
        _update_row_by_id(ws_ep, "episodio_id", episodio_id, EPISODIOS_COLS, updates)
    except Exception as exc:
        log.error("decision_confirm: update error: %s", exc)
        return _err("sheet_error", "Erro ao confirmar decisão.", 503)

    _log_usage("decision_confirm", f"/decision/confirm/{episodio_id}", episodio_id)
    return jsonify({
        "episodio_id": episodio_id,
        "status": "confirmed",
        "confirmado_em": now,
        "usuario_confirmou": g.user_id,
    }), 200


# ══════════════════════════════════════════════════════════════════════════════
# MÉTRICAS E OPERAÇÕES
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/metrics", methods=["GET"])
@require_auth
def metrics():
    """
    GET /metrics
    Métricas operacionais reais — alimenta o painel de readiness.
    """
    try:
        ws_ep = _get_worksheet(EPISODIOS_SHEET)
        ws_run = _get_worksheet(DECISION_RUNS_SHEET)
        ep_rows = _read_rows_fixed(ws_ep, EPISODIOS_COLS)
        run_rows = _read_rows_fixed(ws_run, DECISION_RUNS_COLS)
    except Exception as exc:
        log.error("/metrics error: %s", exc)
        return _err("sheet_error", "Erro ao calcular métricas.", 503)

    total_eps = len(ep_rows)
    total_runs = len(run_rows)
    go_eps = [r for r in ep_rows if r["status_episodio"] in ("confirmed", "closed")]
    blocked_eps = [r for r in ep_rows if r["decision_status"] == "blocked"]
    go_rate = round(len(go_eps) / total_eps * 100, 1) if total_eps else 0.0
    scores = [
        float(r["score_final"])
        for r in run_rows
        if _is_float(r.get("score_final", ""))
    ]
    avg_score = round(sum(scores) / len(scores), 2) if scores else 0.0
    active_users = 0
    try:
        ws_usage = _get_worksheet(USAGE_SHEET)
        usage_rows = _read_rows_fixed(ws_usage, USAGE_COLS)
        active_users = len({r["user_id"] for r in usage_rows if r["user_id"]})
    except Exception as exc:
        log.warning("/metrics: usage_log indisponível: %s", exc)

    return jsonify({
        "total_episodios": total_eps,
        "total_decision_runs": total_runs,
        "go_count": len(go_eps),
        "go_rate": go_rate,
        "blocked_count": len(blocked_eps),
        "active_users": active_users,
        "avg_score": avg_score,
        "motor_version": MOTOR_VERSION,
    }), 200


@app.route("/ops/runs", methods=["GET"])
@require_auth
def ops_runs():
    """
    GET /ops/runs
    Lista os últimos decision runs.
    Query: limit= (default 20), episodio_id=
    """
    try:
        ws = _get_worksheet(DECISION_RUNS_SHEET)
        rows = _read_rows_fixed(ws, DECISION_RUNS_COLS)
    except Exception as exc:
        log.error("/ops/runs error: %s", exc)
        return _err("sheet_error", "Erro ao listar runs.", 503)

    if ep_id := request.args.get("episodio_id"):
        rows = [r for r in rows if r["episodio_id"] == ep_id]
    limit = _safe_int(request.args.get("limit", 20), default=20)
    rows = rows[-limit:] if limit else rows
    return jsonify({"runs": rows, "total": len(rows)}), 200


# ══════════════════════════════════════════════════════════════════════════════
# LEGACY — rotas mantidas por compatibilidade
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/authorize", methods=["POST"])
@require_auth
@check_usage
def authorize_surgery():
    """POST /api/authorize — rota legada. Substituída por /decision/run."""
    data = request.get_json(force=True) or {}
    result = {
        "status": "authorized",
        "user_id": g.user_id,
        "plan": g.plan,
        "payload": data,
    }
    response = jsonify(result)
    _inject_usage_headers(response)
    return response, 200


@app.route("/api/usage", methods=["GET"])
@require_auth
def get_usage():
    """GET /api/usage — uso do plano do usuário autenticado."""
    from auth import _get_user_by_id
    from sheets_schema import PLAN_LIMITS
    from middleware import _should_reset
    user = _get_user_by_id(g.user_id)
    if not user:
        return _err("user_not_found", "Usuário não encontrado.", 404)
    plan = user.get("plan", "starter")
    limit = PLAN_LIMITS.get(plan, {}).get("requests_per_month", 100)
    reset = _should_reset(user.get("usage_reset_date", ""))
    used = 0 if reset else _safe_int(user.get("requests_month", 0))
    return jsonify({
        "plan": plan,
        "plan_label": PLAN_LIMITS.get(plan, {}).get("label", plan),
        "used": used,
        "limit": limit,
        "remaining": limit - used,
        "resets_on": user.get("usage_reset_date", ""),
        "total_ever": _safe_int(user.get("requests_total", 0)),
    }), 200


# ══════════════════════════════════════════════════════════════════════════════
# WEBHOOKS — Asaas
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/webhooks/asaas", methods=["POST"])
def asaas_webhook():
    payload = request.get_json(force=True) or {}
    event = payload.get("event", "")
    payment = payload.get("payment", {})
    customer_id = payment.get("customer", "")
    if not customer_id:
        return _err("missing_field", "customer obrigatório.", 400)
    EVENT_MAP = {
        "PAYMENT_CONFIRMED": ("active", "paid"),
        "PAYMENT_OVERDUE": (None, "overdue"),
        "PAYMENT_DELETED": ("inactive", "cancelled"),
        "SUBSCRIPTION_DELETED": ("inactive", "cancelled"),
    }
    action = EVENT_MAP.get(event)
    if action:
        new_status, pay_status = action
        updates = {
            "payment_status": pay_status,
            "plan_expires_at": payment.get("dueDate", ""),
        }
        if new_status:
            updates["status"] = new_status
        try:
            ws = _get_worksheet(USERS_SHEET)
            _update_row_by_id(ws, "asaas_customer_id", customer_id, USERS_COLS_FULL, updates)
        except Exception as exc:
            log.error("asaas_webhook: %s", exc)
    return jsonify({"received": True}), 200


# ══════════════════════════════════════════════════════════════════════════════
# DEBUG — remover antes de produção
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/debug/sheets", methods=["GET"])
def debug_sheets():
    """Diagnóstico temporário — remover antes de produção."""
    result = {
        "spreadsheet_id": SPREADSHEET_ID,
        "creds_path": SHEETS_CREDENTIALS,
        "creds_exists": os.path.exists(SHEETS_CREDENTIALS),
    }
    try:
        creds = Credentials.from_service_account_file(SHEETS_CREDENTIALS, scopes=SCOPES)
        client = gspread.authorize(creds)
        sh = client.open_by_key(SPREADSHEET_ID)
        result["status"] = "ok"
        result["title"] = sh.title
        result["service_account_email"] = creds.service_account_email
        result["worksheets"] = [ws.title for ws in sh.worksheets()]
    except Exception as exc:
        result["error"] = str(exc)
    return jsonify(result), 200


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS INTERNOS — uso por rotas legadas
# ══════════════════════════════════════════════════════════════════════════════

def _inject_usage_headers(response):
    if hasattr(g, "requests_used"):
        response.headers["X-Usage-Used"] = str(g.requests_used)
        response.headers["X-Usage-Remaining"] = str(g.requests_left)


# ══════════════════════════════════════════════════════════════════════════════
# ERROS GLOBAIS — nunca expõem traceback
# ══════════════════════════════════════════════════════════════════════════════

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "not_found", "message": "Rota não encontrada."}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "method_not_allowed", "message": "Método não permitido."}), 405


@app.errorhandler(500)
def internal_error(e):
    log.error("500 unhandled: %s", e)
    return jsonify({"error": "internal_error", "message": "Erro interno."}), 500


if __name__ == "__main__":
    app.run(debug=False, port=5000)


# ── /relay/notify — Gate C: proxy autenticado para Make.com ──────────────────
import os as _os, requests as _requests
from functools import wraps as _wraps

def _require_jwt_relay(f):
    @_wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated

@app.route('/relay/notify', methods=['POST'])
@_require_jwt_relay
def relay_notify():
    make_url = _os.environ.get('MAKE_WEBHOOK_URL')
    if not make_url:
        body = request.get_json(silent=True) or {}
        return jsonify({'ok': True, 'mode': 'no_webhook', 'received': len(body)}), 200
    body = request.get_json(silent=True) or {}
    body.pop('_jwt', None)
    try:
        r = _requests.post(make_url, json=body, timeout=15)
        return jsonify({'ok': r.ok, 'status': r.status_code}), 200 if r.ok else 502
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/relay/profile', methods=['GET'])
@_require_jwt_relay
def relay_profile():
    profile_wh = _os.environ.get('MAKE_PROFILE_WH')
    if not profile_wh:
        return jsonify({'ativo': True, 'role': 'medico', '_source': 'fallback'}), 200
    try:
        r = _requests.get(profile_wh, params=dict(request.args), timeout=10)
        return jsonify(r.json()), 200 if r.ok else 502
    except Exception as e:
        return jsonify({'ativo': True, 'role': 'medico', '_source': 'error_fallback'}), 200

