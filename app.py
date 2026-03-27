"""
NEUROAUTH API — FastAPI backend
Endpoints: POST /gerar_sadt, POST /gerar_opme, POST /gerar_resumo
Deploy: Render.com · Cloud Run · qualquer VPS com Python 3.10+
"""

import os
import sys
import json
import tempfile
import traceback
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── Adiciona diretório pai ao path para importar os módulos ───────────
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

# Templates PDF — procura na ordem: TEMPLATES_OFICIAIS/ → raiz → fallback gerado
def _find_template(name: str) -> str:
    candidates = [
        ROOT / "TEMPLATES_OFICIAIS" / name,
        ROOT / name,
        ROOT / "mnt" / "outputs" / "TEMPLATES_OFICIAIS" / name,
        Path("/tmp") / name,
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    # Fallback: gera template em branco com linhas de referência
    return _make_blank_template(name)

def _make_blank_template(name: str) -> str:
    """Gera um PDF A4 landscape em branco com linhas de referência."""
    from reportlab.pdfgen import canvas as rlcanvas
    import io
    from pypdf import PdfWriter, PdfReader
    out = f"/tmp/{name}"
    packet = io.BytesIO()
    c = rlcanvas.Canvas(packet, pagesize=(842, 595))
    c.setStrokeColorRGB(0.85, 0.85, 0.85)
    c.setLineWidth(0.3)
    for y in [63,117,168,202,214,227,237,248,258,269,280,300,313,527,547]:
        c.line(20, 595-y, 820, 595-y)
    c.save()
    packet.seek(0)
    writer = PdfWriter()
    writer.add_page(PdfReader(packet).pages[0])
    with open(out, "wb") as f:
        writer.write(f)
    return out


# ── App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="NEUROAUTH API",
    description="Geração automática de guias SP/SADT e OPME – Padrão TISS ANS",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # restrinja ao domínio do formulário em produção
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ───────────────────────────────────────────────────────────
class ProcedimentoItem(BaseModel):
    tabela: str = "22"
    codigo: str
    descricao: str
    quantidade: str = "1"

class MaterialOpme(BaseModel):
    tabela: str = "98"
    codigo: str = ""
    descricao: str
    quantidade: str = "1"
    anvisa: str = ""
    fabricante: str = ""

class InternacaoPayload(BaseModel):
    # Identificação
    registro_ans:              str = "311269"
    numero_guia_prestador:     str
    numero_guia_operadora:     str = ""
    data_autorizacao:          str = ""
    senha:                     str = ""
    data_validade_senha:       str = ""
    convenio:                  str = "UNIMED"

    # Beneficiário
    numero_carteira:           str
    validade_carteira:         str = ""
    atendimento_rn:            str = "N"
    nome_paciente:             str
    cns:                       str = ""

    # Contratado / Profissional Solicitante
    codigo_operadora_sol:      str = ""
    nome_contratado:           str = ""
    nome_profissional:         str
    conselho_profissional:     str = "CRM"
    numero_conselho:           str
    uf_crm:                    str
    cbo:                       str = "225125"

    # Hospital / Local Solicitado
    codigo_operadora_exec:     str = ""
    nome_hospital:             str
    data_sugerida_internacao:  str = ""

    # Dados da Internação
    carater_atendimento:       str = "1"
    tipo_internacao:           str = "1"
    regime_internacao:         str = "3"
    qtde_diarias_solicitadas:  str = ""
    previsao_opme:             str = "N"
    previsao_quimioterapico:   str = "N"

    # Indicação Clínica
    indicacao_clinica:         str

    # CID 10
    cid10_principal:           str = ""
    cid10_2:                   str = ""
    cid10_3:                   str = ""
    cid10_4:                   str = ""
    indicacao_acidente:        str = "N"

    # 12 linhas de procedimentos (flat)
    tabela_1: str = ""; codigo_procedimento_1: str = ""; descricao_procedimento_1: str = ""; quantidade_solicitada_1: str = ""
    tabela_2: str = ""; codigo_procedimento_2: str = ""; descricao_procedimento_2: str = ""; quantidade_solicitada_2: str = ""
    tabela_3: str = ""; codigo_procedimento_3: str = ""; descricao_procedimento_3: str = ""; quantidade_solicitada_3: str = ""
    tabela_4: str = ""; codigo_procedimento_4: str = ""; descricao_procedimento_4: str = ""; quantidade_solicitada_4: str = ""
    tabela_5: str = ""; codigo_procedimento_5: str = ""; descricao_procedimento_5: str = ""; quantidade_solicitada_5: str = ""
    tabela_6: str = ""; codigo_procedimento_6: str = ""; descricao_procedimento_6: str = ""; quantidade_solicitada_6: str = ""
    tabela_7: str = ""; codigo_procedimento_7: str = ""; descricao_procedimento_7: str = ""; quantidade_solicitada_7: str = ""
    tabela_8: str = ""; codigo_procedimento_8: str = ""; descricao_procedimento_8: str = ""; quantidade_solicitada_8: str = ""
    tabela_9: str = ""; codigo_procedimento_9: str = ""; descricao_procedimento_9: str = ""; quantidade_solicitada_9: str = ""
    tabela_10: str = ""; codigo_procedimento_10: str = ""; descricao_procedimento_10: str = ""; quantidade_solicitada_10: str = ""
    tabela_11: str = ""; codigo_procedimento_11: str = ""; descricao_procedimento_11: str = ""; quantidade_solicitada_11: str = ""
    tabela_12: str = ""; codigo_procedimento_12: str = ""; descricao_procedimento_12: str = ""; quantidade_solicitada_12: str = ""

    # Autorização
    data_admissao:             str = ""
    qtde_diarias_autorizadas:  str = ""
    tipo_acomodacao_autorizada:str = ""
    codigo_operadora_autorizado: str = ""
    nome_hospital_autorizado:  str = ""
    codigo_cnes_autorizado:    str = ""

    # Observação / Data
    observacao_justificativa:  str = ""
    data_solicitacao:          str = ""

    model_config = {"extra": "allow"}


class SadtPayload(BaseModel):
    # Identificação
    registro_ans:             str = "311269"
    numero_guia_prestador:    str
    numero_guia_referenciada: str = ""
    data_solicitacao:         str = ""
    carater_atendimento:      str = "1"
    convenio:                 str = "UNIMED"

    # Beneficiário
    numero_carteira:  str
    validade_carteira:str = ""
    nome_paciente:    str
    cns:              str = ""
    atendimento_rn:   str = "N"

    # Médico
    nome_medico:      str
    conselho:         str = "CRM"
    crm:              str
    uf_crm:           str
    cbo:              str = "225110"
    telefone_medico:  str = ""
    email_medico:     str = ""

    # Dados da solicitação
    indicacao_clinica:        str
    observacao_justificativa: str = ""

    # Procedimentos (flat — compatível com formulário HTML)
    tabela_1: str = ""; codigo_procedimento_1: str = ""
    descricao_procedimento_1: str = ""; quantidade_solicitada_1: str = ""
    tabela_2: str = ""; codigo_procedimento_2: str = ""
    descricao_procedimento_2: str = ""; quantidade_solicitada_2: str = ""
    tabela_3: str = ""; codigo_procedimento_3: str = ""
    descricao_procedimento_3: str = ""; quantidade_solicitada_3: str = ""
    tabela_4: str = ""; codigo_procedimento_4: str = ""
    descricao_procedimento_4: str = ""; quantidade_solicitada_4: str = ""
    tabela_5: str = ""; codigo_procedimento_5: str = ""
    descricao_procedimento_5: str = ""; quantidade_solicitada_5: str = ""

    # Hospital
    nome_hospital: str
    codigo_cnes:   str

    # OPME (para geração conjunta)
    necessita_opme:         bool  = False
    justificativa_opme:     str   = ""
    especificacao_material: str   = ""
    observacao_opme:        str   = ""
    material_1_tabela: str=""; material_1_codigo: str=""; material_1_descricao: str=""
    material_1_quantidade: str=""; material_1_anvisa: str=""; material_1_fabricante: str=""
    material_2_tabela: str=""; material_2_codigo: str=""; material_2_descricao: str=""
    material_2_quantidade: str=""; material_2_anvisa: str=""; material_2_fabricante: str=""
    material_3_tabela: str=""; material_3_codigo: str=""; material_3_descricao: str=""
    material_3_quantidade: str=""; material_3_anvisa: str=""; material_3_fabricante: str=""
    material_4_tabela: str=""; material_4_codigo: str=""; material_4_descricao: str=""
    material_4_quantidade: str=""; material_4_anvisa: str=""; material_4_fabricante: str=""
    material_5_tabela: str=""; material_5_codigo: str=""; material_5_descricao: str=""
    material_5_quantidade: str=""; material_5_anvisa: str=""; material_5_fabricante: str=""

    model_config = {"extra": "allow"}   # aceita campos extras sem erro


# ── Utilidades ────────────────────────────────────────────────────────
def _today() -> str:
    return datetime.today().strftime("%d/%m/%Y")

def _case_id(payload: SadtPayload) -> str:
    year  = datetime.today().year
    conv  = payload.convenio.upper()[:10]
    guide = payload.numero_guia_prestador.strip()[-5:].zfill(5)
    return f"{year}-{conv}-{guide}"

def _payload_dict(payload: SadtPayload) -> dict:
    d = payload.model_dump()
    if not d.get("data_solicitacao"):
        d["data_solicitacao"] = _today()
    return d


# ── Endpoints ─────────────────────────────────────────────────────────

@app.get("/", summary="Health check")
def root():
    return {"status": "ok", "service": "NEUROAUTH API", "version": "1.0.0",
            "endpoints": ["/gerar_sadt", "/gerar_opme", "/gerar_resumo", "/validar"]}

@app.get("/health")
def health():
    return {"ok": True, "ts": datetime.utcnow().isoformat()}


@app.post("/gerar_sadt", summary="Gera guia SP/SADT em PDF")
def gerar_sadt(payload: SadtPayload):
    """
    Recebe JSON do formulário da secretária e retorna o PDF da guia SP/SADT
    preenchido sobre o template TISS oficial.
    """
    try:
        from fill_unimed_sadt_v2 import fill_sadt
    except ImportError:
        raise HTTPException(503, "fill_unimed_sadt_v2 não encontrado. "
                                 "Certifique-se de que os módulos NEUROAUTH estão no PYTHONPATH.")

    variables = _payload_dict(payload)
    template  = _find_template("blank_sadt_template.pdf")
    case_id   = _case_id(payload)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, prefix=f"SADT_{case_id}_") as f:
        out_path = f.name

    try:
        fill_sadt(template, variables, out_path)
    except Exception as e:
        raise HTTPException(500, f"Erro ao gerar SADT: {e}\n{traceback.format_exc()}")

    filename = f"SADT_{case_id}.pdf"
    return FileResponse(
        out_path,
        media_type="application/pdf",
        filename=filename,
        headers={"X-Case-ID": case_id, "X-NEUROAUTH-Version": "1.0"}
    )


