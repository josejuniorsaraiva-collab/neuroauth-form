# ROADMAP_ESCALA_NEUROAUTH_v1
**Sistema:** NEUROAUTH | **Data:** 2026-03-27
**Escopo:** Plano executável de 4 fases — do alpha funcional à plataforma de escala real

---

## VISÃO GERAL

```
FASE 1          FASE 2          FASE 3          FASE 4
Hardening    →  Arquitetura  →  Escala       →  Plataforma
(atual)         de Domínio      Operacional     Multi-tenant

4-6 semanas     6-10 semanas    3-4 meses       6+ meses
```

---

## FASE 1 — HARDENING E ESTABILIZAÇÃO
**Objetivo:** Tornar o que já funciona seguro, auditável e sustentável.
**Horizonte:** 4-6 semanas | **Status:** Em andamento

### Entregáveis

| # | Entregável | Status | Critério de conclusão |
|---|---|---|---|
| 1.1 | PHI removido de localStorage | ✅ Feito | sessionStorage + SAFE_DRAFT_FIELDS |
| 1.2 | Bypass de auth removido | ✅ Feito | Zero DEV_BYPASS em todos os arquivos |
| 1.3 | Logs sanitizados (sem PHI) | ✅ Feito | maskEmail + NA_LOG_BLOCKLIST |
| 1.4 | `naHandleLogin` envia idToken bruto | ✅ Feito | Token não decodificado no cliente |
| 1.5 | `__NA_STATE__` sem payload clínico | ✅ Feito | Apenas proc_id, convenio, flags |
| 1.6 | Dados de teste sem CPF real | ✅ Feito | QC com `000.000.000-00` |
| 1.7 | Freeze de funções críticas | ✅ Feito | `Object.defineProperty` no DOMContentLoaded |
| 1.8 | Webhook Make.com reativado | ⏳ Bloqueante | Make.com responde HTTP 200 |
| 1.9 | Auth real via Make.com | ⏳ Bloqueante | id_token validado server-side |
| 1.10 | FastAPI deployado (Render.com) | ⏳ Pendente | `render.yaml` executado, API acessível |
| 1.11 | `/gerar_tudo` inclui Internação | ⏳ Pendente | Endpoint retorna 3 PDFs |
| 1.12 | Whitelist alpha populada | ⏳ Pendente | ≥ 3 médicos alpha com acesso real |

### Dependências
- 1.8 e 1.9 dependem de acesso ao painel Make.com
- 1.10 depende de conta no Render.com

### Risco principal
- Make.com webhook com HTTP 410 bloqueia toda autenticação real
- **Mitigação:** Recriar cenário Make.com com nova URL de webhook

### O que não pode quebrar
- `index.html` deve continuar funcionando (fallback offline para impressão)
- Motores PDF devem continuar gerando documentos corretos
- `api/app.py` deve continuar servindo PDFs quando chamado

---

## FASE 2 — ARQUITETURA DE DOMÍNIO
**Objetivo:** Transformar entidades implícitas em schemas formais e o sistema em multi-convênio real.
**Horizonte:** 6-10 semanas após Fase 1 | **Status:** Schemas criados, implementação pendente

### Entregáveis

| # | Entregável | Critério de conclusão |
|---|---|---|
| 2.1 | `schemas/convenios/unimed_ce.json` ativo | API usa JSON, não hardcoded |
| 2.2 | `schemas/hospitais/hosp_*.json` criados | 3+ hospitais mapeados |
| 2.3 | Perfil médico carregado do JSON | `naEnterForm()` usa dados do schema |
| 2.4 | Select de convênio filtrado por hospital | Apenas convênios credenciados aparecem |
| 2.5 | Select de hospital carregado da API | `GET /hospitais` retorna lista dinâmica |
| 2.6 | CNES preenchido automaticamente | Ao selecionar hospital, CNES auto-preenche |
| 2.7 | Loader dinâmico de regras compliance | Engine carrega JSON de `schemas/compliance/` |
| 2.8 | `schemas/compliance/regras_tiss_geral.json` | Regras TISS separadas do engine |
| 2.9 | `schemas/compliance/regras_unimed_ce.json` | Regras Unimed separadas do engine |
| 2.10 | Máquina de estados explícita | Estado da guia persistido no Sheets |
| 2.11 | Notificação pós-envio (WhatsApp/email) | Médico recebe link do PDF em <5 min |
| 2.12 | BillingBridge com adapter real | GoogleSheets ou Asaas em produção |
| 2.13 | `SURGICAL_PROFILES{}` externalizado | Removido do HTML, servido por API |

### Dependências
- Fase 1 completa (especialmente 1.8, 1.9, 1.10)
- Google Sheets com estrutura correta de colunas (MEDICO_SCHEMA)

### Risco principal
- Refatorar `index.html` sem quebrar comportamento existente
- **Mitigação:** Feature flags — novo comportamento ativado por `perfil.fase === '2'`

### O que não pode quebrar
- Fluxo SADT + OPME + Internação para Unimed Ceará
- Login e perfil do médico
- Geração de PDF e entrega no Drive

---

## FASE 3 — ESCALA OPERACIONAL
**Objetivo:** NEUROAUTH suporta múltiplos convênios, múltiplos hospitais, múltiplos perfis em produção real.
**Horizonte:** 3-4 meses após Fase 2

### Entregáveis

