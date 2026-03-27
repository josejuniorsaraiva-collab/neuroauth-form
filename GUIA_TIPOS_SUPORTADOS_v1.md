# GUIA_TIPOS_SUPORTADOS_v1
**Sistema:** NEUROAUTH | **Data:** 2026-03-27
**Escopo:** Todos os tipos de guia — implementados e planejados — como especializações do schema mestre

---

## 1. PRINCÍPIO

Toda guia é uma especialização de `GUIA_SCHEMA_MESTRE_v1.json`.
Nenhum tipo de guia é um sistema independente.

```
GUIA_SCHEMA_MESTRE
    │
    ├── sadt              ✅ em produção
    ├── opme              ✅ em produção
    ├── internacao        ✅ em produção
    ├── resumo_clinico    🔨 implementado no Make.com
    ├── anexo_justificativa ⏳ planejado
    ├── apac              ⏳ planejado
    ├── consulta          ⏳ planejado
    └── prorrogacao       ⏳ planejado
```

---

## 2. TIPOS IMPLEMENTADOS

### 2.1 SADT — Solicitação, Autorização e Demonstrativo de Terapias

**Descrição:** Guia de solicitação de exames, procedimentos e terapias.
**Quando usar:** Todo procedimento cirúrgico ou diagnóstico eletivo.

**Especialização do mestre:**
```
campos_adicionais:
  - codigo_proc (TUSS)
  - cod_cbhpm
  - tipo_guia_tiss: "4" (SADT)
  - regiao_anatomica
  - lateralidade
  - via_acesso

campos_ausentes:
  - dados de internação (tipo_internacao, regime, diárias)
  - dados de OPME

motor_pdf: fill_unimed_sadt_v2.py
template: blank_sadt_template.pdf
dimensoes: A4 landscape (842×595 pt)
max_procedimentos: 5 linhas
```

**Status:** ✅ Produção | Unimed CE

---

### 2.2 OPME — Órteses, Próteses e Materiais Especiais

**Descrição:** Guia de solicitação de materiais cirúrgicos especiais.
**Quando usar:** Qualquer cirurgia que utilize implante, prótese ou material especial.

**Especialização do mestre:**
```
campos_adicionais:
  - empresa_opme
  - justificativa_opme
  - para cada material: tabela, codigo, descricao, opcao, qtd, valor_unitario,
                        anvisa, fabricante, numero_autorizacao

campos_ausentes:
  - dados de internação
  - procedimentos cirúrgicos (SADT cuida disso)

motor_pdf: fill_unimed_opme_v2.py
template: blank_opme_template.pdf
dimensoes: A4 landscape (842×595 pt)
max_materiais: 6 linhas (2 sub-linhas cada)
```

**Nota de negócio:** OPME é sempre acompanhante do SADT — raramente existe sozinha.
**Status:** ✅ Produção | Unimed CE

---

### 2.3 GUIA DE INTERNAÇÃO — Solicitação de Internação Hospitalar

**Descrição:** Guia de solicitação de internação cirúrgica ou clínica.
**Quando usar:** Qualquer procedimento que exija internação (mesmo que ambulatorial com observação).

**Especialização do mestre:**
```
campos_adicionais:
  - tipo_internacao (enum: 1=clínica, 2=cirúrgica, 3=obstetrica...)
  - regime_internacao (enum: 1=internação, 2=hospital_dia, 3=ambulatorial)
  - carater_atendimento
  - qtde_diarias_solicitadas
  - previsao_opme (S/N)
  - previsao_quimioterapico (S/N)
  - nome_hospital
  - indicacao_clinica (bloco de texto)
  - observacao_justificativa (bloco de texto)

campos_ausentes:
  - via_acesso (campo da SADT)

motor_pdf: fill_unimed_internacao_v1.py
template: blank_internacao_template.pdf
dimensoes: A4 portrait (595×842 pt)
max_procedimentos: 12 linhas
max_cids: 4
```

**Status:** ✅ Produção | Unimed CE

---

### 2.4 RESUMO CLÍNICO

**Descrição:** Documento narrativo do caso clínico para o convênio.
**Quando usar:** Casos complexos que exigem justificativa adicional.

**Especialização do mestre:**
```
campos_presentes:
  - indicacao_clinica (texto completo)
  - achados_exame (texto completo)
  - historico_clinico
  - evolucao_caso
  - justificativa_procedimento
  - referencias_bibliograficas (opcional)

formato_saida: Google Docs (não PDF por coordenadas)
gerado_por: Make.com → Google Docs template
```

**Status:** 🔨 Implementado via Make.com/Docs | Sem motor Python

---

## 3. TIPOS PLANEJADOS

### 3.1 ANEXO DE JUSTIFICATIVA

**Quando:** Convênios que exigem documento complementar à SADT com justificativa extensa.
**Formato:** PDF ou Docs gerado pelo motor de texto.

### 3.2 APAC — Autorização de Procedimento Ambulatorial de Alta Complexidade

**Quando:** Procedimentos de alto custo/complexidade (quimioterapia, radioterapia, etc.)
**Diferença:** Aprovação prévia obrigatória, validade por período, relatório periódico.

### 3.3 CONSULTA

**Quando:** Marcação de consulta especializada com autorização prévia.
**Diferença:** Sem procedimentos ou OPME, apenas contexto clínico e CRM.

### 3.4 PRORROGAÇÃO DE INTERNAÇÃO

**Quando:** Internação supera o número de diárias autorizado.
**Diferença:** Referencia guia de internação original, acrescenta justificativa de prorrogação.

---

## 4. RELAÇÃO ENTRE TIPOS DE GUIA

```
CASO CIRÚRGICO TÍPICO:
┌─────────────────────────────────────────────────────────────┐
│ 1. Guia de Internação   ← solicitar internação             │
│ 2. SADT                 ← solicitar procedimento cirúrgico  │
│ 3. OPME (se aplicável)  ← solicitar materiais              │
│ 4. Resumo Clínico       ← justificativa complementar       │
└─────────────────────────────────────────────────────────────┘

VÍNCULO NO SCHEMA MESTRE:
Todas as 3-4 guias compartilham o mesmo:
  - paciente (nome, CNS, carteira)
  - médico (CRM, CBO)
  - hospital (CNES)
  - convênio (registro ANS)
  - contexto clínico (CIDs, indicação)
  - número de caso (case_id)
```

---

## 5. REGRA DE ESPECIALIZAÇÃO

Para criar um novo tipo de guia:

1. **Identificar os campos exclusivos** do novo tipo (não presentes no mestre)
2. **Identificar os campos ausentes** do mestre neste tipo
3. **Documentar** em `docs/<tipo>/`
4. **Criar schema especializado** baseado no mestre em `schemas/guias/<tipo>_schema_v1.json`
5. **Criar motor PDF** `fill_<convenio>_<tipo>_v1.py`
6. **Registrar template** em `TEMPLATES_OFICIAIS/`
7. **Adicionar endpoint** na API
8. **Atualizar** `render_strategy` no schema do convênio

**Nunca criar campos que são comuns ao mestre.** Só especializa o que é diferente.
