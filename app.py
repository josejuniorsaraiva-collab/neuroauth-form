"""
app.py â NEUROAUTH Motor 1
ServiÃ§o FastAPI de AutorizaÃ§Ã£o CirÃºrgica

Endpoints:
  GET  /health
  POST /episodios
  GET  /episodios
  GET  /episodios/{id}
  POST /episodios/{id}/validar
  POST /episodios/{id}/resolver-pendencia
  POST /episodios/{id}/transicionar
  POST /submit   â compatibilidade com index.html legado
"""

import uuid
import json
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import FastAPI, HTTPException, Path, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from motor1 import episode_store as store
from motor1 import workflow_engine as workflow
from motor1 import validator_engine as validator
from motor1 import pendencia_engine as pendencias

# ââ INIT ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

store.init_db()

app = FastAPI(
    title="NEUROAUTH Motor 1",
    description="Motor de AutorizaÃ§Ã£o CirÃºrgica â v1.0.0",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ââ HELPERS âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _novo_id() -> str:
    return str(uuid.uuid4())

def _err(status: int, codigo: str, mensagem: str, **extras) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={"erro": codigo, "mensagem": mensagem, **extras},
    )

def _get_episodio_ou_404(id_episodio: str) -> dict:
    ep = store.get_episodio(id_episodio)
    if not ep:
        raise _err(404, "episodio_nao_encontrado",
                   f"EpisÃ³dio '{id_episodio}' nÃ£o encontrado.")
    return ep

def _registrar(id_episodio: str, tipo: str, origem: str,
               estado_antes: Optional[str] = None,
               estado_depois: Optional[str] = None,
               dados: Optional[dict] = None):
    store.append_evento(
        id_episodio=id_episodio,
        id_evento=_novo_id(),
        tipo=tipo,
        origem=origem,
        estado_antes=estado_antes,
        estado_depois=estado_depois,
        dados=dados,
    )

def _montar_resposta(id_episodio: str) -> dict:
    ep   = store.get_episodio(id_episodio)
    pend = store.get_pendencias(id_episodio)
    tl   = store.get_timeline(id_episodio)
    dados = json.loads(ep["dados"])

    bloqueantes = sum(1 for p in pend if p["bloqueia_envio"] and p["status"] == "aberta")

    return {
        "id_episodio":   ep["id_episodio"],
        "request_id":    ep["request_id"],
        "estado_atual":  ep["estado_atual"],
        "criado_em":     ep["criado_em"],
        "atualizado_em": ep["atualizado_em"],
        "dados":         dados,
        "pendencias": {
            "total":         len(pend),
            "abertas":       sum(1 for p in pend if p["status"] == "aberta"),
            "bloqueantes":   bloqueantes,
            "pode_revalidar": bloqueantes == 0,
            "itens":         pend,
        },
        "timeline": {
            "total":  len(tl),
            "eventos": tl,
        },
        "transicoes_permitidas": workflow.transicoes_permitidas(ep["estado_atual"]),
    }


# ââ PIPELINE DE VALIDAÃÃO (interno) ââââââââââââââââââââââââââââââââââââââââââ

def _executar_pipeline_validacao(id_episodio: str, dados: dict, rodada: int = 1):
    """
    Executa os 4 checks e transiciona o estado conforme resultado.
    Chamado apÃ³s criaÃ§Ã£o e apÃ³s revalidaÃ§Ã£o.
    """
    estado_antes = store.get_episodio(id_episodio)["estado_atual"]

    # â validacao
    store.update_estado(id_episodio, "validacao")
    _registrar(id_episodio, "estado_alterado", "motor_1",
               estado_antes=estado_antes, estado_depois="validacao",
               dados={"rodada": rodada})
    _registrar(id_episodio, "validacao_iniciada", "motor_1",
               dados={"rodada": rodada, "checks": ["completude", "clinico", "regulatorio", "cobertura"]})

    resultado = validator.executar(dados)

    _registrar(id_episodio, "validacao_concluida", "motor_1",
               dados=resultado.to_dict())

    novas = pendencias.criar_pendencias_do_resultado(id_episodio, resultado.todas_pendencias)

    for p in novas:
        _registrar(id_episodio, "pendencia_criada", "motor_1",
                   dados={"id_pendencia": p["id_pendencia"],
                          "tipo": p["tipo"],
                          "campo": p["campo_afetado"],
                          "bloqueia": bool(p["bloqueia_envio"])})

    if resultado.aprovado:
        store.update_estado(id_episodio, "em_analise")
        _registrar(id_episodio, "estado_alterado", "motor_1",
                   estado_antes="validacao", estado_depois="em_analise",
                   dados={"rodada": rodada, "motivo": "Todos os checks aprovados"})
    else:
        store.update_estado(id_episodio, "pendente_complemento")
        _registrar(id_episodio, "estado_alterado", "motor_1",
                   estado_antes="validacao", estado_depois="pendente_complemento",
                   dados={"rodada": rodada,
                          "total_pendencias_novas": len(novas),
                          "motivo": f"{len(novas)} pendÃªncia(s) encontrada(s)"})
        _registrar(id_episodio, "comunicacao_disparada", "motor_1",
                   dados={"canal": "whatsapp", "destinatario": "operador",
                          "template": "pendencias_identificadas",
                          "total": len(novas)})

    return resultado