@app.post("/gerar_opme", summary="Gera guia OPME em PDF")
def gerar_opme(payload: SadtPayload):
    """
    Gera o anexo OPME. Retorna 204 se payload.necessita_opme=false.
    """
    if not payload.necessita_opme:
        return JSONResponse({"ok": False, "msg": "OPME não solicitado neste caso."}, 204)

    try:
        from fill_unimed_opme_v2 import fill_opme
    except ImportError:
        raise HTTPException(503, "fill_unimed_opme_v2 não encontrado.")

    variables = _payload_dict(payload)
    template  = _find_template("blank_opme_template.pdf")
    case_id   = _case_id(payload)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, prefix=f"OPME_{case_id}_") as f:
        out_path = f.name

    try:
        fill_opme(template, variables, out_path)
    except Exception as e:
        raise HTTPException(500, f"Erro ao gerar OPME: {e}\n{traceback.format_exc()}")

    return FileResponse(out_path, media_type="application/pdf",
                        filename=f"OPME_{case_id}.pdf",
                        headers={"X-Case-ID": case_id})


@app.post("/gerar_internacao", summary="Gera Guia de Solicitação de Internação em PDF")
def gerar_internacao(payload: InternacaoPayload):
    """
    Recebe JSON com dados do paciente/médico/hospital e retorna o PDF da
    Guia de Solicitação de Internação preenchido sobre o template Unimed Ceará.
    """
    try:
        from fill_unimed_internacao_v1 import fill_internacao
    except ImportError:
        raise HTTPException(503, "fill_unimed_internacao_v1 não encontrado. "
                                 "Certifique-se de que os módulos NEUROAUTH estão no PYTHONPATH.")

    variables  = payload.model_dump()
    if not variables.get("data_solicitacao"):
        variables["data_solicitacao"] = _today()

    template   = _find_template("blank_internacao_template.pdf")
    year       = datetime.today().year
    conv       = payload.convenio.upper()[:10]
    guide      = payload.numero_guia_prestador.strip()[-5:].zfill(5)
    case_id    = f"{year}-{conv}-INTERN-{guide}"

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, prefix=f"INTERNACAO_{case_id}_") as f:
        out_path = f.name

    try:
        fill_internacao(template, variables, out_path)
    except Exception as e:
        raise HTTPException(500, f"Erro ao gerar Internação: {e}\n{traceback.format_exc()}")

    filename = f"INTERNACAO_{case_id}.pdf"
    return FileResponse(
        out_path,
        media_type="application/pdf",
        filename=filename,
        headers={"X-Case-ID": case_id, "X-NEUROAUTH-Version": "1.0"}
    )


