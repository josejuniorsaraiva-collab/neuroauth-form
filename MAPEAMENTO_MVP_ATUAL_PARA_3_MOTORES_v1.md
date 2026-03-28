# MAPEAMENTO_MVP_ATUAL_PARA_3_MOTORES_v1.md

**Versão:** 1.0.0
**Data:** 2026-03-27
**Projeto:** NEUROAUTH — Arquitetura de 3 Motores
**Referências obrigatórias:**
- `EPISODIO_CIRURGICO_SCHEMA_v1.json` — fonte única de verdade do episódio cirúrgico
- `STATUS_AUTORIZACAO_WORKFLOW_v1.json` — máquina de estados executável (15 estados)

---

## OBJETIVO

Demonstrar como cada ativo já construído no MVP atual entra na arquitetura de 3 motores **sem recomeçar do zero**. Este documento é o contrato de migração entre o MVP e a produção.

Nenhum ativo é descartado sem justificativa. Cada item recebe: destino definitivo, grau de reaproveitamento, adaptação necessária, dependências e risco de migração.

---

## LEGENDA

| Campo | Descrição |
|---|---|
| **Ativo Atual** | Nome/identificador do componente no MVP |
| **Função no MVP** | O que faz hoje |
| **Destino na Arquitetura** | Motor 1 / Motor 2 / Motor 3 / Compartilhado / Infraestrutura |
| **Grau de Reaproveitamento** | 🟢 Alto (>70%) / 🟡 Médio (30–70%) / 🔴 Baixo (<30%) |
| **Adaptação Necessária** | O que precisa mudar |
| **Dependências** | Outros ativos ou schemas que este precisa |
| **Risco de Migração** | 🔴 Alto / 🟡 Médio / 🟢 Baixo |
| **Observação Operacional** | Notas críticas de operação |

---

## 1. INTERFACE / FRONTEND

### 1.1 `index.html` — Formulário de Autorização

| Campo | Valor |
|---|---|
| **Ativo Atual** | `~/neuroauth-form/index.html` (GitHub: `neuroclinica-ai/neuroauth-form`) |
| **Função no MVP** | Formulário único de captura de dados do episódio cirúrgico. Entrada manual de: paciente, médico, procedimento, convênio, OPME. Envia payload via webhook para Make.com. Variável `NA_FASTAPI_URL` aponta para backend FastAPI no Render. |
| **Destino na Arquitetura** | **Motor 1** (entrada de dados → disparo do fluxo de autorização) |
| **Grau de Reaproveitamento** | 🟡 Médio (50%) |
| **Adaptação Necessária** | (1) Refatorar payload de saída para conformidade total com `EPISODIO_CIRURGICO_SCHEMA_v1.json` — todos os 21 blocos mapeados. (2) Gerar `id_episodio` (UUID v4) no frontend ou delegar ao FastAPI. (3) Incluir `request_id` para idempotência. (4) Adicionar campo `tipo_atendimento` enum (eletivo/urgência/emergência). (5) Separar campos `equipe_cirurgica` como array com roles. (6) Submit deve receber `estado_atual: "preenchimento"` como estado inicial confirmado. |
| **Dependências** | `EPISODIO_CIRURGICO_SCHEMA_v1.json` (validação de payload), FastAPI backend (Render), Motor 1 endpoint `/episodios` |
| **Risco de Migração** | 🟡 Médio — campos existentes são subconjunto do schema; extensão não quebra lógica atual |
| **Observação Operacional** | `NA_FASTAPI_URL = 'https://neuroauth-api.onrender.com'` já configurado e commitado. Render usa Python 3.11.0 + `PYTHON_VERSION` env var. Formulário atual não valida client-side contra JSON Schema — adicionar validação Ajv no frontend é pré-requisito para produção. |

---

## 2. BACKEND / API

### 2.1 FastAPI Backend (`app.py`) — Render.com

