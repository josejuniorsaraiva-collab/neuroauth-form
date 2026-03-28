"""
validator_engine.py â Motor 1: Pipeline de ValidaÃ§Ã£o (4 checks)
Verificado nos CenÃ¡rios A e B.

Checks executados em sequÃªncia:
  A â Completude de campos obrigatÃ³rios (inclui OPME)
  B â Compatibilidade clÃ­nica: TUSS Ã CID-10
  C â RegulatÃ³rio: CRM, CNES, validade carteirinha
  D â Cobertura do convÃªnio: TUSS no rol

Retorna lista de PendenciaResult.
Sem efeitos colaterais â nÃ£o grava no banco.
"""

from dataclasses import dataclass
from typing import Optional
from datetime import date


# ââ TABELAS DE REFERÃNCIA (hardcoded no MVP â banco em v1.1) âââââââââââââââââ

# TUSS â CIDs aceitos (subconjunto operacional: neurocirurgia + coluna)
TUSS_CID_COMPAT: dict[str, list[str]] = {
    "40803015": ["M51.1", "M48.0", "M47.8", "M43.1", "M54.4", "S32.0", "M51.0", "M51.2"],
    "40803023": ["M50.1", "M50.2", "M50.0", "M47.8", "S12.0", "M43.3", "M43.2"],
    "40801011": ["M51.1", "M51.0", "M51.2", "M54.4", "M48.0"],  # microdiscectomia
    "40804011": ["M48.0", "M47.8", "M51.1", "G95.0", "M43.0"],  # laminectomia
    "40701014": ["G35", "G93.6", "C71.0", "C71.1", "C71.2", "C71.9",
                 "I60.0", "I60.9", "I61.0", "I61.9", "I67.1", "G91.0"],  # craniotomia
    "40702022": ["I65.0", "I65.1", "I65.2", "I66.0", "I66.1",
                 "Q28.3", "I67.1", "I60.9"],  # angiografia cerebral
}

# CNES credenciados na Unimed Cariri (MVP)
CNES_CREDENCIADOS_UNIMED_CARIRI: set[str] = {
    "2330420",   # Hospital SÃ£o AntÃ´nio â Barbalha/CE
    "2315820",   # Hospital Regional do Cariri â Crato/CE
    "7003527",   # Hospital Maternidade SÃ£o Lucas â Juazeiro do Norte/CE
    "2334520",   # UNI-Cariri Hospital â Juazeiro do Norte/CE
}

# TUSS cobertos pela Unimed Cariri (MVP)
ROL_UNIMED_CARIRI: set[str] = {
    "40803015",  # Artrodese lombar
    "40803023",  # Artrodese cervical
    "40801011",  # Microdiscectomia
    "40804011",  # Laminectomia
    "40701014",  # Craniotomia
    "40702022",  # Angiografia cerebral
    "40702030",  # EmbolizaÃ§Ã£o cerebral
    "40801020",  # Discectomia cervical
    "40804020",  # Foraminotomia
}

# Campos obrigatÃ³rios por (bloco, campo)
CAMPOS_OBRIGATORIOS: list[tuple[str, str]] = [
    ("identificacao_caso", "tipo_atendimento"),
    ("paciente",           "carteirinha"),
    ("paciente",           "nome"),
    ("paciente",           "cpf"),
    ("medico",             "crm"),
    ("hospital",           "cnes"),
    ("convenio",           "id_convenio"),
    ("convenio",           "codigo_tiss"),
    ("procedimento_principal", "codigo_tuss"),
    ("procedimento_principal", "cid_principal"),
    ("procedimento_principal", "indicacao_clinica"),
]

INDICACAO_MINIMA_CHARS = 50


# ââ RESULTADO DE PENDÃNCIA ââââââââââââââââââââââââââââââââââââââââââââââââââââ

@dataclass
class PendenciaResult:
    tipo: str
    descricao: str
    campo_afetado: Optional[str]
    bloqueia_envio: bool
    severidade: str  # "critica" | "alta" | "media"