@app.post("/gerar_resumo", summary="Gera PDF resumo do caso (1 página)")
def gerar_resumo(payload: SadtPayload):
    """Gera o PDF de resumo de 1 página para controle interno."""
    try:
        from case_summary import generate_summary
    except ImportError:
        raise HTTPException(503, "case_summary não encontrado.")

    variables = _payload_dict(payload)
    case_id   = _case_id(payload)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, prefix=f"RESUMO_{case_id}_") as f:
        out_path = f.name

    try:
        generate_summary(variables, case_id, out_path)
    except Exception as e:
        raise HTTPException(500, f"Erro ao gerar resumo: {e}\n{traceback.format_exc()}")

    return FileResponse(out_path, media_type="application/pdf",
                        filename=f"RESUMO_{case_id}.pdf")


@app.post("/validar", summary="Valida payload antes de gerar guias")
def validar(payload: SadtPayload):
    """
    Executa validação completa (validacao_neuroauth.py) e retorna
    erros bloqueantes e warnings sem gerar PDF.
    """
    try:
        from validacao_neuroauth import validar_completo
    except ImportError:
        raise HTTPException(503, "validacao_neuroauth não encontrado.")

    variables  = _payload_dict(payload)
    case_id    = _case_id(payload)
    banco_path = str(ROOT / "BANCO_MESTRE_NEUROCIRURGIA.xlsx")

    result = validar_completo(
        payload    = variables,
        case_id    = case_id,
        gerar_opme = payload.necessita_opme,
        max_materiais = 5,
        banco_mestre_path = banco_path if os.path.exists(banco_path) else None,
    )
    return {
        "case_id":  result.case_id,
        "aprovado": result.aprovado,
        "erros":    result.erros,
        "warnings": result.warnings,
    }


