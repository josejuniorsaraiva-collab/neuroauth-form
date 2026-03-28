"""
workflow_engine.py â MÃ¡quina de estados do Motor 1
Baseada em STATUS_AUTORIZACAO_WORKFLOW_v1.json
Regras:
  - Toda transiÃ§Ã£o Ã© validada contra TRANSICOES_VALIDAS
  - 'arquivado' Ã© terminal e imutÃ¡vel permanentemente
  - TransiÃ§Ã£o invÃ¡lida levanta WorkflowError (â HTTP 422)
  - ProgressÃ£o bloqueada por pendÃªncia bloqueante (â HTTP 409)
"""

from typing import Optional

# ââ GRAFO DE TRANSIÃÃES ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

TRANSICOES_VALIDAS: dict[str, list[str]] = {
    "preenchimento":          ["validacao"],
    "validacao":              ["em_analise", "pendente_complemento"],
    "em_analise":             ["pronto_para_envio"],
    "pendente_complemento":   ["validacao"],
    "pronto_para_envio":      ["enviado"],
    "enviado":                ["autorizado", "negado", "pendente_complemento"],
    "autorizado":             ["faturado"],
    "negado":                 ["arquivado", "recurso_em_preparo"],
    "recurso_em_preparo":     ["recurso_enviado"],
    "recurso_enviado":        ["pendente_retorno_recurso"],
    "pendente_retorno_recurso": ["autorizado", "negado"],
    "faturado":               ["arquivado"],
    "arquivado":              [],          # terminal â hard block permanente
}

ESTADOS_VALIDOS = set(TRANSICOES_VALIDAS.keys())

ESTADOS_TERMINAIS = {"arquivado"}

# Estados que o Motor 1 pode transicionar autonomamente (sem aÃ§Ã£o humana)
ESTADOS_MOTOR_1 = {
    "preenchimento", "validacao", "em_analise",
    "pendente_complemento", "recurso_enviado",
}

# Estados que exigem aÃ§Ã£o do convÃªnio (entrada externa)
ESTADOS_AGUARDANDO_CONVENIO = {"enviado", "pendente_retorno_recurso"}

# Estados que disparam alerta crÃ­tico imediato
ESTADOS_ALERTA_CRITICO = {"negado"}

# Estados que disparam comunicaÃ§Ã£o ao paciente
ESTADOS_COMUNICACAO_PACIENTE = {"autorizado", "negado"}


# ââ ERROS âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

class WorkflowError(Exception):
    """TransiÃ§Ã£o de estado invÃ¡lida."""
    def __init__(self, codigo: str, mensagem: str, detalhes: Optional[dict] = None):
        self.codigo = codigo
        self.mensagem = mensagem
        self.detalhes = detalhes or {}
        super().__init__(mensagem)

    def to_dict(self) -> dict:
        return {
            "erro": self.codigo,
            "mensagem": self.mensagem,
            **self.detalhes,
        }


class BloqueioError(Exception):
    """ProgressÃ£o bloqueada por pendÃªncia ou regra de negÃ³cio."""
    def __init__(self, codigo: str, mensagem: str, detalhes: Optional[dict] = None):
        self.codigo = codigo
        self.mensagem = mensagem
        self.detalhes = detalhes or {}
        super().__init__(mensagem)

    def to_dict(self) -> dict:
        return {
            "erro": self.codigo,
            "mensagem": self.mensagem,
            **self.detalhes,
        }


# ââ VALIDAÃÃES ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def validar_transicao(estado_atual: str, estado_destino: str) -> None:
    """
    Levanta WorkflowError se a transiÃ§Ã£o nÃ£o for permitida.
    Levanta WorkflowError com hard_block_permanente se estado for terminal.
    """
    if estado_atual not in TRANSICOES_VALIDAS:
        raise WorkflowError(
            "estado_desconhecido",
            f"Estado atual '{estado_atual}' nÃ£o existe no workflow.",
            {"estado_atual": estado_atual},
        )

    if estado_atual in ESTADOS_TERMINAIS:
        raise WorkflowError(
            "hard_block_permanente",
            f"Estado '{estado_atual}' Ã© terminal. Nenhuma transiÃ§Ã£o Ã© permitida.",
            {
                "estado_atual": estado_atual,
                "hard_block_permanente": True,
                "transicoes_permitidas": [],
            },
        )

    permitidas = TRANSICOES_VALIDAS[estado_atual]
    if estado_destino not in permitidas:
        raise WorkflowError(
            "transicao_invalida",
            f"TransiÃ§Ã£o '{estado_atual}' â '{estado_destino}' nÃ£o Ã© permitida.",
            {
                "estado_atual": estado_atual,
                "estado_destino_solicitado": estado_destino,
                "transicoes_permitidas": permitidas,
            },
        )

    if estado_destino not in ESTADOS_VALIDOS:
        raise WorkflowError(
            "estado_destino_invalido",
            f"Estado destino '{estado_destino}' nÃ£o existe no workflow.",
            {"estado_destino": estado_destino},
        )


def validar_sem_bloqueio(
    estado_destino: str,
    total_bloqueantes: int,
) -> None:
    """
    Levanta BloqueioError se houver pendÃªncias bloqueantes
    e o destino exigir episÃ³dio limpo.
    """
    DESTINOS_QUE_EXIGEM_LIMPEZA = {
        "pronto_para_envio",
        "em_analise",
        "enviado",
        "autorizado",
    }
    if estado_destino in DESTINOS_QUE_EXIGEM_LIMPEZA and total_bloqueantes > 0:
        raise BloqueioError(
            "pendencias_bloqueantes",
            f"Existem {total_bloqueantes} pendÃªncia(s) bloqueante(s) abertas. "
            f"Resolva-as antes de transicionar para '{estado_destino}'.",
            {
                "estado_destino": estado_destino,
                "total_bloqueantes": total_bloqueantes,
            },
        )


def validar_dados_estado(estado_destino: str, dados_extras: dict) -> None:
    """
    Valida campos obrigatÃ³rios especÃ­ficos por estado de destino.
    """
    if estado_destino == "autorizado":
        if not dados_extras.get("numero_autorizacao"):
            raise WorkflowError(
                "campo_obrigatorio",
                "TransiÃ§Ã£o para 'autorizado' requer 'numero_autorizacao'.",
                {"campo": "numero_autorizacao", "estado_destino": "autorizado"},
            )

    if estado_destino == "negado":
        if not dados_extras.get("motivo_negativa"):
            raise WorkflowError(
                "campo_obrigatorio",
                "TransiÃ§Ã£o para 'negado' requer 'motivo_negativa'.",
                {"campo": "motivo_negativa", "estado_destino": "negado"},
            )


# ââ HELPERS âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def transicoes_permitidas(estado_atual: str) -> list[str]:
    return TRANSICOES_VALIDAS.get(estado_atual, [])


def e_terminal(estado: str) -> bool:
    return estado in ESTADOS_TERMINAIS


def e_alerta_critico(estado: str) -> bool:
    return estado in ESTADOS_ALERTA_CRITICO