| # | Entregável | Critério de conclusão |
|---|---|---|
| 3.1 | Bradesco Saúde operacional | Motor SADT + template + regras funcionando |
| 3.2 | SulAmérica operacional | Motor SADT + template + regras funcionando |
| 3.3 | Motor genérico de lookup | `api/app.py` usa `convenio.json::motor_sadt` dinamicamente |
| 3.4 | Perfis de múltiplos médicos | ≥ 5 médicos com perfil completo e operacional |
| 3.5 | Múltiplos hospitais ativos | ≥ 3 hospitais com CNES, convênios e fluxo mapeados |
| 3.6 | Regras anti-glosa por especialidade | `schemas/compliance/regras_neurocirurgia.json` ativo |
| 3.7 | Regras por hospital × convênio | Combinações específicas funcionando |
| 3.8 | Tratamento de glosa | Estado `negado` com fluxo de recurso |
| 3.9 | Reenvio de guia | Estado `pendente_reenvio` com versionamento |
| 3.10 | Assinatura digital (ICP-Brasil) | Pelo menos 1 médico com certificado digital |
| 3.11 | Dashboard do médico | Histórico de guias, status, billing mensal |
| 3.12 | Billing por uso com Asaas | Cobrança automática por guia gerada |
| 3.13 | Tempo de resposta < 3s | API e Make.com respondem em ≤ 3s (p95) |

### Dependências
- Fases 1 e 2 completas
- Formulários PDF dos novos convênios (Bradesco, SulAmérica)
- Certificado ICP-Brasil (para assinatura digital)

### Risco principal
- Diferentes formatos de PDF por convênio (layouts muito diferentes)
- **Mitigação:** Motor genérico `fill_engine.py` já abstrai coordenadas

### O que não pode quebrar
- Todos os fluxos da Fase 2
- Performance da geração de PDFs

---

## FASE 4 — PLATAFORMA MULTI-TENANT
**Objetivo:** NEUROAUTH opera como produto SaaS com clínicas independentes, billing robusto e auditoria forte.
**Horizonte:** 6+ meses após Fase 3

### Entregáveis

| # | Entregável | Critério de conclusão |
|---|---|---|
| 4.1 | Multi-tenant real | Cada clínica tem namespace isolado |
| 4.2 | Onboarding self-service | Médico cadastra clínica, hospital, convênios sem admin |
| 4.3 | Planos de assinatura | free / starter / pro / enterprise com limites reais |
| 4.4 | Dashboard de clínica | Visão consolidada por secretaria / diretor médico |
| 4.5 | Analytics de glosa | Taxa de glosa por convênio, procedimento, médico |
| 4.6 | Integração TISS direta | Envio por XML TISS 3.x para convênios que aceitam |
| 4.7 | App mobile | Aprovação de envio de guia pelo celular do médico |
| 4.8 | API pública | Integração com sistemas de gestão hospitalar (HIS/RIS) |
| 4.9 | Auditoria imutável | Log de toda ação em ledger append-only |
| 4.10 | SLA 99.9% | Infraestrutura com redundância e failover |
| 4.11 | LGPD compliance certificado | DPO nomeado, RIPD elaborado, controles formalizados |
| 4.12 | Programa de parceiros | Secretarias médicas como revendedoras |

### Dependências
- Fase 3 completa e estável
- Infraestrutura dedicada (não GitHub Pages)
- Time de suporte para onboarding

---

## MAPA DE DEPENDÊNCIAS ENTRE FASES

```
FASE 1:   [1.8 webhook] → [1.9 auth] → [1.10 deploy API]
               │                              │
FASE 2:        └──────────────────────────────┤
                                              │
               [2.1 convenio JSON] → [2.7 loader regras]
               [2.4 select filtrado] → [2.5 API hospitais]
                        │
FASE 3:                 └──────────────────────────────────────┐
                                                               │
               [3.1 bradesco] → [3.3 motor genérico] → [3.4 médicos]
               [3.8 tratamento glosa] → [3.11 dashboard]
                        │
FASE 4:                 └──────────────────────────────────────┐
                                                               │
               [4.1 multi-tenant] → [4.2 self-service] → [4.5 analytics]
```

---

## CRITÉRIOS DE CONCLUSÃO POR FASE

| Fase | Critério objetivo |
|---|---|
| Fase 1 | Make.com ativo + API deployada + 3 médicos alpha operando sem intervensão manual |
| Fase 2 | 1 segundo convênio (Bradesco) operacional + loader dinâmico de regras funcionando |
| Fase 3 | 3+ convênios + 5+ médicos + dashboard + billing real funcionando há 30 dias sem bugs críticos |
| Fase 4 | 3+ clínicas independentes + onboarding self-service + SLA 99.9% por 90 dias |

---

## O QUE O NEUROAUTH PARECE AO FINAL

```
HOJE (Fase 1):
"Um formulário inteligente para neurocirurgia na Unimed Ceará"

AO FINAL DA FASE 3:
"Uma plataforma de autorizações médicas para neurocirurgiões no Ceará,
operando com Unimed, Bradesco e SulAmérica, em 5+ hospitais,
com 10+ médicos, compliance TISS automático e billing por uso."

AO FINAL DA FASE 4:
"Uma plataforma SaaS nacional de autorizações médicas para
especialidades cirúrgicas, com multi-tenant, TISS direto,
analytics de glosa e integração com sistemas hospitalares."
```

---

## MÉTRICAS DE SUCESSO

| Métrica | Fase 1 | Fase 2 | Fase 3 | Fase 4 |
|---|---|---|---|---|
| Convênios ativos | 1 | 2 | 3-5 | 10+ |
| Hospitais ativos | 1 | 3 | 5+ | 20+ |
| Médicos ativos | 1-3 | 5-10 | 20-50 | 200+ |
| Guias/mês | < 50 | 50-200 | 200-1000 | 5000+ |
| Taxa de glosa | baseline | -20% | -40% | -60% |
| Tempo de preenchimento | baseline | -30% | -50% | -70% |
| Uptime | 95% | 99% | 99.5% | 99.9% |