@app.post("/gerar_tudo", summary="Gera SADT + OPME + Resumo em uma única chamada (retorna JSON)")
def gerar_tudo(payload: SadtPayload, request: Request):
    """
    Conveniente para o Make.com: retorna os URLs dos três PDFs gerados.
    Os arquivos ficam em /tmp e são servidos pelo endpoint /arquivo/{nome}.
    """
    from fill_unimed_sadt_v2 import fill_sadt
    variables = _payload_dict(payload)
    case_id   = _case_id(payload)
    template  = _find_template("blank_sadt_template.pdf")

    sadt_path = f"/tmp/SADT_{case_id}.pdf"
    fill_sadt(template, variables, sadt_path)

    opme_path = None
    if payload.necessita_opme:
        from fill_unimed_opme_v2 import fill_opme
        opme_path = f"/tmp/OPME_{case_id}.pdf"
        fill_opme(_find_template("blank_opme_template.pdf"), variables, opme_path)

    resumo_path = None
    try:
        from case_summary import generate_summary
        resumo_path = f"/tmp/RESUMO_{case_id}.pdf"
        generate_summary(variables, case_id, resumo_path)
    except Exception:
        pass

    base_url = str(request.base_url).rstrip("/")
    return {
        "ok":      True,
        "case_id": case_id,
        "sadt":    f"{base_url}/arquivo/SADT_{case_id}.pdf",
        "opme":    f"{base_url}/arquivo/OPME_{case_id}.pdf" if opme_path else None,
        "resumo":  f"{base_url}/arquivo/RESUMO_{case_id}.pdf" if resumo_path else None,
        "gerado_em": datetime.utcnow().isoformat(),
    }


@app.get("/arquivo/{filename}", summary="Download de PDF gerado")
def download_arquivo(filename: str):
    """Serve PDFs gerados em /tmp — para uso temporário no Make.com."""
    path = f"/tmp/{filename}"
    if not os.path.exists(path):
        raise HTTPException(404, f"Arquivo '{filename}' não encontrado ou expirado.")
    return FileResponse(path, media_type="application/pdf", filename=filename)
