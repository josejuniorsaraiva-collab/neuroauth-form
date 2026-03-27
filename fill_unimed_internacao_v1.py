"""
fill_unimed_internacao_v1.py — Preenchimento de alta fidelidade: Guia de Solicitação de Internação
Unimed Ceará — Padrão TISS ANS v3 (A4 retrato, 595 × 842 pt)

Uso:
    python fill_unimed_internacao_v1.py template_internacao.pdf variaveis.json output.pdf

Inclui:
  - Sobreposição reportlab (fonte, alinhamento, centralização vertical)
  - Limites de caracteres por campo
  - 12 linhas de procedimentos solicitados (campos 34-38)
  - CID 10 Principal + 3 secundários
  - Indicação Clínica bloco multiline (~90pt altura)
  - Observação/Justificativa bloco multiline (3 linhas)
  - Validação básica de campos obrigatórios
"""

import sys, json
from fill_engine import (
    Field, fill_pdf,
    FIELD_TYPE_BOX, FIELD_TYPE_TEXT, FIELD_TYPE_BLOCK,
)

PDF_W, PDF_H = 595.0, 842.0  # A4 Portrait

# ─── Posições Y das linhas de Procedimento ───────────────────────────────────
# 12 linhas de procedimento; espaçamento ≈ 13.5pt entre linhas
# Calibrado: linha 01 = 491.2, linha 02 = 504.7 → Δ = 13.5
PROC_ROWS = {
    1:  491.2,
    2:  504.7,
    3:  518.1,
    4:  531.5,
    5:  545.0,
    6:  558.4,
    7:  571.9,
    8:  585.3,
    9:  598.7,
    10: 612.2,
    11: 625.6,
    12: 639.0,
}

# ─── Mapa de campos ───────────────────────────────────────────────────────────
# Field(var_name, x0, y0_top, x1, y1_top, font_size, field_type, max_chars, padding_x)
# Coordenadas em sistema pdfplumber (y=0 no topo da página)