| Campo | Valor |
|---|---|
| **Ativo Atual** | `app.py` + `requirements.txt` no repo `neuroauth-form`, deploy em `https://neuroauth-api.onrender.com` |
| **Função no MVP** | Recebe payload do formulário, executa validações básicas via Pydantic, roteia para webhook Make.com, retorna resposta. Endpoint principal: `POST /submit`. |
| **Destino na Arquitetura** | **Motor 1** (núcleo de recepção e orquestração de estado) + **Infraestrutura** (gateway API compartilhado) |
| **Grau de Reaproveitamento** | 🟡 Médio (60%) |
| **Adaptação Necessária** | (1) Criar modelo Pydantic v2 espelhando `EPISODIO_CIRURGICO_SCHEMA_v1.json` — 21 blocos com validadores. (2) Implementar endpoint `POST /episodios` (cria episódio, estado inicial `preenchimento`). (3) Implementar endpoint `PATCH /episodios/{id}/transicao` (executa transição de estado conforme workflow). (4) Implementar endpoint `GET /episodios/{id}` (leitura do episódio completo). (5) Adicionar middleware de idempotência por `request_id`. (6) Adicionar persistência — atualmente stateless; migrar para banco (Supabase/PostgreSQL recomendado). (7) Separar rotas por motor: `/motor1/*`, `/motor2/*`, `/motor3/*`. |
| **Dependências** | `STATUS_AUTORIZACAO_WORKFLOW_v1.json` (regras de transição), `EPISODIO_CIRURGICO_SCHEMA_v1.json` (modelo Pydantic), banco de dados persistente |
| **Risco de Migração** | 🔴 Alto — backend atual é stateless e sem persistência; reestruturação de rotas é necessária |
| **Observação Operacional** | Render free tier tem spin-down após 15min de inatividade (cold start ~30s). Para produção: upgrade para Render Starter ($7/mês) ou migrar para Railway/Fly.io. `pydantic==2.7.1` requer Python ≤3.12 — manter `PYTHON_VERSION=3.11.0`. |

---

## 3. MOTOR 1 — AUTORIZAÇÃO E COMPLIANCE

### 3.1 Compliance Engine (Regras de Validação)

| Campo | Valor |
|---|---|
| **Ativo Atual** | Regras de compliance embutidas no FastAPI / lógica de validação nos webhooks Make.com |
| **Função no MVP** | Verifica completude dos campos obrigatórios, valida CID-10 básico, verifica se convênio aceita procedimento TUSS. Lógica distribuída entre `app.py` e cenários Make.com. |
| **Destino na Arquitetura** | **Motor 1** — módulo `compliance_engine.py` dedicado |
| **Grau de Reaproveitamento** | 🟡 Médio (40%) |
| **Adaptação Necessária** | (1) Consolidar toda lógica de compliance em módulo Python isolado. (2) Implementar as 11 categorias de pendências (`tipo` enum do schema): documentacao_incompleta, informacao_clinica_insuficiente, cid_incompativel, procedimento_nao_coberto, opme_nao_autorizada, prazo_expirado, dados_beneficiario_invalidos, conflito_cobertura, necessita_segunda_opiniao, aguardando_autorizacao_manual, erro_tecnico_envio. (3) Retornar `pendencias[]` estruturado conforme schema. (4) Motor 1 deve disparar transição automática `preenchimento → validacao → em_analise` ou `→ pendente_complemento`. |
| **Dependências** | `EPISODIO_CIRURGICO_SCHEMA_v1.json` (campos e enums), tabelas TUSS/CID-10 (base de dados de referência), `STATUS_AUTORIZACAO_WORKFLOW_v1.json` (trigger de transições) |
| **Risco de Migração** | 🟡 Médio — lógica existe mas está fragmentada; consolidação é trabalho de refatoração |
| **Observação Operacional** | Motor 1 é o **primeiro motor a ir ao ar**. Priorizar implementação. O estado `validacao` é exclusivo de máquina (timeout 60s, sem entrada humana). |

### 3.2 Schemas de Internação

