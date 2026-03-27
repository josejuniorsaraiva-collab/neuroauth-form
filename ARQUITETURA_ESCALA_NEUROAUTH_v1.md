# ARQUITETURA_ESCALA_NEUROAUTH_v1
**Sistema:** NEUROAUTH — Plataforma de Autorizações Médicas
**Versão:** 1.0.0 | **Data:** 2026-03-27
**Status:** Documento de referência arquitetural — modelo-alvo de escala

---

## 0. PREMISSA

O NEUROAUTH não é um formulário. É um sistema operacional de autorizações médicas.
A arquitetura de escala não destrói o que existe — ela revela a estrutura que sempre deveria ter existido.

Princípio de transição: **Expansão por camadas, não reescrita.**

---

## 1. VISÃO GERAL — ARQUITETURA EM 6 CAMADAS

```
╔══════════════════════════════════════════════════════════════════╗
║                    NEUROAUTH — PLATAFORMA                       ║
╠══════════════════════════════════════════════════════════════════╣
║  CAMADA 6 │ ORQUESTRAÇÃO      login → fill → validate → send   ║
╠══════════════════════════════════════════════════════════════════╣
║  CAMADA 5 │ INTEGRAÇÃO        Make / API / Sheets / Drive       ║
╠══════════════════════════════════════════════════════════════════╣
║  CAMADA 4 │ RENDER            specs PDF / overlays / preview    ║
╠══════════════════════════════════════════════════════════════════╣
║  CAMADA 3 │ REGRAS            TISS / anti-glosa / por convênio  ║
╠══════════════════════════════════════════════════════════════════╣
║  CAMADA 2 │ NORMALIZAÇÃO      form → schema mestre → achatado   ║
╠══════════════════════════════════════════════════════════════════╣
║  CAMADA 1 │ DOMÍNIO           schemas mestres de todas entidades║
╚══════════════════════════════════════════════════════════════════╝
```

Cada camada tem **uma responsabilidade única**. Dados fluem para cima. Configuração flui para baixo.

---

## 2. CAMADA 1 — DOMÍNIO

**Responsabilidade:** Definir o que existe no mundo do NEUROAUTH.
**Regra:** Nenhum campo de negócio pode existir fora de um schema mestre desta camada.

### Entidades do domínio

| Entidade | Schema | Responsabilidade |
|---|---|---|
| Convênio | `CONVENIO_SCHEMA_MESTRE_v1.json` | Regras, templates, codificação por operadora |
| Hospital | `HOSPITAL_SCHEMA_MESTRE_v1.json` | Configurações locais, fluxo interno |
| Médico | `MEDICO_SCHEMA_MESTRE_v1.json` | Perfil operacional, defaults, permissões |
| Paciente | `PACIENTE_SCHEMA_MESTRE_v1.json` | Dados cadastrais + histórico de guias |
| Procedimento | `PROCEDIMENTO_SCHEMA_MESTRE_v1.json` | TUSS, CBHPM, OPME associados, indicações |
| Guia | `GUIA_SCHEMA_MESTRE_v1.json` | Documento raiz: qualquer tipo de guia |
| Autorização | `AUTORIZACAO_SCHEMA_MESTRE_v1.json` | Resultado pós-submissão ao convênio |
| OPME | `OPME_SCHEMA_MESTRE_v1.json` | Materiais, ANVISA, fabricantes, valores |
| Billing | `BILLING_SCHEMA_MESTRE_v1.json` | Cobrança por guia, plano, período |
| Auditoria | `AUDITORIA_SCHEMA_MESTRE_v1.json` | Log imutável de toda ação do sistema |

### O que já existe hoje

| Entidade | Status | Arquivo atual |
|---|---|---|
| Convênio | Parcial — hardcoded no frontend | `neuroauth_compliance_engine.js::CONVENIO_RULES` |
| Hospital | Ausente — só campo de texto | — |
| Médico | Parcial — perfil na sessão Google | `index.html::naFetchPerfil()` |
| Paciente | Ausente — dados no formulário sem schema | — |
| Procedimento | Parcial — SURGICAL_PROFILES no frontend | `index.html::SURGICAL_PROFILES{}` |
| Guia | Parcial — 3 tipos isolados | `fill_unimed_*.py` |
| Autorização | Ausente — campos `_pos_autorizacao` isolados | `INTERNACAO_SCHEMA_ACHATADO_v1.json` |
| OPME | Parcial — embutida na guia | `fill_unimed_opme_v2.py` |
| Billing | Parcial — bridge funcional em memória | `neuroauth_billing_bridge.js` |
| Auditoria | Parcial — `naLog()` estruturado | `index.html::naLog()` |

