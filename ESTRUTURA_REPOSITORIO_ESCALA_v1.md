# ESTRUTURA_REPOSITORIO_ESCALA_v1
**Sistema:** NEUROAUTH | **Data:** 2026-03-27
**Escopo:** Árvore completa do repositório para suportar escala real

---

## 1. ESTRUTURA-ALVO

```
neuroauth/                               ← raiz do repositório (GitHub Pages)
│
├── ─────────────────────────────────── ─
│   CAMADA RAIZ — arquivos PWA e SPA
│   (NUNCA MOVER — GitHub Pages serve daqui)
├── ─────────────────────────────────── ─
│
├── index.html                           ← SPA principal ⛔ imóvel
├── sw.js                                ← Service Worker PWA ⛔ imóvel
├── manifest.json                        ← Manifesto PWA ⛔ imóvel
├── icon-192.png / icon-512.png          ← Ícones PWA ⛔ imóvel
│
├── neuroauth_compliance_engine.js       ← Motor de compliance ⛔ imóvel
├── neuroauth_billing_bridge.js          ← Bridge billing ⛔ imóvel
├── neuroauth_access_policy.js           ← Política de acesso ⛔ imóvel
├── neuroauth_billing_bridge_client.js   ← Facade billing ⛔ imóvel
├── neuroauth_monthly_billing_aggregator.js ⛔ imóvel
├── neuroauth_autofill_engine.js         ⛔ imóvel
├── neuroauth_app_controller.js          ⛔ imóvel
├── neuroauth_analytics.js               ⛔ imóvel
├── neuroauth_notification_service.js    ⛔ imóvel
├── neuroauth_case_reuse_engine.js       ⛔ imóvel
├── neuroauth_smart_reuse_engine.js      ⛔ imóvel
├── neuroauth_roi_engine.js              ⛔ imóvel
│
├── fill_engine.py                       ← Motor PDF base ⛔ imóvel
├── fill_unimed_sadt_v2.py               ← Motor SADT Unimed ⛔ imóvel
├── fill_unimed_opme_v2.py               ← Motor OPME Unimed ⛔ imóvel
├── fill_unimed_internacao_v1.py         ← Motor Internação Unimed ⛔ imóvel
├── validacao_neuroauth.py               ⛔ imóvel
├── case_summary.py                      ⛔ imóvel
├── neuroauth_utils.py                   ⛔ imóvel
│
├── ─────────────────────────────────── ─
│   CAMADA API — backend FastAPI
├── ─────────────────────────────────── ─
│
├── api/                                 ← FastAPI backend ⛔ imóvel
│   ├── app.py                           ← Endpoints REST
│   ├── requirements.txt
│   ├── Dockerfile
│   └── render.yaml
│
├── TEMPLATES_OFICIAIS/                  ← PDFs em branco ⛔ imóvel
│   ├── blank_sadt_template.pdf
│   ├── blank_opme_template.pdf
│   └── blank_internacao_template.pdf
│
├── ─────────────────────────────────── ─
│   CAMADA SCHEMAS — fonte única de verdade
├── ─────────────────────────────────── ─
│
├── schemas/
│   ├── core/                            ← Entidades fundamentais (independentes)
│   │   ├── PACIENTE_SCHEMA_MESTRE_v1.json       ⏳ pendente
│   │   ├── PROCEDIMENTO_SCHEMA_MESTRE_v1.json   ⏳ pendente
│   │   ├── OPME_SCHEMA_MESTRE_v1.json           ⏳ pendente
│   │   ├── AUTORIZACAO_SCHEMA_MESTRE_v1.json    ⏳ pendente
│   │   ├── BILLING_SCHEMA_MESTRE_v1.json        ⏳ pendente
│   │   └── AUDITORIA_SCHEMA_MESTRE_v1.json      ⏳ pendente
│   │
│   ├── convenios/                       ← Um arquivo por operadora
│   │   ├── CONVENIO_SCHEMA_MESTRE_v1.json       ✅ criado
│   │   ├── unimed_ce.json                       ✅ criado
│   │   ├── bradesco_saude.json                  ⏳ pendente
│   │   ├── sulamerica.json                      ⏳ pendente
│   │   ├── amil.json                            ⏳ pendente
│   │   └── hapvida.json                         ⏳ pendente
│   │
│   ├── hospitais/                       ← Um arquivo por hospital
│   │   ├── HOSPITAL_SCHEMA_MESTRE_v1.json       ✅ criado
│   │   ├── hosp_santo_antonio_barbalha.json      ⏳ pendente
│   │   └── hosp_coracao_cariri.json              ⏳ pendente
│   │
│   ├── medicos/                         ← Um arquivo por médico (alpha)
│   │   ├── MEDICO_SCHEMA_MESTRE_v1.json         ✅ criado
│   │   └── [futuro: perfis individuais em JSON]
│   │
│   ├── guias/                           ← Schema raiz + especializações
│   │   ├── GUIA_SCHEMA_MESTRE_v1.json           ✅ criado
│   │   ├── sadt_v1.json                         ⏳ pendente
│   │   ├── opme_v1.json                         ⏳ pendente
│   │   └── internacao/
│   │       ├── INTERNACAO_SCHEMA_MESTRE_v1.json ✅ existente
│   │       ├── INTERNACAO_SCHEMA_ACHATADO_v1.json ✅ existente
│   │       └── INTERNACAO_PAYLOAD_SCHEMA_v1.json  ✅ existente
│   │
│   ├── compliance/                      ← Regras parametrizadas
│   │   ├── REGRAS_COMPLIANCE_SCHEMA_v1.json     ✅ criado
│   │   ├── regras_tiss_geral.json               ⏳ pendente
│   │   ├── regras_unimed_ce.json                ⏳ pendente
│   │   ├── regras_bradesco_saude.json           ⏳ pendente
│   │   └── regras_neurocirurgia.json            ⏳ pendente
│   │
│   └── test/                            ← Payloads de teste (não são produção)
│       ├── TEST_PAYLOAD_NEUROAUTH_CRANIOTOMIA_v1.json ✅ existente
│       └── [outros test payloads]
│
├── ─────────────────────────────────── ─
│   CAMADA DOCS — documentação técnica
├── ─────────────────────────────────── ─
│
├── docs/
│   ├── arquitetura/                     ← Documentos arquiteturais
│   │   ├── ARQUITETURA_NEUROAUTH_v1.md         ✅ existente
│   │   ├── ARQUITETURA_ESCALA_NEUROAUTH_v1.md  ✅ criado
│   │   ├── CONVENIO_MAPEAMENTO_v1.md           ✅ criado
│   │   ├── HOSPITAL_OPERACAO_v1.md             ✅ criado
│   │   ├── MEDICO_PERFIL_OPERACIONAL_v1.md     ✅ criado
│   │   ├── GUIA_TIPOS_SUPORTADOS_v1.md         ✅ criado
│   │   ├── ENGINE_REGRAS_COMPLIANCE_v1.md      ✅ criado
│   │   ├── NORMALIZACAO_MASTER_NEUROAUTH_v1.md ✅ criado
│   │   ├── ESTRUTURA_REPOSITORIO_ESCALA_v1.md  ✅ este arquivo
│   │   ├── WORKFLOW_OPERACIONAL_NEUROAUTH_v1.md ✅ criado (bloco 9)
│   │   └── ROADMAP_ESCALA_NEUROAUTH_v1.md      ✅ criado (bloco 10)
│   │
│   ├── internacao/                      ← Específico Internação
│   │   ├── INTERNACAO_MAPEAMENTO_OFICIAL_v1.md ✅ existente
│   │   ├── INTERNACAO_NORMALIZACAO_v1.md       ✅ existente
│   │   └── INTERNACAO_INTEGRACAO_v1.md         ✅ existente
│   │
│   ├── billing/                         ← Billing e financeiro
│   │   ├── NEUROAUTH_BILLING_MENSAL.json       ✅ existente
│   │   └── NEUROAUTH_BILLING_MENSAL_v2.json    ✅ existente
│   │
│   └── seguranca/                       ← Auditoria de segurança
│       ├── SECURITY_AUDIT_STAGE3_NEUROAUTH.md  ✅ existente
│       └── HARDENING_DELTA_LOG.md              ✅ existente
│
├── ─────────────────────────────────── ─
│   CAMADA INTEGRATION — conectores externos
├── ─────────────────────────────────── ─
│
├── integration/
│   ├── make/
│   │   ├── make_blueprint.json                  ✅ existente
│   │   └── NEUROAUTH_Checklist_Make_Validacao.html ✅ existente
│   └── sheets/
│       ├── NEUROAUTH_Bootstrap.gs               ✅ existente
│       ├── NEUROAUTH_Setup.gs                   ✅ existente
│       └── NEUROAUTH_ImportarSheets.gs          ✅ existente
│
├── ─────────────────────────────────── ─
│   CAMADA ARCHIVE — versões antigas e artefatos
├── ─────────────────────────────────── ─
│
├── archive/                             ← Versões descontinuadas (NUNCA deletar)
│   ├── fill_unimed_sadt_v1.py           ← versão anterior do motor
│   ├── fill_unimed_opme_v1.py
│   └── formularios_antigos/            ← HTMLs de versões anteriores
│
└── ─────────────────────────────────── ─
    SANDBOX — experimentos isolados
─────────────────────────────────── ─

    sandbox/                             ← Experimentos que não entram em prod
        ├── render_engine_v2/            ← Reescrita futura do motor de render
        └── multi_tenant_poc/            ← Prova de conceito multi-tenant
```