| Campo | Valor |
|---|---|
| **Ativo Atual** | Templates de guia de internação (campos TISS), possivelmente em Google Sheets ou JSON informal |
| **Função no MVP** | Define campos obrigatórios da guia de internação conforme padrão TISS do convênio |
| **Destino na Arquitetura** | **Motor 1** (validação de completude) + **Motor 2** (geração do documento PDF da guia) |
| **Grau de Reaproveitamento** | 🟢 Alto (75%) |
| **Adaptação Necessária** | (1) Formalizar como sub-schema dentro de `EPISODIO_CIRURGICO_SCHEMA_v1.json` — bloco `procedimento_principal` + bloco `convenio.regras_especificas`. (2) Adicionar validação de campos obrigatórios por tipo de atendimento (eletivo vs urgência). (3) Mapear campos TISS para campos do schema (de/para explícito). |
| **Dependências** | `EPISODIO_CIRURGICO_SCHEMA_v1.json` (blocos `procedimento_principal`, `convenio`), tabela de regras por convênio |
| **Risco de Migração** | 🟢 Baixo — estrutura é subconjunto do schema já definido |
| **Observação Operacional** | Campos TISS obrigatórios para internação: número da carteira, validade, CID principal, CID secundário, caráter do atendimento, data prevista de internação, tipo de internação, tipo de acomodação. Todos mapeados no schema. |

### 3.3 Status de Autorização

| Campo | Valor |
|---|---|
| **Ativo Atual** | Status simples (aprovado/negado/pendente) em Google Sheets ou campo de formulário |
| **Função no MVP** | Registra decisão do convênio. Atualização manual pela equipe administrativa. |
| **Destino na Arquitetura** | **Motor 1** — gerenciado integralmente por `STATUS_AUTORIZACAO_WORKFLOW_v1.json` |
| **Grau de Reaproveitamento** | 🔴 Baixo (20%) — conceito reaproveitado, implementação refeita |
| **Adaptação Necessária** | (1) Substituir status simples pela máquina de 15 estados. (2) Toda mutação de estado via `PATCH /episodios/{id}/transicao`. (3) Historico_estados append-only — nunca sobrescrever. (4) Validar transições conforme `transicoes_permitidas` e `transicoes_bloqueadas` do workflow. (5) Retornar 422 em transição inválida. |
| **Dependências** | `STATUS_AUTORIZACAO_WORKFLOW_v1.json` (máquina de estados), FastAPI backend (endpoint de transição), banco de dados persistente |
| **Risco de Migração** | 🟡 Médio — dados históricos de status simples precisam ser migrados para formato de historico_estados |
| **Observação Operacional** | Estado `arquivado` é terminal e imutável permanentemente (`hard_block_permanente: true`). Estado `negado` dispara alerta imediato. A migração de episódios ativos deve mapear status antigo para estado equivalente na máquina nova. |

---

## 4. MOTOR 2 — DOCUMENTOS E PDF

### 4.1 Motor PDF (Geração de Documentos)

| Campo | Valor |
|---|---|
| **Ativo Atual** | Geração de PDF via Make.com (template + dados do formulário) ou script Python separado |
| **Função no MVP** | Gera SADT, guia de internação, guia OPME em PDF. Envia por email ou armazena em Google Drive. |
| **Destino na Arquitetura** | **Motor 2** — módulo dedicado de geração documental |
| **Grau de Reaproveitamento** | 🟡 Médio (55%) |
| **Adaptação Necessária** | (1) Migrar geração para endpoint FastAPI `/motor2/documentos/gerar`. (2) Dados de entrada: `id_episodio` + `tipo_documento` enum (sadt, guia_internacao, guia_opme, relatorio_clinico, recurso_glosa, nota_fiscal). (3) Resultado gravado no bloco `documentos_gerados[]` do episódio: hash_md5, versao, url_storage, referencia_estado. (4) Versionar documentos — nunca sobrescrever (campo `versao: integer` incrementa). (5) Motor 2 acionado nos estados: `pronto_para_envio`, `enviado`, `autorizado`, `recurso_em_preparo`, `faturado`. |
| **Dependências** | `EPISODIO_CIRURGICO_SCHEMA_v1.json` (bloco `documentos_gerados`), storage (S3/GCS/Supabase Storage), templates de documento por convênio |
| **Risco de Migração** | 🟡 Médio — template de PDF reutilizável, mas integração com storage e versionamento são novos |
| **Observação Operacional** | Motor 2 é acionado **após** Motor 1 validar e aprovar envio. Nunca gera documento de episódio em estado `preenchimento` ou `validacao`. Manter Make.com como fallback durante migração gradual. |