# ââ MODELS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

class CriarEpisodioRequest(BaseModel):
    request_id: str = Field(..., description="UUID v4 â obrigatÃ³rio para idempotÃªncia")
    identificacao_caso: dict
    paciente: dict
    medico: dict
    hospital: dict
    convenio: dict
    procedimento_principal: dict
    opme: Optional[dict] = None
    metadata: Optional[dict] = None

    model_config = {"extra": "allow"}


class TransicionarRequest(BaseModel):
    estado_destino: str
    origem_acao: str = "operador"
    observacao: Optional[str] = None
    request_id: Optional[str] = None
    # Campos extras por estado
    numero_autorizacao: Optional[str] = None
    validade_autorizacao: Optional[str] = None
    motivo_negativa: Optional[str] = None
    codigo_negativa_tiss: Optional[str] = None
    valor_autorizado: Optional[float] = None


class ResolverPendenciaRequest(BaseModel):
    id_pendencia: str
    resolucao: str = Field(..., min_length=10,
                           description="DescriÃ§Ã£o da resoluÃ§Ã£o â mÃ­nimo 10 chars")
    resolvido_por: str = "operador"


# ââ ENDPOINTS âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

@app.get("/health")
def health():
    ep_count = len(store.list_episodios(limite=1000))
    return {
        "status":  "ok",
        "motor":   "1",
        "versao":  "1.0.0",
        "db_path": store.DB_PATH,
        "episodios_total": ep_count,
        "timestamp": _now(),
    }


@app.get("/episodios")
def listar_episodios(limite: int = 20):
    eps = store.list_episodios(limite=limite)
    return {"total": len(eps), "episodios": eps}


@app.post("/episodios", status_code=201)
def criar_episodio(req: CriarEpisodioRequest):
    """
    Cria um novo episÃ³dio cirÃºrgico e dispara validaÃ§Ã£o automaticamente.
    Idempotente por request_id.
    """
    # IdempotÃªncia
    existente = store.get_by_request_id(req.request_id)
    if existente:
        return {
            **_montar_resposta(existente["id_episodio"]),
            "idempotente": True,
        }

    id_episodio = _novo_id()
    dados = req.model_dump(exclude={"request_id"})

    store.create_episodio(id_episodio, req.request_id, dados)

    _registrar(id_episodio, "episodio_criado", "formulario_web",
               estado_depois="preenchimento",
               dados={"request_id": req.request_id,
                      "tipo_atendimento": req.identificacao_caso.get("tipo_atendimento"),
                      "convenio": req.convenio.get("id_convenio"),
                      "tuss": req.procedimento_principal.get("codigo_tuss")})

    # ValidaÃ§Ã£o automÃ¡tica
    _executar_pipeline_validacao(id_episodio, dados, rodada=1)

    return _montar_resposta(id_episodio)


@app.get("/episodios/{id_episodio}")
def ler_episodio(id_episodio: str = Path(...)):
    _get_episodio_ou_404(id_episodio)
    return _montar_resposta(id_episodio)