---

## 2. O QUE PODE SER MOVIDO JÁ

| Arquivo atual (raiz) | Destino | Risco | Bloqueio |
|---|---|---|---|
| `INTERNACAO_SCHEMA_MESTRE_v1.json` | `schemas/guias/internacao/` | Nenhum — já foi copiado | Nenhum |
| `INTERNACAO_SCHEMA_ACHATADO_v1.json` | `schemas/guias/internacao/` | Nenhum — já foi copiado | Nenhum |
| `INTERNACAO_MAPEAMENTO_OFICIAL_v1.md` | `docs/internacao/` | Nenhum — já foi copiado | Nenhum |
| `make_blueprint.json` | `integration/make/` | Nenhum — já foi copiado | Nenhum |
| Arquivos `NEUROAUTH_*.gs` | `integration/sheets/` | Nenhum — já copiado | Nenhum |

**Todos esses já foram copiados na sessão anterior. Os originais continuam na raiz como redundância segura.**

---

## 3. O QUE DEVE ESPERAR

| Arquivo/Lógica | Por que esperar | Quando mover |
|---|---|---|
| `neuroauth_compliance_engine.js` | Importado diretamente pelo `index.html` | Após criar loader dinâmico de regras externas |
| `fill_unimed_*.py` | Importados por `api/app.py` com path relativo | Após criar estrutura de módulos em `api/` |
| `index.html` | É a raiz do GitHub Pages | Nunca mover |
| `SURGICAL_PROFILES{}` (inline no HTML) | Bloco grande no index.html | Após criar endpoint `GET /procedimentos` |
| `CONVENIO_RULES{}` (inline no engine) | Compilado no JS | Após criar loader de `schemas/compliance/` |