---

## 5. AUTOMAÇÃO / ORQUESTRAÇÃO

### 5.1 Make.com (Cenários de Automação)

| Campo | Valor |
|---|---|
| **Ativo Atual** | Cenários Make.com: recepção de webhook do formulário, roteamento, notificações, geração de PDF, atualização de planilha |
| **Função no MVP** | Orquestrador central de automação. Conecta formulário → validação → notificação → planilha → PDF → comunicação. |
| **Destino na Arquitetura** | **Compartilhado** (fase de transição) → gradualmente substituído por Motor 1/2/3 nativos |
| **Grau de Reaproveitamento** | 🟡 Médio (45%) |
| **Adaptação Necessária** | (1) Manter cenários existentes durante fase de migração. (2) Redirecionar webhook de entrada para FastAPI (`NA_FASTAPI_URL`) em vez de processar diretamente. (3) Make.com passa a ser acionado pelo FastAPI via HTTP module, não como ponto de entrada. (4) Cenários de notificação (WhatsApp, email, SMS) migrar para Motor 1/Motor 2 `comunicacoes_disparadas`. (5) Deprecar cenários de geração de PDF ao ativar Motor 2. (6) Manter cenário de atualização de Google Sheets durante transição como backup de auditoria. |
| **Dependências** | FastAPI backend (nova fonte de verdade), `STATUS_AUTORIZACAO_WORKFLOW_v1.json` (triggers de comunicação por estado) |
| **Risco de Migração** | 🟡 Médio — Make.com é confiável mas introduz dependência externa e custo por operação |
| **Observação Operacional** | Make.com free tier: 1.000 operações/mês. Plano básico: $9/mês (10.000 ops). Mapear número atual de operações por episódio antes de decidir manter ou substituir. Cenários críticos: webhook receiver, PDF trigger, WhatsApp sender. |

---

## 6. DADOS E PERSISTÊNCIA

### 6.1 Google Sheets (Planilha de Episódios)

| Campo | Valor |
|---|---|
| **Ativo Atual** | Planilha Google Sheets com colunas manuais: paciente, médico, convênio, procedimento, status, data |
| **Função no MVP** | Banco de dados informal. Registro manual de episódios. Consulta por equipe administrativa. Fonte de relatórios. |
| **Destino na Arquitetura** | **Motor 3** (leitura de relatórios) + substituído por banco de dados real como fonte primária |
| **Grau de Reaproveitamento** | 🔴 Baixo (25%) — mantido como view de relatórios, não como fonte de verdade |
| **Adaptação Necessária** | (1) Planilha deixa de ser source of truth — passa a ser destino de exportação/relatório. (2) Motor 3 escreve na planilha via Google Sheets API (evento de faturamento, relatórios de glosa). (3) Adicionar colunas alinhadas ao schema: `id_episodio`, `estado_atual`, `valor_autorizado`, `valor_glosado`, `status_faturamento`. (4) Manter como dashboard visual para equipe durante período de transição. |
| **Dependências** | Motor 3 (exportação de dados de billing), Google Sheets API, `EPISODIO_CIRURGICO_SCHEMA_v1.json` (campos `billing_context`, `glosa_context`) |
| **Risco de Migração** | 🟢 Baixo — planilha vira destino passivo, não muda logicamente |
| **Observação Operacional** | NÃO migrar dados históricos da planilha para o banco automaticamente sem limpeza e validação. Fazer import manual curado dos episódios ativos. Arquivados: manter na planilha como referência histórica. |