### O que está ausente e precisa nascer

- Schema Mestre de Paciente (identidade sem PHI em trânsito)
- Schema Mestre de Procedimento (tabela unificada TUSS+CBHPM)
- Schema Mestre de Autorização (ciclo completo pós-envio)
- Schema Mestre de OPME (catálogo com ANVISA, fabricante, valor por convênio)

---

## 3. CAMADA 2 — NORMALIZAÇÃO

**Responsabilidade:** Transformar dados brutos do frontend em estruturas canônicas.
**Regra:** Toda transformação tem uma regra explícita. Nada é implícito.

### Pipeline de normalização

```
[FORMULÁRIO HTML]
       │  collect() — extrai campos do DOM como objeto flat
       ▼
[SCHEMA MESTRE]
  { paciente: {...}, medico: {...}, procedimentos: [...], ... }
       │  normalização (ver NORMALIZACAO_MASTER_NEUROAUTH_v1.md)
       ▼
[SCHEMA ACHATADO]
  { PROC_01, PROC_02, ..., CID_01, ..., _pos_autorizacao: {} }
       │
       ├──▶ Make.com / webhook
       ├──▶ FastAPI / PDF engine
       └──▶ Google Sheets / log
```

### Responsabilidades de normalização

| Transformação | Regra | Status atual |
|---|---|---|
| Array procedimentos → slots PROC_NN | MAX_SLOTS_PDF = 12 (papel), sem limite no mestre | Implementado (internação) |
| Array CIDs → CID_01..04 | Máximo 4 por guia TISS | Implementado |
| Boolean → código TISS | `true→"S"`, `false→"N"` | Implementado |
| Data ISO → DD/MM/YYYY | Formato TISS obrigatório | Implementado |
| CRM → número + UF | `"CRM/CE 18227"` → `{numero:"18227", uf:"CE"}` | Implementado |
| Defaults por médico | Perfil da sessão popula campos | Parcial |
| Defaults por convênio | Registro ANS, codificação | Parcial — hardcoded |
| Defaults por hospital | Endereço, CNES, acomodação | Ausente |
| Campos pós-autorização | Isolados em `_pos_autorizacao{}` | Implementado |

---

## 4. CAMADA 3 — REGRAS

**Responsabilidade:** Encapsular toda lógica de negócio clínico-operacional.
**Regra:** Nenhuma regra clínica vive no frontend como código imperativo. Toda regra é dado parametrizável.

### Sub-camadas de regras

```
REGRAS
  ├── TISS Geral          ← padrão ANS, aplica a todos
  ├── Por Convênio        ← Unimed-CE difere de Bradesco difere de Amil
  ├── Por Hospital        ← Hospital A exige campo X que Hospital B não exige
  ├── Por Região          ← Ceará pode ter regras diferentes de SP
  ├── Por Especialidade   ← Neurocirurgia difere de Ortopedia
  └── Anti-Glosa          ← sugestões contextuais de texto clínico
```

### Estrutura de uma regra

```json
{
  "id_regra": "R-UNIMED-CE-001",
  "tipo": "campo_obrigatorio",
  "nivel": "bloqueante",
  "convênio": "unimed_ce",
  "hospital": "*",
  "especialidade": "neurocirurgia",
  "tipo_guia": "internacao",
  "campo": "indicacao_clinica",
  "condicao": "sempre",
  "mensagem": "Indicação clínica é obrigatória para autorização de internação.",
  "bloqueante": true,
  "sugestao_reescrita": null
}
```

### O que existe hoje

- `neuroauth_compliance_engine.js::CONVENIO_RULES{}` — regras por operadora embutil no JS
- Validações hardcoded no `confirmedSend()` — mistura regra com orquestração

### O que precisa nascer

- `REGRAS_COMPLIANCE_SCHEMA_v1.json` — formato canônico de regra
- Loader dinâmico: regras carregadas por contexto `{convenio, hospital, especialidade}`
- Separação entre regras de *entrada de dados* (formulário) e regras de *conformidade TISS* (envio)

---

## 5. CAMADA 4 — RENDER

**Responsabilidade:** Transformar dados normalizados em documentos físicos.
**Regra:** Nenhuma coordenada PDF vive fora desta camada. Nenhum layout é hardcoded na camada de negócio.

### Sub-componentes

```
RENDER
  ├── Render Spec          ← mapeamento campo → coordenada por documento
  ├── Template PDF         ← formulário em branco (TEMPLATES_OFICIAIS/)
  ├── Fill Engine          ← motor de overlay (fill_engine.py)
  ├── Motor por Documento  ← fill_unimed_sadt_v2.py, fill_unimed_internacao_v1.py...
  ├── Preview HTML         ← renderização visual antes do envio (index.html)
  └── Case Summary         ← resumo clínico gerado (case_summary.py)
```

