# ARQUITETURA_NEUROAUTH_v1
**Sistema:** NEUROAUTH — Plataforma de Geração de Guias Médicas
**Versão:** 1.0.0 | **Data:** 2026-03-27
**Escopo:** Arquitetura completa, fluxo de dados, mapa de componentes, regras de evolução

---

## 1. VISÃO GERAL

O NEUROAUTH é uma plataforma SaaS para neurocirurgiões que automatiza a geração de guias médicas para convênios de saúde. O sistema elimina erros de preenchimento, aplica regras TISS e anti-glosa em tempo real, e envia documentos diretamente para os convênios via Make.com.

```
┌─────────────────────────────────────────────────────────────────┐
│                         NEUROAUTH                               │
│                                                                 │
│  ┌──────────────┐    ┌─────────────┐    ┌──────────────────┐  │
│  │   Médico /   │    │  index.html │    │   Make.com       │  │
│  │  Secretária  │───▶│  (SPA PWA)  │───▶│  (Automação)     │  │
│  └──────────────┘    └──────┬──────┘    └──────────────────┘  │
│                             │                                   │
│                      ┌──────▼──────┐                           │
│                      │  FastAPI    │                           │
│                      │  (api/)     │                           │
│                      └──────┬──────┘                           │
│                             │                                   │
│                      ┌──────▼──────┐                           │
│                      │ fill_engine │                           │
│                      │  + motores  │                           │
│                      │   .py       │                           │
│                      └──────┬──────┘                           │
│                             │                                   │
│                      ┌──────▼──────┐                           │
│                      │  PDFs       │                           │
│                      │  (output)   │                           │
│                      └─────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. ESTRUTURA DE DIRETÓRIOS

```
neuroauth/                              ← raiz do repositório (GitHub Pages)
│
├── index.html                          ← SPA principal (NUNCA MOVER)
├── sw.js                               ← Service Worker PWA
├── manifest.json                       ← Manifesto PWA
├── icon-192.png / icon-512.png         ← Ícones PWA
│
├── neuroauth_*.js                      ← Módulos JS da SPA (NUNCA MOVER)
│   ├── neuroauth_compliance_engine.js  ─ Motor de compliance TISS
│   ├── neuroauth_billing_bridge.js     ─ Bridge de cobrança
│   ├── neuroauth_access_policy.js      ─ Política de acesso por inadimplência
│   ├── neuroauth_billing_bridge_client.js ─ Facade de billing para frontend
│   ├── neuroauth_monthly_billing_aggregator.js ─ Agregador de billing mensal
│   ├── neuroauth_autofill_engine.js    ─ Preenchimento automático
│   ├── neuroauth_case_reuse_engine.js  ─ Reuso de casos anteriores
│   ├── neuroauth_smart_reuse_engine.js ─ Reuso inteligente
│   ├── neuroauth_app_controller.js     ─ Controlador principal da SPA
│   ├── neuroauth_analytics.js          ─ Analytics de uso
│   ├── neuroauth_notification_service.js ─ Notificações
│   └── neuroauth_roi_engine.js         ─ Cálculo de ROI
│
├── *.py                                ← Motores de PDF (NUNCA MOVER)
│   ├── fill_engine.py                  ─ Motor base (overlay + pypdf)
│   ├── fill_unimed_sadt_v2.py          ─ Guia SADT Unimed
│   ├── fill_unimed_opme_v2.py          ─ Guia OPME Unimed
│   ├── fill_unimed_internacao_v1.py    ─ Guia Internação Unimed
│   ├── validacao_neuroauth.py          ─ Validação de payloads
│   ├── case_summary.py                 ─ Resumo de casos
│   └── neuroauth_utils.py              ─ Utilitários Python
│
├── api/                                ← FastAPI backend (NUNCA MOVER)
│   ├── app.py                          ─ Endpoints REST
│   ├── requirements.txt
│   ├── Dockerfile
│   └── render.yaml
│
├── TEMPLATES_OFICIAIS/                 ← Templates PDF em branco (NUNCA MOVER)
│   ├── blank_sadt_template.pdf
│   ├── blank_opme_template.pdf
│   └── blank_internacao_template.pdf
│
├── schemas/                            ← FONTE ÚNICA DE VERDADE dos dados
│   ├── RENDER_SPEC_MASTER_SADT_OPME_v4.01.00.json
│   ├── internacao/
│   │   ├── INTERNACAO_SCHEMA_MESTRE_v1.json
│   │   ├── INTERNACAO_SCHEMA_ACHATADO_v1.json
│   │   └── INTERNACAO_PAYLOAD_SCHEMA_v1.json
│   └── test/
│       ├── TEST_PAYLOAD_NEUROAUTH_CRANIOTOMIA_v1.json
│       ├── test_PROC002_artrodese_cervical.json
│       ├── test_PROC004_endoscopia_uniportal.json
│       ├── test_PROC013_embolizacao_aneurisma.json
│       └── variaveis_teste.json
│
├── docs/                               ← Documentação técnica
│   ├── ARQUITETURA_NEUROAUTH_v1.md     ← ESTE ARQUIVO
│   ├── NEUROAUTH_ARQUITETURA_AUTH_v1.md
│   ├── NEUROAUTH_FLUXO_PRODUCAO_v1.md
│   ├── SECURITY_AUDIT_STAGE3_NEUROAUTH.md
│   ├── HARDENING_DELTA_LOG.md
│   ├── internacao/
│   │   ├── INTERNACAO_MAPEAMENTO_OFICIAL_v1.md
│   │   ├── INTERNACAO_NORMALIZACAO_v1.md
│   │   └── INTERNACAO_INTEGRACAO_v1.md
│   └── billing/
│       ├── NEUROAUTH_BILLING_MENSAL.json
│       └── NEUROAUTH_BILLING_MENSAL_v2.json
│
├── integration/                        ← Conectores externos
│   ├── make/
│   │   ├── make_blueprint.json
│   │   └── NEUROAUTH_Checklist_Make_Validacao.html
│   └── sheets/
│       ├── NEUROAUTH_Bootstrap.gs
│       ├── NEUROAUTH_Setup.gs
│       └── NEUROAUTH_ImportarSheets.gs
│
└── render/                             ← Motores de renderização (FUTURO)
    └── README.md
