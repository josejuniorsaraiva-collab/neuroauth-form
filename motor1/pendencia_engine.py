"""
pendencia_engine.py â Motor 1: OrquestraÃ§Ã£o de PendÃªncias
Coordena criaÃ§Ã£o, deduplicaÃ§Ã£o e resoluÃ§Ã£o de pendÃªncias.
NÃ£o tem efeitos colaterais alÃ©m de chamar episode_store.
"""

import uuid
from typing import Optional

from motor1 import episode_store as store
from motor1.validator_engine import PendenciaResult


def _novo_id() -> str:
    return str(uuid.uuid4())


def criar_pendencias_do_resultado(
    id_episodio: str,
    pendencias: list[PendenciaResult],
) -> list[dict]:
    """
    Persiste pendÃªncias novas evitando duplicaÃ§Ã£o por campo_afetado.
    Retorna lista de pendÃªncias criadas (apenas as novas).
    """
    campos_abertos = store.campos_com_pendencia_aberta(id_episodio)
    criadas = []

    for p in pendencias:
        # NÃ£o duplicar pendÃªncia no mesmo campo se jÃ¡ hÃ¡ uma aberta
        if p.campo_afetado and p.campo_afetado in campos_abertos:
            continue

        nova = store.create_pendencia(
            id_pendencia=_novo_id(),
            id_episodio=id_episodio,
            tipo=p.tipo,
            descricao=p.descricao,
            campo_afetado=p.campo_afetado,
            bloqueia_envio=p.bloqueia_envio,
            severidade=p.severidade,
        )
        if p.campo_afetado:
            campos_abertos.add(p.campo_afetado)
        criadas.append(nova)

    return criadas


def resolver(
    id_episodio: str,
    id_pendencia: str,
    resolucao: str,
    resolvido_por: str,
) -> dict:
    """
    Resolve uma pendÃªncia. Valida que pertence ao episÃ³dio.
    Levanta ValueError se nÃ£o encontrada ou jÃ¡ resolvida.
    """
    p = store.get_pendencia(id_pendencia)

    if not p:
        raise ValueError(f"PendÃªncia '{id_pendencia}' nÃ£o encontrada.")

    if p["id_episodio"] != id_episodio:
        raise ValueError(
            f"PendÃªncia '{id_pendencia}' nÃ£o pertence ao episÃ³dio '{id_episodio}'."
        )

    if p["status"] == "resolvida":
        raise ValueError(
            f"PendÃªncia '{id_pendencia}' jÃ¡ estÃ¡ resolvida."
        )

    return store.resolve_pendencia(id_pendencia, resolucao, resolvido_por)


def listar(id_episodio: str) -> dict:
    """Retorna todas as pendÃªncias do episÃ³dio com contadores."""
    todas = store.get_pendencias(id_episodio)
    abertas    = [p for p in todas if p["status"] == "aberta"]
    bloqueantes = [p for p in abertas if p["bloqueia_envio"]]
    resolvidas  = [p for p in todas if p["status"] == "resolvida"]

    return {
        "total":             len(todas),
        "abertas":           len(abertas),
        "bloqueantes":       len(bloqueantes),
        "resolvidas":        len(resolvidas),
        "pode_revalidar":    len(bloqueantes) == 0,
        "pendencias":        todas,
    }