### 6.2 Billing/Logs (Registros de Faturamento)

| Campo | Valor |
|---|---|
| **Ativo Atual** | Registros de billing em Google Sheets (colunas: valor solicitado, autorizado, pago, glosa, competência) |
| **Função no MVP** | Controle financeiro por episódio. Lançamento manual pós-autorização. |
| **Destino na Arquitetura** | **Motor 3** — bloco `billing_context` do schema é a nova fonte de verdade |
| **Grau de Reaproveitamento** | 🟡 Médio (50%) — campos alinhados com `billing_context` do schema |
| **Adaptação Necessária** | (1) Mapear colunas da planilha para campos do schema: `competencia` (YYYY-MM), `valor_solicitado`, `valor_autorizado`, `valor_pago`, `valor_glosado`, `status_faturamento` enum. (2) Implementar endpoint Motor 3: `POST /motor3/billing/registrar`. (3) Integrar com estado `faturado` da máquina de estados — Motor 3 acionado ao entrar em `faturado`. (4) Logs de billing são imutáveis após lançamento — append-only, sem edição retroativa. |
| **Dependências** | `EPISODIO_CIRURGICO_SCHEMA_v1.json` (bloco `billing_context`), banco de dados persistente, `STATUS_AUTORIZACAO_WORKFLOW_v1.json` (estado `faturado` → Motor 3) |
| **Risco de Migração** | 🟡 Médio — dados históricos precisam de mapeamento de competência e validação de valores |
| **Observação Operacional** | Motor 3 só atua **após** estado `autorizado` ou `faturado`. Nunca registra billing de episódio em estados anteriores. TISS exige lançamento dentro da competência — campo `competencia` é obrigatório e auditável. |

### 6.3 Histórico/Glosa

| Campo | Valor |
|---|---|
| **Ativo Atual** | Registros de glosa em planilha (coluna: código glosa, valor, contestação, recuperação) |
| **Função no MVP** | Controle manual de glosas recebidas do convênio. Registro de recursos e valores recuperados. |
| **Destino na Arquitetura** | **Motor 3** — bloco `glosa_context` + `recurso_em_preparo`/`recurso_enviado` no Motor 1 |
| **Grau de Reaproveitamento** | 🟡 Médio (55%) |
| **Adaptação Necessária** | (1) Mapear `codigo_glosa_tiss`, `descricao`, `valor_glosado`, `status_recurso` para schema. (2) Fluxo de recurso: estados `recurso_em_preparo` → `recurso_enviado` → `pendente_retorno_recurso` → `autorizado`/`negado`. (3) Motor 1 gerencia o processo de recurso; Motor 3 registra valor recuperado no `glosa_context.valor_recuperado`. (4) Recurso gera documento via Motor 2 (tipo: `recurso_glosa`). |
| **Dependências** | `EPISODIO_CIRURGICO_SCHEMA_v1.json` (bloco `glosa_context`), Motor 1 (estados de recurso), Motor 2 (documento recurso_glosa), Motor 3 (registro financeiro) |
| **Risco de Migração** | 🟡 Médio — lógica de recurso envolve 3 motores; coordenação é o ponto crítico |
| **Observação Operacional** | Estados de recurso são os mais complexos do workflow — Motor 1 coordena, Motor 2 gera documento, Motor 3 registra resultado. `codigo_glosa_tiss` deve ser validado contra tabela TISS de glosas. |

---

## 7. COMUNICAÇÃO

### 7.1 Agenda / Agendamento