```

---

## 3. FLUXO DE DADOS

### 3.1 Fluxo Primário (Geração de Guia)

```
[1] MÉDICO preenche index.html
        │
        ▼
[2] collect() → payload JavaScript
        │
        ▼
[3] COMPLIANCE ENGINE valida payload
    • Regras TISS por convênio
    • Alertas anti-glosa
    • Campos obrigatórios
        │
        ▼
[4] confirmedSend() → POST Make.com webhook
    {
      payload clínico completo,
      session_token (C1 barreira),
      neuroauth_version,
      timestamp
    }
        │
        ▼
[5] Make.com processa:
    • Valida id_token Google (tokeninfo)
    • Busca perfil médico na planilha
    • Rota para cenário correto
    • POST /gerar_sadt + /gerar_opme + /gerar_internacao (API)
        │
        ▼
[6] FastAPI (api/app.py) recebe payload
        │
        ▼
[7] fill_engine.py + fill_unimed_*_v*.py
    • Mapeia variáveis → coordenadas PDF
    • Overlay transparente sobre template
    • pypdf merge → PDF final
        │
        ▼
[8] PDF retornado via FileResponse
        │
        ▼
[9] Make.com entrega PDF ao médico/convênio
```

### 3.2 Fluxo de Autenticação

```
[1] Google Sign-In → id_token (JWT opaco, não decodificado no cliente)
        │
        ▼
[2] POST NA_PROFILE_WH {id_token}
        │
        ▼
[3] Make.com valida token em:
    https://oauth2.googleapis.com/tokeninfo?id_token=<token>
        │
        ▼
[4] Extrai email, busca na planilha MEDICOS
        │
        ├─ 401 → Email não autorizado
        │
        └─ 200 → Retorna perfil {medico_nome, crm, cbo, hospital_padrao, ...}
                      │
                      ▼
               [5] sessionStorage.na_session
                   (TTL: NA_SESSION_TTL)
```

### 3.3 Fluxo Schema → PDF

```
schemas/internacao/INTERNACAO_SCHEMA_MESTRE_v1.json
        │
        │  (normalização: docs/internacao/INTERNACAO_NORMALIZACAO_v1.md)
        ▼
schemas/internacao/INTERNACAO_SCHEMA_ACHATADO_v1.json
        │
        │  (mapeamento: docs/internacao/INTERNACAO_MAPEAMENTO_OFICIAL_v1.md)
        ▼
fill_unimed_internacao_v1.py::INTERNACAO_FIELDS[]
        │
        ▼
fill_engine.py::fill_pdf()
        │
        ▼
TEMPLATES_OFICIAIS/blank_internacao_template.pdf
        │  (overlay)
        ▼