---

## 4. O QUE PRECISA DE COMPATIBILIDADE TEMPORÁRIA

### 4.1 Duplicação intencional (segura)
Os arquivos copiados para `schemas/` e `docs/` coexistem com os originais na raiz.
Durante a transição, os dois caminhos são válidos.
Quando o sistema usar apenas o novo caminho, os originais da raiz podem ser removidos.

### 4.2 Imports relativos dos motores Python
```python
# api/app.py usa hoje:
from fill_unimed_sadt_v2 import fill_sadt

# Para mover para schemas/, criar wrapper:
# api/adapters/fill_adapter.py
import importlib
def get_motor(convenio, tipo_guia):
    nome = f"fill_{convenio}_{tipo_guia}_v1"
    return importlib.import_module(nome)
```

### 4.3 CONVENIO_RULES no compliance engine
```javascript
// Migração em 2 fases:
// Fase A: compliance engine aceita regras externas como parâmetro
NEUROAUTH_COMPLIANCE.configure({ extra_rules: window.REGRAS_EXTERNAS });

// Fase B: compliance engine carrega regras de schemas/compliance/ via fetch
const regras = await fetch('/schemas/compliance/regras_unimed_ce.json').then(r => r.json());
```

---

## 5. MIGRAÇÃO POR FASES — ROTEIRO SEGURO

### Fase 1 (agora — alpha)
- Raiz com arquivos funcionais inalterados
- `schemas/`, `docs/`, `integration/` como camada de documentação e referência
- Nenhuma migração de código

### Fase 2 (pós-alpha — escala inicial)
- Criar `schemas/convenios/bradesco_saude.json`
- Criar `fill_bradesco_sadt_v1.py`
- Criar loader dinâmico de CONVENIO_RULES a partir de JSON
- Criar endpoint `GET /convenios` e `GET /hospitais` na API

### Fase 3 (escala multi-convênio)
- Motor de compliance lê regras de `schemas/compliance/*.json`
- `api/app.py` usa lookup dinâmico de motor por convênio × tipo_guia
- `index.html` carrega lista de convênios/hospitais da API

### Fase 4 (plataforma)
- Multi-tenant: cada clínica tem seu subconjunto de convênios/hospitais
- `schemas/medicos/` com perfis individuais
- Dashboard por médico e por clínica