@app.post("/episodios/{id_episodio}/validar")
def revalidar(id_episodio: str = Path(...)):
    """
    Re-executa o pipeline de validaÃ§Ã£o.
    SÃ³ permitido a partir do estado 'pendente_complemento'
    e sem pendÃªncias bloqueantes abertas.
    """
    ep = _get_episodio_ou_404(id_episodio)

    if ep["estado_atual"] != "pendente_complemento":
        raise _err(422, "revalidacao_invalida",
                   "RevalidaÃ§Ã£o sÃ³ permitida a partir de 'pendente_complemento'.",
                   estado_atual=ep["estado_atual"])

    bloqueantes = store.count_bloqueantes_abertas(id_episodio)
    if bloqueantes > 0:
        raise _err(409, "pendencias_bloqueantes",
                   f"Resolva as {bloqueantes} pendÃªncia(s) bloqueante(s) antes de revalidar.",
                   total_bloqueantes=bloqueantes)

    dados = json.loads(ep["dados"])
    rodada = len([e for e in store.get_timeline(id_episodio)
                  if e["tipo"] == "validacao_iniciada"]) + 1

    _registrar(id_episodio, "revalidacao_solicitada", "operador",
               dados={"rodada": rodada})

    _executar_pipeline_validacao(id_episodio, dados, rodada=rodada)

    return _montar_resposta(id_episodio)


@app.post("/episodios/{id_episodio}/resolver-pendencia")
def resolver_pendencia(
    id_episodio: str = Path(...),
    req: ResolverPendenciaRequest = Body(...),
):
    """
    Resolve uma pendÃªncia especÃ­fica.
    NÃ£o dispara revalidaÃ§Ã£o automaticamente â operador controla o momento.
    """
    ep = _get_episodio_ou_404(id_episodio)

    try:
        p = pendencias.resolver(
            id_episodio=id_episodio,
            id_pendencia=req.id_pendencia,
            resolucao=req.resolucao,
            resolvido_por=req.resolvido_por,
        )
    except ValueError as e:
        raise _err(422, "resolucao_invalida", str(e))

    _registrar(id_episodio, "pendencia_resolvida", req.resolvido_por,
               dados={"id_pendencia": req.id_pendencia,
                      "tipo": p["tipo"],
                      "resolucao": req.resolucao})

    resumo = pendencias.listar(id_episodio)

    return {
        "id_episodio":       id_episodio,
        "pendencia_resolvida": p,
        "pendencias_restantes": {
            "abertas":     resumo["abertas"],
            "bloqueantes": resumo["bloqueantes"],
            "pode_revalidar": resumo["pode_revalidar"],
        },
    }


@app.post("/episodios/{id_episodio}/transicionar")
def transicionar(
    id_episodio: str = Path(...),
    req: TransicionarRequest = Body(...),
):
    """
    Executa uma transiÃ§Ã£o de estado manual.
    Motor 1 nÃ£o permite bypass de pendÃªncias bloqueantes.
    Campos obrigatÃ³rios por estado sÃ£o validados aqui.
    """
    ep = _get_episodio_ou_404(id_episodio)
    estado_atual  = ep["estado_atual"]
    estado_destino = req.estado_destino

    dados_extras = {
        k: v for k, v in {
            "numero_autorizacao":  req.numero_autorizacao,
            "validade_autorizacao": req.validade_autorizacao,
            "motivo_negativa":     req.motivo_negativa,
            "codigo_negativa_tiss": req.codigo_negativa_tiss,
            "valor_autorizado":    req.valor_autorizado,
        }.items() if v is not None
    }

    # Validar transiÃ§Ã£o
    try:
        workflow.validar_transicao(estado_atual, estado_destino)
    except workflow.WorkflowError as e:
        _registrar(id_episodio, "transicao_invalida_tentada", req.origem_acao,
                   dados={"de": estado_atual, "para": estado_destino,
                          "erro": e.codigo})
        raise HTTPException(status_code=422, detail=e.to_dict())

    # Validar bloqueio por pendÃªncias
    bloqueantes = store.count_bloqueantes_abertas(id_episodio)
    try:
        workflow.validar_sem_bloqueio(estado_destino, bloqueantes)
    except workflow.BloqueioError as e:
        raise HTTPException(status_code=409, detail=e.to_dict())

    # Validar campos obrigatÃ³rios por extado de destino
    try:
        workflow.validar_dados_estado(estado_destino, dados_extras)
    except workflow.WorkflowError as e:
        raise HTTPException(status_code=422, detail=e.to_dict())

    # Executar transiÃ§Ã£o
    store.update_estado(id_episodio, estado_destino)
    _registrar(id_episodio, "estado_alterado", req.origem_acao,
               estado_antes=estado_atual, estado_depois=estado_destino,
               dados={"observacao": req.observacao, **dados_extras})

    # AÃ§Ãµes por estado de destino
    if estado_destino == "negado":
        _registrar(id_episodio, "alerta_critico_disparado", "motor_1",
                   dados={"motivo": "Estado 'negado' atingido",
                          "canal": "whatsapp",
                          "destinatario": "medico + operador",
                          "template": "autorizacao_negada",
                          "motivo_negativa": req.motivo_negativa})

    if estado_destino == "autorizado":
        _registrar(id_episodio, "comunicacao_disparada", "motor_1",
                   dados={"canal": "whatsapp + email",
                          "destinatario": "paciente + medico",
                          "template": "autorizacao_concedida",
                          "numero_autorizacao": req.numero_autorizacao})
        _registrar(id_episodio, "motor_3_acionado", "motor_1",
                   dados={"motivo": "AutorizaÃ§Ã£o concedida â billing liberado"})

    if estado_destino == "em_analise":
        _registrar(id_episodio, "motor_2_solicitado", "motor_1",
                   dados={"motivo": "EpisÃ³dio em anÃ¡lise â solicitar geraÃ§Ã£o de documentos"})

    if estado_destino == "recurso_em_preparo":
        _registrar(id_episodio, "motor_2_solicitado", "motor_1",
                   dados={"tipo_documento": "recurso_glosa",
                          "motivo": "Recurso iniciado â gerar documento de recurso"})

    return {
        "id_episodio":   id_episodio,
        "estado_anterior": estado_atual,
        "estado_atual":  estado_destino,
        "transicionado_em": _now(),
        "origem":        req.origem_acao,
        "transicoes_proximas": workflow.transicoes_permitidas(estado_destino),
    }