INTERNACAO_{case_id}.pdf
```

---

## 4. COMPONENTES E RESPONSABILIDADES

### 4.1 Frontend (index.html)

Responsabilidade única: **coletar dados clínicos e enviar para Make.com**.

| Subsistema | Função |
|---|---|
| `collect()` | Extrai todos os campos do formulário em um objeto flat |
| `naRunCompliance()` | Valida payload contra regras TISS do convênio |
| `confirmedSend()` | Envia payload ao Make.com com token de sessão |
| `openPreview()` | Renderiza preview HTML das guias antes do envio |
| `buildInternacaoVars()` | Mapeia collect() → variáveis do motor de internação |
| `saveDraft()` | Persiste apenas campos não-PHI em sessionStorage |
| `__NA_STATE__` | Cache operacional (sem PHI): proc_id, convenio, can_print |

**Regra de ouro:** O `index.html` nunca conhece coordenadas PDF. Ele só monta payloads.

### 4.2 Motor de Compliance (neuroauth_compliance_engine.js)

Valida payloads contra regras TISS por convênio antes do envio.
Opera em modo puramente local (sem rede) — determinístico e auditável.

```
validateBeforePrint(payload, convenio) → {
  can_print: boolean,
  blocks: [...],      // impedem envio
  warnings: [...]     // alertas anti-glosa
}
```

### 4.3 FastAPI (api/app.py)

Endpoints ativos:

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/` | Health check + versão |
| GET | `/health` | Status da API |
| POST | `/gerar_sadt` | Gera PDF Guia SADT |
| POST | `/gerar_opme` | Gera PDF Guia OPME |
| POST | `/gerar_internacao` | Gera PDF Guia Internação |
| POST | `/gerar_resumo` | Gera PDF Resumo Clínico |
| GET | `/validar` | Valida payload sem gerar PDF |
| POST | `/gerar_tudo` | Gera SADT + OPME + Resumo |
| GET | `/arquivo/{filename}` | Serve PDF gerado |

### 4.4 Motor de PDF (fill_engine.py)

Arquitetura de **overlay transparente**:

```python
Campo → Field(id, x1, y1, x2, y2, size, tipo)
     → build_overlay(fields, variables, page_w, page_h)   # reportlab
     → fill_pdf(template, overlay)                        # pypdf merge
     → PDF final
```

Conversão de coordenadas:
```
pdfplumber (y=0 topo)  →  reportlab (y=0 base)
rl_y = page_height - pdfplumber_y
```

Três tipos de campo:
- `FIELD_TYPE_BOX` — caixa com texto centrado
- `FIELD_TYPE_TEXT` — texto alinhado à esquerda
- `FIELD_TYPE_BLOCK` — bloco de texto multilinha

---

## 5. MODELO DE EVOLUÇÃO

### 5.1 Adicionar Novo Convênio

```
1. schemas/<convenio>/
   └── <GUIA>_SCHEMA_MESTRE_v1.json      ← definir campos novos
   └── <GUIA>_SCHEMA_ACHATADO_v1.json    ← derivar para Make/PDF

2. TEMPLATES_OFICIAIS/
   └── blank_<convenio>_<guia>_template.pdf  ← template oficial

3. fill_<convenio>_<guia>_v1.py          ← motor de preenchimento
   └── extrair coordenadas com pdfplumber
   └── mapear FIELDS[] com Field()
   └── def fill_<guia>(template, variables, output)

4. api/app.py
   └── novo Pydantic model: <Guia>Payload
   └── novo endpoint POST /gerar_<convenio>_<guia>

5. index.html
   └── adicionar campos ao collect() se necessário
   └── adicionar opção no select de convênio
   └── adicionar tab no painel de preview

6. docs/<convenio>/
   └── MAPEAMENTO, NORMALIZACAO, INTEGRACAO
```

### 5.2 Adicionar Nova Regra de Glosa

```
1. neuroauth_compliance_engine.js
   └── CONVENIO_RULES[<operadora>]
       └── required_fields: [...campos novos...]
       └── recommended_fields: [...campos recomendados...]
       └── validation_messages: {campo: 'Mensagem TISS específica'}
```

Regras são puramente declarativas — não há lógica condicional complexa.
Uma nova regra é apenas uma entrada no dicionário `CONVENIO_RULES`.

### 5.3 Adicionar Novo Tipo de Guia

```
Tipos de guia suportados em produção:
  ✅ SADT            (Solicitação, Autorização e Demonstrativo de Terapias)
  ✅ OPME            (Órteses, Próteses e Materiais Especiais)
  ✅ Internação       (Solicitação de Internação)
  ⏳ Consulta        (futuro)
  ⏳ APAC            (futuro)
  ⏳ Prorrogação     (futuro)

Para cada novo tipo: seguir padrão do item 5.1.
Schema Mestre → Schema Achatado → Motor Python → Endpoint API → Tab HTML
```