| Campo | Valor |
|---|---|
| **Ativo Atual** | Agenda em planilha ou Google Calendar com datas do episódio (cirurgia, internação, consulta pré-anestésica) |
| **Função no MVP** | Controle de datas previstas do episódio. Referência para urgência de autorização. |
| **Destino na Arquitetura** | **Motor 1** (metadados do episódio) — campo `procedimento_principal.data_prevista_procedimento` |
| **Grau de Reaproveitamento** | 🟢 Alto (80%) |
| **Adaptação Necessária** | (1) Formalizar data prevista como campo estruturado no schema (formato ISO 8601). (2) Motor 1 usa `data_prevista_procedimento` para calcular urgência de SLA — episódios com data < 5 dias sobem prioridade. (3) Alertas automáticos de vencimento de prazo via `mensagens_disparadas`. (4) Tipo de atendimento `urgencia`/`emergencia` override SLA para imediato. |
| **Dependências** | `EPISODIO_CIRURGICO_SCHEMA_v1.json` (campo `procedimento_principal.data_prevista_procedimento`), sistema de alertas (Motor 1 → `mensagens_disparadas`) |
| **Risco de Migração** | 🟢 Baixo — campo simples, lógica de SLA é nova mas não quebra dados existentes |
| **Observação Operacional** | SLA de resposta dos convênios: urgência = 4h, eletivo = 72h (Resolução Normativa ANS 259/2011). Motor 1 deve monitorar SLA e disparar alertas em `estados_de_alerta` do workflow. |

### 7.2 Comunicação com Paciente

| Campo | Valor |
|---|---|
| **Ativo Atual** | Mensagens manuais via WhatsApp pessoal ou template Make.com → WhatsApp Business API |
| **Função no MVP** | Informar paciente sobre status da autorização (aprovado, pendente, negado). Comunicação reativa e manual na maioria dos casos. |
| **Destino na Arquitetura** | **Motor 1** — bloco `mensagens_disparadas[]` acionado por estado |
| **Grau de Reaproveitamento** | 🟡 Médio (45%) |
| **Adaptação Necessária** | (1) Formalizar templates por estado: cada estado do workflow declara `comunicacoes_disparadas` com canal, destinatario, template_id. (2) Motor 1 dispara mensagem automaticamente ao entrar em estado com comunicação configurada. (3) Registro em `mensagens_disparadas[]` com: canal (whatsapp/email/sms), destinatario, canal_id_externo, acionado_por_estado, timestamp. (4) Estados que disparam comunicação ao paciente: `autorizado`, `negado`, `pendente_complemento`, `pendente_retorno_recurso`. (5) Estado `negado` dispara alerta imediato (prioridade crítica). |
| **Dependências** | `STATUS_AUTORIZACAO_WORKFLOW_v1.json` (campo `comunicacoes_disparadas` por estado), WhatsApp Business API / provedor (Twilio/360dialog), `EPISODIO_CIRURGICO_SCHEMA_v1.json` (bloco `mensagens_disparadas`, `paciente.contato`) |
| **Risco de Migração** | 🟡 Médio — integração com WhatsApp API requer configuração de número business verificado |
| **Observação Operacional** | Make.com atualmente envia WhatsApp via template aprovado. Manter durante transição. Motor 1 nativo substitui quando endpoint `/motor1/comunicacao/disparar` estiver implementado. Comunicação com paciente nunca deve revelar detalhes internos de glosa ou negativa — apenas status e próximos passos. |

---

## 8. RESUMO EXECUTIVO DE MIGRAÇÃO

### 8.1 Tabela Consolidada

| Ativo | Destino | Reaproveitamento | Risco |
|---|---|---|---|
| `index.html` (formulário) | Motor 1 (entrada) | 🟡 50% | 🟡 Médio |
| FastAPI `app.py` | Motor 1 + Infra | 🟡 60% | 🔴 Alto |
| Compliance Engine | Motor 1 (módulo) | 🟡 40% | 🟡 Médio |
| Schemas de Internação | Motor 1 + Motor 2 | 🟢 75% | 🟢 Baixo |
| Status de Autorização | Motor 1 (workflow) | 🔴 20% | 🟡 Médio |
| Motor PDF | Motor 2 | 🟡 55% | 🟡 Médio |
| Make.com | Transição → Motores | 🟡 45% | 🟡 Médio |
| Google Sheets (episódios) | Motor 3 (relatórios) | 🔴 25% | 🟢 Baixo |
| Billing/Logs | Motor 3 | 🟡 50% | 🟡 Médio |
| Histórico/Glosa | Motor 1 + Motor 3 | 🟡 55% | 🟡 Médio |
| Agenda | Motor 1 (metadados) | 🟢 80% | 🟢 Baixo |
| Comunicação Paciente | Motor 1 (mensagens) | 🟡 45% | 🟡 Médio |