### Render Spec — estrutura

```json
{
  "documento": "sadt_unimed",
  "versao": "v2",
  "dimensoes": { "largura": 842, "altura": 595, "orientacao": "landscape" },
  "campos": [
    {
      "id": "registro_ans",
      "tipo": "box",
      "x1": 24, "y1": 108, "x2": 96, "y2": 114,
      "font_size": 7.0
    }
  ]
}
```

### O que existe hoje

| Componente | Status | Arquivo |
|---|---|---|
| Fill Engine base | ✅ Produção | `fill_engine.py` |
| Motor SADT Unimed | ✅ Produção | `fill_unimed_sadt_v2.py` |
| Motor OPME Unimed | ✅ Produção | `fill_unimed_opme_v2.py` |
| Motor Internação Unimed | ✅ Produção | `fill_unimed_internacao_v1.py` |
| Render Spec SADT+OPME | ✅ Parcial | `RENDER_SPEC_MASTER_SADT_OPME_v4.01.00.json` |
| Preview HTML | ✅ Produção | `index.html::renderInternacao()` etc. |

### O que está ausente

- Render Spec formal para Internação
- Motor para novos convênios (Bradesco, SulAmérica, Amil)
- Separação entre spec de coordenadas e lógica de preenchimento

---

## 6. CAMADA 5 — INTEGRAÇÃO

**Responsabilidade:** Conectar o NEUROAUTH com sistemas externos.
**Regra:** Toda integração é assíncrona por padrão. Falha de integração nunca bloqueia a guia.

### Conectores ativos

| Conector | Status | Protocolo |
|---|---|---|
| Make.com (envio de guia) | ✅ Ativo | POST webhook → cenário |
| Make.com (perfil médico) | ⚠️ HTTP 410 | POST webhook → planilha |
| FastAPI (geração PDF) | ✅ Pronto | REST — aguardando deploy |
| Google Sheets (médicos) | ✅ Ativo | Apps Script |
| Google Sheets (episódios) | ✅ Ativo | Make.com → Sheets |
| Google Drive (PDFs) | ✅ Ativo | Make.com → Drive |
| Asaas/Stripe (billing) | ⏳ Mock | bridge.js em memória |
| Google Docs (resumo) | ✅ Ativo | Make.com → Docs |

### Arquitetura de integração (modelo-alvo)

```
index.html
    │  POST payload + session_token
    ▼
Make.com (Orquestrador)
    ├── valida id_token (Google tokeninfo)
    ├── busca perfil médico (Sheets)
    ├── POST /gerar_sadt    → FastAPI → PDF
    ├── POST /gerar_opme    → FastAPI → PDF
    ├── POST /gerar_internacao → FastAPI → PDF
    ├── salva PDFs no Drive
    ├── registra episódio no Sheets
    └── notifica médico (email/WhatsApp)
```

---

## 7. CAMADA 6 — ORQUESTRAÇÃO

**Responsabilidade:** Definir o fluxo de trabalho e os estados de cada guia.
**Regra:** O estado de uma guia é sempre explícito, persistido e auditável.

### Estados do workflow

```
rascunho → preenchimento → validacao → pronto_preview
    → enviado_make → documento_gerado → pendente_autorizacao
    → autorizado | negado → faturado → arquivado
```

### O que existe hoje

- `index.html` implementa os estados de forma implícita via flags JavaScript
- `__NA_STATE__` guarda apenas o estado de compliance (não o estado da guia)
- Não há persistência de estado entre sessões

### O que precisa nascer

- Máquina de estados explícita (ver `WORKFLOW_OPERACIONAL_NEUROAUTH_v1.md`)
- Persistência de estado no Google Sheets (episódio como log de estado)
- Notificações de transição de estado

---

## 8. DIAGRAMA DE FLUXO DE DADOS COMPLETO