### 5.4 Versionar Motor de PDF

```
Convenção de nomes:
  fill_<convenio>_<guia>_v<N>.py

Ao criar v2:
  1. Criar fill_<convenio>_<guia>_v2.py (NUNCA editar v1)
  2. Atualizar import em api/app.py
  3. Manter v1 como fallback até validação completa

Princípio: versões antigas nunca são deletadas — apenas desativadas.
```

---

## 6. FONTE ÚNICA DE VERDADE (SSoT)

```
┌─────────────────────────────────────────────────────────────┐
│                    HIERARQUIA SSoT                          │
│                                                             │
│  schemas/<guia>/SCHEMA_MESTRE.json                         │
│          │                                                  │
│          │ normalização (NORMALIZACAO.md)                  │
│          ▼                                                  │
│  schemas/<guia>/SCHEMA_ACHATADO.json                       │
│          │                                                  │
│          │ mapeamento (MAPEAMENTO_OFICIAL.md)              │
│          ▼                                                  │
│  fill_*.py::FIELDS[]           ←  coordenadas PDF          │
│  index.html::collect()         ←  campos do formulário     │
│  api/app.py::Pydantic model    ←  contrato REST            │
│                                                             │
│  NUNCA criar campos novos fora do Schema Mestre.           │
│  NUNCA duplicar campos entre schemas.                      │
│  SEMPRE derivar Schema Achatado do Mestre.                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. REGRAS IMUTÁVEIS DE ARQUITETURA

1. **index.html nunca muda de localização.** É a raiz do GitHub Pages.
2. **Motores `.py` nunca são movidos.** A API importa por caminho relativo.
3. **TEMPLATES_OFICIAIS/ nunca é renomeado.** O path está hardcoded na API.
4. **Schemas são somente-adição.** Campos removidos viram `deprecated: true`.
5. **Versões antigas de motores nunca são deletadas** — apenas desativadas.
6. **PHI nunca é gravado em armazenamento persistente** (localStorage proibido).
7. **Bypass de autenticação proibido em código** — toda autenticação é server-side.
8. **Preços são definidos server-side** (PRICE_CATALOG no billing bridge).
9. **O compliance engine é puramente local** — sem dependência de rede.
10. **Toda mudança de schema requer nova versão** (v1 → v2, nunca editar v1).

---

## 8. CONVENÇÕES DE NOMENCLATURA

| Tipo | Padrão | Exemplo |
|---|---|---|
| Schema Mestre | `<GUIA>_SCHEMA_MESTRE_v<N>.json` | `INTERNACAO_SCHEMA_MESTRE_v1.json` |
| Schema Achatado | `<GUIA>_SCHEMA_ACHATADO_v<N>.json` | `INTERNACAO_SCHEMA_ACHATADO_v1.json` |
| Motor PDF | `fill_<convenio>_<guia>_v<N>.py` | `fill_unimed_internacao_v1.py` |
| Documentação | `<GUIA>_<TEMA>_v<N>.md` | `INTERNACAO_MAPEAMENTO_OFICIAL_v1.md` |
| Endpoint API | `/gerar_<guia>` | `/gerar_internacao` |
| Case ID | `{ano}-{CONVENIO}-{TIPO}-{num}` | `2026-UNIMED-INTERN-00001` |

---

## 9. ESTADO ATUAL DO SISTEMA (2026-03-27)

### Em Produção
| Componente | Status | Observação |
|---|---|---|
| Guia SADT Unimed | ✅ Produção | fill_unimed_sadt_v2.py |
| Guia OPME Unimed | ✅ Produção | fill_unimed_opme_v2.py |
| Guia Internação Unimed | ✅ Produção | fill_unimed_internacao_v1.py |
| Compliance Engine | ✅ Produção | neuroauth_compliance_engine.js |
| FastAPI Backend | ✅ Pronto | Aguardando deploy Render.com |

### Pendente
| Item | Bloqueio | Próximo passo |
|---|---|---|
| Autenticação real | Make.com webhook inativo (HTTP 410) | Reativar webhook, validar id_token |
| Deploy API | Não deployado | `render.yaml` pronto, executar deploy |
| `/gerar_tudo` com internação | Endpoint não inclui internação | Adicionar `fill_internacao` ao endpoint |
| Whitelist alpha | Vazia (comentada) | Popular com emails reais dos médicos alpha |

---

## 10. HISTÓRICO DE VERSÕES

| Versão | Data | Mudanças |
|---|---|---|
| 1.0.0 | 2026-03-27 | Documento inicial — SADT + OPME + Internação + organização de repositório |