# ââ COMPATIBILIDADE COM FORMULÃRIO LEGADO âââââââââââââââââââââââââââââââââââââ

@app.post("/submit")
def submit_legado(payload: dict = Body(...)):
    """
    Endpoint de compatibilidade com index.html atual.
    Mapeia campos do formulÃ¡rio para o schema do Motor 1.
    """
    def _pick(*keys, src=payload, fallback=""):
        for k in keys:
            if src.get(k):
                return src[k]
        return fallback

    request_id = _pick("request_id") or _novo_id()

    dados_mapeados = CriarEpisodioRequest(
        request_id=request_id,
        identificacao_caso={
            "tipo_atendimento": _pick("tipo_atendimento", fallback="eletivo"),
            "origem_caso": "formulario_web",
        },
        paciente={
            "nome":               _pick("paciente_nome", "nome_paciente", "nome"),
            "carteirinha":        _pick("carteirinha", "num_carteirinha", "numero_carteirinha"),
            "cpf":                _pick("cpf"),
            "data_nascimento":    _pick("data_nascimento", "nascimento"),
            "validade_carteirinha": _pick("validade_carteirinha", "validade"),
            "contato": {
                "telefone": _pick("telefone", "celular"),
                "email":    _pick("email"),
            },
        },
        medico={
            "nome":          _pick("medico_nome", "nome_medico", "medico"),
            "crm":           _pick("crm", "medico_crm"),
            "especialidade": _pick("especialidade", fallback="neurocirurgia"),
        },
        hospital={
            "nome": _pick("hospital_nome", "nome_hospital", "hospital"),
            "cnes": _pick("cnes", "hospital_cnes"),
        },
        convenio={
            "id_convenio":  _pick("id_convenio", "convenio", fallback="UNIMED_CARIRI"),
            "nome":         _pick("convenio_nome", "nome_convenio"),
            "codigo_tiss":  _pick("codigo_tiss", "ans", "codigo_ans"),
            "canal_envio":  _pick("canal_envio", fallback="portal_web"),
        },
        procedimento_principal={
            "codigo_tuss":   _pick("codigo_tuss", "tuss", "procedimento_tuss"),
            "descricao":     _pick("procedimento", "descricao_procedimento"),
            "cid_principal": _pick("cid", "cid_principal", "cid10"),
            "cid_secundario": _pick("cid_secundario"),
            "via_acesso":    _pick("via_acesso"),
            "anestesia":     _pick("anestesia", fallback="geral"),
            "complexidade":  _pick("complexidade", fallback="alta_complexidade"),
            "data_prevista_procedimento": _pick("data_cirurgia", "data_procedimento"),
            "niveis_anatomicos": payload.get("niveis_anatomicos", []),
            "indicacao_clinica": _pick("indicacao_clinica", "indicacao", "justificativa"),
        },
        opme={
            "necessita_opme": payload.get("necessita_opme") in (True, "Sim", "sim", "S", "s"),
            "justificativa_clinica": _pick("justificativa_opme", "justificativa_clinica_opme"),
            "itens": payload.get("opme_itens", []),
        },
    )

    return criar_episodio(dados_mapeados)