INTERNACAO_FIELDS = [

    # ── Cabeçalho — Nº Guia no Prestador (Campo 2) ───────────────────────────
    # Large text area at top-right of form header
    Field("numero_guia_prestador",  357,  43, 572,  57,  9.5, FIELD_TYPE_TEXT, max_chars=20),

    # ── Identificação (Linha 1) ───────────────────────────────────────────────
    Field("registro_ans",            24, 108,  96, 114,  7.0, FIELD_TYPE_BOX),
    Field("numero_guia_operadora",  110, 108, 343, 114,  7.0, FIELD_TYPE_BOX),  # Campo 3

    # ── Dados da Autorização (Linha 2) ────────────────────────────────────────
    Field("data_autorizacao",        32, 133, 140, 139,  7.0, FIELD_TYPE_BOX),   # Campo 4
    Field("senha",                  159, 133, 393, 139,  7.0, FIELD_TYPE_BOX),   # Campo 5
    Field("data_validade_senha",    412, 133, 520, 139,  7.0, FIELD_TYPE_BOX),   # Campo 6

    # ── Dados do Beneficiário ─────────────────────────────────────────────────
    Field("numero_carteira",         23, 171, 257, 177,  7.0, FIELD_TYPE_BOX),   # Campo 7
    Field("validade_carteira",      296, 171, 404, 177,  7.0, FIELD_TYPE_BOX),   # Campo 8
    Field("atendimento_rn",         439, 171, 453, 177,  7.0, FIELD_TYPE_BOX),   # Campo 9
    Field("nome_paciente",           23, 192, 355, 205,  7.5, FIELD_TYPE_TEXT, max_chars=60),  # Campo 10
    Field("cns",                    363, 199, 539, 205,  7.0, FIELD_TYPE_BOX),   # Campo 11

    # ── Dados do Contratado Solicitante ───────────────────────────────────────
    Field("codigo_operadora_sol",    25, 234, 190, 240,  7.0, FIELD_TYPE_BOX),   # Campo 12
    Field("nome_contratado",        212, 234, 571, 240,  7.5, FIELD_TYPE_TEXT, max_chars=60),  # Campo 13

    # ── Dados do Profissional Solicitante ────────────────────────────────────
    Field("nome_profissional",       23, 262, 244, 268,  7.5, FIELD_TYPE_TEXT, max_chars=50),  # Campo 14
    Field("conselho_profissional",  259, 264, 280, 270,  7.0, FIELD_TYPE_BOX),   # Campo 15
    Field("numero_conselho",        295, 262, 454, 268,  7.0, FIELD_TYPE_BOX),   # Campo 16
    Field("uf_crm",                 462, 263, 486, 269,  7.0, FIELD_TYPE_BOX),   # Campo 17
    Field("cbo",                    492, 263, 556, 269,  7.0, FIELD_TYPE_BOX),   # Campo 18

    # ── Dados do Hospital / Local Solicitado ─────────────────────────────────
    Field("codigo_operadora_exec",   23, 299, 187, 305,  7.0, FIELD_TYPE_BOX),   # Campo 19
    Field("nome_hospital",          209, 299, 440, 308,  7.5, FIELD_TYPE_TEXT, max_chars=45),  # Campo 20
    # Campo 21 — Data sugerida para internação: dd/mm/aaaa
    Field("data_sugerida_internacao", 448, 298, 545, 304, 7.0, FIELD_TYPE_BOX),  # Campo 21

    # ── Parâmetros da Internação ──────────────────────────────────────────────
    Field("carater_atendimento",     56, 326,  70, 332,  7.0, FIELD_TYPE_BOX),   # Campo 22
    Field("tipo_internacao",        139, 326, 153, 332,  7.0, FIELD_TYPE_BOX),   # Campo 23
    Field("regime_internacao",      209, 326, 222, 332,  7.0, FIELD_TYPE_BOX),   # Campo 24
    Field("qtde_diarias_solicitadas", 280, 326, 317, 332, 7.0, FIELD_TYPE_BOX),  # Campo 25
    Field("previsao_opme",          384, 326, 397, 332,  7.0, FIELD_TYPE_BOX),   # Campo 26
    Field("previsao_quimioterapico", 479, 328, 492, 334, 7.0, FIELD_TYPE_BOX),   # Campo 27

    # ── Indicação Clínica — bloco multiline (Campo 28) ───────────────────────
    # Grande área livre entre y=349 e y=441 (~92pt de altura)
    Field("indicacao_clinica",       23, 349, 571, 437,  7.5, FIELD_TYPE_BLOCK,
          max_chars=600, max_lines=10, line_height=9.0),

    # ── CID 10 (Campos 29–32) ────────────────────────────────────────────────
    Field("cid10_principal",         26, 453,  74, 459,  7.0, FIELD_TYPE_BOX),   # Campo 29
    Field("cid10_2",                 96, 455, 144, 461,  7.0, FIELD_TYPE_BOX),   # Campo 30
    Field("cid10_3",                177, 453, 225, 459,  7.0, FIELD_TYPE_BOX),   # Campo 31
    Field("cid10_4",                263, 453, 311, 459,  7.0, FIELD_TYPE_BOX),   # Campo 32
    Field("indicacao_acidente",     432, 455, 446, 461,  7.0, FIELD_TYPE_BOX),   # Campo 33

    # ── Dados da Autorização (seção inferior) ────────────────────────────────
    Field("data_admissao",           29, 683, 137, 689,  7.0, FIELD_TYPE_BOX),   # Campo 39
    Field("qtde_diarias_autorizadas",181, 683, 218, 689,  7.0, FIELD_TYPE_BOX),  # Campo 40
    Field("tipo_acomodacao_autorizada",271, 681, 296, 688, 7.0, FIELD_TYPE_BOX), # Campo 41
    Field("codigo_operadora_autorizado", 30, 708, 193, 714, 7.0, FIELD_TYPE_BOX),# Campo 42
    Field("nome_hospital_autorizado",204, 708, 465, 714,  7.5, FIELD_TYPE_TEXT, max_chars=45), # Campo 43
    Field("codigo_cnes_autorizado",  470, 706, 553, 712,  7.0, FIELD_TYPE_BOX),  # Campo 44

    # ── Observação / Justificativa — 3 linhas (Campo 45) ─────────────────────
    Field("observacao_justificativa", 27, 727, 518, 757,  7.0, FIELD_TYPE_BLOCK,
          max_chars=300, max_lines=3, line_height=9.5),

    # ── Data da Solicitação (Campo 46) ────────────────────────────────────────
    Field("data_solicitacao",         28, 776, 136, 782,  7.0, FIELD_TYPE_BOX),
]

# ── 12 Linhas de Procedimentos (Campos 34–38 × 12 linhas) ────────────────────
for n, y0 in PROC_ROWS.items():
    y1 = y0 + 6.0
    INTERNACAO_FIELDS += [
        Field(f"tabela_{n}",               34, y0,  59, y1,  7.0, FIELD_TYPE_BOX),
        Field(f"codigo_procedimento_{n}",  62, y0, 181, y1,  6.5, FIELD_TYPE_BOX),
        Field(f"descricao_procedimento_{n}", 184, y0, 429, y1, 7.0, FIELD_TYPE_TEXT, max_chars=100),
        Field(f"quantidade_solicitada_{n}", 433, y0, 470, y1, 7.0, FIELD_TYPE_BOX),
        Field(f"quantidade_autorizada_{n}", 486, y0, 524, y1, 7.0, FIELD_TYPE_BOX),
    ]


def fill_internacao(template_path: str, variables: dict, output_path: str, debug: bool = False):
    fill_pdf(template_path, INTERNACAO_FIELDS, variables, output_path, PDF_W, PDF_H, debug=debug)
    print(f"✓ Internação gerada → {output_path}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Uso: python fill_unimed_internacao_v1.py <template.pdf> <variaveis.json> <output.pdf> [--debug]")
        sys.exit(1)
    debug_mode = "--debug" in sys.argv
    with open(sys.argv[2], encoding="utf-8") as f:
        variables = json.load(f)
    fill_internacao(sys.argv[1], variables, sys.argv[3], debug=debug_mode)