# ââ CHECKS âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def _check_a_completude(dados: dict) -> list[PendenciaResult]:
    """Verifica campos obrigatÃ³rios e completude de OPME."""
    pendencias: list[PendenciaResult] = []

    for bloco, campo in CAMPOS_OBRIGATORIOS:
        val = dados.get(bloco, {}).get(campo, "")
        if not val or (isinstance(val, str) and not val.strip()):
            pendencias.append(PendenciaResult(
                tipo="documentacao_incompleta",
                descricao=f"Campo obrigatÃ³rio ausente: {bloco}.{campo}",
                campo_afetado=f"{bloco}.{campo}",
                bloqueia_envio=True,
                severidade="critica",
            ))

    # IndicaÃ§Ã£o clÃ­nica â mÃ­nimo de chars
    indicacao = dados.get("procedimento_principal", {}).get("indicacao_clinica", "")
    if indicacao and len(indicacao.strip()) < INDICACAO_MINIMA_CHARS:
        pendencias.append(PendenciaResult(
            tipo="informacao_clinica_insuficiente",
            descricao=(
                f"IndicaÃ§Ã£o clÃ­nica insuficiente ({len(indicacao.strip())} chars). "
                f"MÃ­nimo: {INDICACAO_MINIMA_CHARS} chars com descriÃ§Ã£o clÃ­nica objetiva."
            ),
            campo_afetado="procedimento_principal.indicacao_clinica",
            bloqueia_envio=True,
            severidade="alta",
        ))

    # OPME
    opme = dados.get("opme", {})
    if opme.get("necessita_opme") is True:
        itens = opme.get("itens", [])
        if not itens:
            pendencias.append(PendenciaResult(
                tipo="opme_nao_autorizada",
                descricao="OPME marcado como necessÃ¡rio, mas itens[] estÃ¡ vazio. Informe os itens com cÃ³digo ANVISA.",
                campo_afetado="opme.itens",
                bloqueia_envio=True,
                severidade="critica",
            ))
        else:
            for i, item in enumerate(itens):
                if not item.get("codigo_anvisa", "").strip():
                    pendencias.append(PendenciaResult(
                        tipo="opme_nao_autorizada",
                        descricao=f"Item OPME [{i+1}] sem cÃ³digo ANVISA. ObrigatÃ³rio para autorizaÃ§Ã£o.",
                        campo_afetado=f"opme.itens[{i}].codigo_anvisa",
                        bloqueia_envio=True,
                        severidade="critica",
                    ))

        if not opme.get("justificativa_clinica", "").strip():
            pendencias.append(PendenciaResult(
                tipo="informacao_clinica_insuficiente",
                descricao="Justificativa clÃ­nica do OPME ausente. ObrigatÃ³ria quando necessita_opme = true.",
                campo_afetado="opme.justificativa_clinica",
                bloqueia_envio=True,
                severidade="alta",
            ))

    return pendencias


def _check_b_clinico(dados: dict) -> list[PendenciaResult]:
    """Verifica compatibilidade TUSS Ã CID-10."""
    pendencias: list[PendenciaResult] = []

    tuss = dados.get("procedimento_principal", {}).get("codigo_tuss", "")
    cid  = dados.get("procedimento_principal", {}).get("cid_principal", "")

    if tuss and cid and tuss in TUSS_CID_COMPAT:
        aceitos = TUSS_CID_COMPAT[tuss]
        # Match direto ou por prefixo (ex: "M51" cobre "M51.1")
        if not any(cid.startswith(aceito.split(".")[0]) or cid == aceito for aceito in aceitos):
            pendencias.append(PendenciaResult(
                tipo="cid_incompativel",
                descricao=(
                    f"CID-10 '{cid}' incompatÃ­vel com procedimento TUSS {tuss}. "
                    f"CIDs aceitos: {', '.join(aceitos[:5])}{'...' if len(aceitos) > 5 else ''}."
                ),
                campo_afetado="procedimento_principal.cid_principal",
                bloqueia_envio=True,
                severidade="critica",
            ))

    return pendencias