```
╔═══════════════════════════════════════════════════════════════════╗
║ MÉDICO / SECRETÁRIA                                               ║
║                                                                   ║
║  [Google Login]                                                   ║
║       │  id_token (JWT bruto)                                    ║
║       ▼                                                           ║
║  [Make.com: validar token]                                        ║
║       │  POST {id_token} → Google tokeninfo → busca Sheets       ║
║       │  ← {perfil médico: crm, hospital, convênios...}          ║
║       ▼                                                           ║
║  [index.html: formulário]                                         ║
║       │  collect() → payload flat                                 ║
║       │                                                           ║
║       │  CAMADA 3: naRunCompliance(payload, convenio)            ║
║       │  → { can_print, blocks[], warnings[] }                   ║
║       │                                                           ║
║       │  CAMADA 2: buildInternacaoVars(d) / collect()            ║
║       │  → schema achatado com defaults do perfil                ║
║       │                                                           ║
║       │  confirmedSend() → POST Make.com                         ║
║       ▼                                                           ║
║  [Make.com: orquestrador]                                         ║
║       │                                                           ║
║       ├──▶ POST /gerar_sadt        [FastAPI]                     ║
║       │         ▼                                                 ║
║       │    fill_unimed_sadt_v2.py                                 ║
║       │    fill_engine.py → overlay → pypdf merge                ║
║       │    ← SADT_{case_id}.pdf                                  ║
║       │                                                           ║
║       ├──▶ POST /gerar_opme        [FastAPI]                     ║
║       │    ← OPME_{case_id}.pdf                                  ║
║       │                                                           ║
║       ├──▶ POST /gerar_internacao  [FastAPI]                     ║
║       │    ← INTERNACAO_{case_id}.pdf                            ║
║       │                                                           ║
║       ├──▶ Salva PDFs → Google Drive                             ║
║       ├──▶ Registra episódio → Google Sheets                     ║
║       ├──▶ Notifica médico → email/WhatsApp                      ║
║       └──▶ Registra billing → BillingBridge                      ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## 9. SEPARAÇÃO ENTRE O QUE JÁ EXISTE E O QUE PRECISA NASCER

### Já existe — mapeado para a arquitetura de escala

| Componente atual | Camada | Estado |
|---|---|---|
| `fill_engine.py` + motores `.py` | Camada 4 — Render | ✅ Produção |
| `api/app.py` (FastAPI) | Camada 5 — Integração | ✅ Pronto |
| `neuroauth_compliance_engine.js` | Camada 3 — Regras | ✅ Funcional, precisa externalizar |
| `index.html::collect()` | Camada 2 — Normalização | ✅ Funcional, schema formal ausente |
| `TEMPLATES_OFICIAIS/` | Camada 4 — Render | ✅ Produção |
| `neuroauth_billing_bridge.js` | Camada 5 — Integração | ✅ Em memória, adapter real pendente |
| `neuroauth_access_policy.js` | Camada 6 — Orquestração | ✅ Funcional |
| `schemas/internacao/` | Camada 1 — Domínio | ✅ Implementado para Internação |
| Make.com / Sheets / Drive | Camada 5 — Integração | ✅ Ativo |

### Precisa nascer — gap de arquitetura

| Componente | Camada | Prioridade |
|---|---|---|
| `CONVENIO_SCHEMA_MESTRE_v1.json` | Camada 1 | Alta |
| `HOSPITAL_SCHEMA_MESTRE_v1.json` | Camada 1 | Alta |
| `MEDICO_SCHEMA_MESTRE_v1.json` | Camada 1 | Alta |
| `GUIA_SCHEMA_MESTRE_v1.json` | Camada 1 | Alta |
| `REGRAS_COMPLIANCE_SCHEMA_v1.json` | Camada 3 | Alta |
| Loader dinâmico de regras por contexto | Camada 3 | Média |
| Schema Mestre de Paciente | Camada 1 | Média |
| Schema Mestre de Procedimento | Camada 1 | Média |
| Render Spec formal para Internação | Camada 4 | Média |
| Máquina de estados explícita | Camada 6 | Média |
| Multi-tenant (isolamento por clínica) | Camada 6 | Baixa (Fase 4) |

---

## 10. PRINCÍPIOS IMUTÁVEIS DA ARQUITETURA DE ESCALA

1. **Schema Mestre é lei.** Nenhum campo nasce fora de um schema mestre.
2. **Regra é dado.** Nenhuma regra de negócio é código imperativo — é configuração.
3. **Convênio é entidade.** Não é um campo de texto. É um objeto com propriedades.
4. **Hospital é entidade.** Não é uma string. É um registro com CNES, convênios, fluxo.
5. **Médico é perfil operacional.** Login é só autenticação. O perfil determina o comportamento.
6. **Guia é especialização de mestre.** SADT, OPME e Internação são instâncias do mesmo domínio.
7. **Render é separado de lógica.** Coordenadas PDF não vivem junto com regras de negócio.
8. **Falha de integração nunca bloqueia o documento.** O PDF sempre pode ser gerado.
9. **Estado é explícito e persistido.** Nenhuma guia tem estado implícito.
10. **Expansão é adição, não modificação.** Novos convênios adicionam arquivos, não editam os existentes.