### 8.2 Sequência de Migração Recomendada

**Fase 1 — Motor 1 (prioridade máxima — primeiro a ir ao ar):**
1. Refatorar `app.py` → endpoints `/episodios` (criar, transicionar, ler)
2. Implementar modelo Pydantic v2 baseado em `EPISODIO_CIRURGICO_SCHEMA_v1.json`
3. Implementar máquina de estados de `STATUS_AUTORIZACAO_WORKFLOW_v1.json`
4. Consolidar compliance engine em módulo isolado
5. Refatorar `index.html` para payload alinhado ao schema
6. Adicionar persistência (banco de dados — Supabase recomendado)
7. Manter Make.com como fallback de notificações

**Fase 2 — Motor 2:**
1. Implementar endpoint `/motor2/documentos/gerar`
2. Migrar geração de PDF do Make.com para FastAPI nativo
3. Adicionar storage de documentos com versionamento
4. Integrar com estados `pronto_para_envio` e `autorizado`

**Fase 3 — Motor 3:**
1. Implementar endpoint `/motor3/billing/registrar`
2. Integrar com estado `faturado`
3. Implementar módulo de glosa e recurso
4. Migrar Google Sheets para destino de exportação (leitura) em vez de fonte

### 8.3 Ativos que NÃO devem ser migrados automaticamente

| Ativo | Razão |
|---|---|
| Dados históricos brutos de Google Sheets | Requerem limpeza e validação manual antes de import |
| Cenários Make.com legados (pré-FastAPI) | Alguns cenários têm lógica não documentada — mapear antes de deprecar |
| Mensagens WhatsApp enviadas anteriormente | Sem `id_episodio` formal — não mapeáveis para schema atual |
| Status simples antigos (aprovado/negado sem contexto) | Migrar apenas episódios com data < 90 dias e status ativo |

---

## 9. DEPENDÊNCIAS CRÍTICAS ENTRE ARQUIVOS

```
EPISODIO_CIRURGICO_SCHEMA_v1.json
    ↓ (fonte única de verdade para todos os campos)
    ├── Motor 1: validação, compliance, estados, comunicação
    ├── Motor 2: geração de documentos (documentos_gerados[])
    └── Motor 3: billing (billing_context, glosa_context)

STATUS_AUTORIZACAO_WORKFLOW_v1.json
    ↓ (máquina de estados executável)
    ├── Motor 1: transições, validações, pendências
    ├── Motor 2: acionado em pronto_para_envio, enviado, autorizado
    └── Motor 3: acionado em autorizado, faturado, arquivado

MAPEAMENTO_MVP_ATUAL_PARA_3_MOTORES_v1.md (este arquivo)
    ↓ (contrato de migração)
    └── Referencia ambos os schemas acima como contratos definitivos
```

---

## 10. PRÓXIMO ENTREGÁVEL OBRIGATÓRIO

**`NEUROAUTH_ADMIN_ENGINE_v1.md`**

Define a interface administrativa que opera sobre a arquitetura de 3 motores: painel de controle de episódios, gestão de estados, override manual de transições, dashboard de billing, gestão de glosas, configuração de convênios e regras por operadora.

---

*Documento gerado em 2026-03-27. Versão 1.0.0. Alinhado com EPISODIO_CIRURGICO_SCHEMA_v1.json v1.0.0 e STATUS_AUTORIZACAO_WORKFLOW_v1.json v1.0.0.*