def _check_c_regulatorio(dados: dict) -> list[PendenciaResult]:
    """Verifica CRM, CNES e validade da carteirinha."""
    pendencias: list[PendenciaResult] = []

    # CRM
    crm = dados.get("medico", {}).get("crm", "")
    if crm:
        crm_valido = (
            crm.upper().startswith("CRM/")
            and len(crm) >= 8
            and any(c.isdigit() for c in crm)
        )
        if not crm_valido:
            pendencias.append(PendenciaResult(
                tipo="dados_beneficiario_invalidos",
                descricao=f"CRM em formato invÃ¡lido: '{crm}'. Formato esperado: CRM/UF 12345.",
                campo_afetado="medico.crm",
                bloqueia_envio=True,
                severidade="critica",
            ))

    # CNES
    cnes = dados.get("hospital", {}).get("cnes", "")
    id_convenio = dados.get("convenio", {}).get("id_convenio", "")
    if cnes and id_convenio == "UNIMED_CARIRI":
        if cnes not in CNES_CREDENCIADOS_UNIMED_CARIRI:
            pendencias.append(PendenciaResult(
                tipo="conflito_cobertura",
                descricao=(
                    f"Hospital com CNES {cnes} nÃ£o estÃ¡ na rede credenciada da Unimed Cariri. "
                    "Verifique o hospital ou solicite credenciamento."
                ),
                campo_afetado="hospital.cnes",
                bloqueia_envio=True,
                severidade="critica",
            ))

    # Validade da carteirinha
    validade_str = dados.get("paciente", {}).get("validade_carteirinha", "")
    if validade_str:
        try:
            validade_dt = date.fromisoformat(validade_str)
            if validade_dt < date.today():
                pendencias.append(PendenciaResult(
                    tipo="dados_beneficiario_invalidos",
                    descricao=f"Carteirinha do beneficiÃ¡rio vencida em {validade_str}. Contate o convÃªnio.",
                    campo_afetado="paciente.validade_carteirinha",
                    bloqueia_envio=True,
                    severidade="critica",
                ))
        except ValueError:
            pendencias.append(PendenciaResult(
                tipo="dados_beneficiario_invalidos",
                descricao=f"Data de validade da carteirinha invÃ¡lida: '{validade_str}'. Use formato YYYY-MM-DD.",
                campo_afetado="paciente.validade_carteirinha",
                bloqueia_envio=True,
                severidade="alta",
            ))

    return pendencias


def _check_d_cobertura(dados: dict) -> list[PendenciaResult]:
    """Verifica se o procedimento TUSS estÃ¡ coberto pelo convÃªnio."""
    pendencias: list[PendenciaResult] = []

    tuss       = dados.get("procedimento_principal", {}).get("codigo_tuss", "")
    id_convenio = dados.get("convenio", {}).get("id_convenio", "")

    if tuss and id_convenio == "UNIMED_CARIRI":
        if tuss not in ROL_UNIMED_CARIRI:
            pendencias.append(PendenciaResult(
                tipo="procedimento_nao_coberto",
                descricao=(
                    f"Procedimento TUSS {tuss} nÃ£o consta no rol de cobertura da Unimed Cariri. "
                    "Verifique o cÃ³digo ou solicite autorizaÃ§Ã£o prÃ©via de cobertura."
                ),
                campo_afetado="procedimento_principal.codigo_tuss",
                bloqueia_envio=True,
                severidade="critica",
            ))

    return pendencias


# ââ PIPELINE PRINCIPAL ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

class ResultadoValidacao:
    def __init__(self):
        self.check_a: list[PendenciaResult] = []
        self.check_b: list[PendenciaResult] = []
        self.check_c: list[PendenciaResult] = []
        self.check_d: list[PendenciaResult] = []

    @property
    def todas_pendencias(self) -> list[PendenciaResult]:
        return self.check_a + self.check_b + self.check_c + self.check_d

    @property
    def aprovado(self) -> bool:
        return len(self.todas_pendencias) == 0

    def to_dict(self) -> dict:
        return {
            "check_a_completude":   "PASS" if not self.check_a else "FAIL",
            "check_b_clinico":      "PASS" if not self.check_b else "FAIL",
            "check_c_regulatorio":  "PASS" if not self.check_c else "FAIL",
            "check_d_cobertura":    "PASS" if not self.check_d else "FAIL",
            "total_pendencias":     len(self.todas_pendencias),
            "aprovado":             self.aprovado,
        }


def executar(dados: dict) -> ResultadoValidacao:
    """
    Executa os 4 checks em sequÃªncia.
    Retorna ResultadoValidacao com pendÃªncias encontradas.
    Sem efeitos colaterais.
    """
    resultado = ResultadoValidacao()
    resultado.check_a = _check_a_completude(dados)
    resultado.check_b = _check_b_clinico(dados)
    resultado.check_c = _check_c_regulatorio(dados)
    resultado.check_d = _check_d_cobertura(dados)
    return resultado
