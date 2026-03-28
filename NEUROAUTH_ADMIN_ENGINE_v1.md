# NEUROAUTH_ADMIN_ENGINE_v1.md
## Especificação Operacional do Motor 1 — Autorização e Compliance

**Versão:** 1.0.0
**Data:** 2026-03-27
**Projeto:** NEUROAUTH — Plataforma Operacional da Cirurgia de Alta Complexidade
**Contexto:** Dr. José Correia Jr. — Unimed Cariri — Neurocirurgia e Coluna
**Referências obrigatórias:**
- `EPISODIO_CIRURGICO_SCHEMA_v1.json` v1.0.0
- `STATUS_AUTORIZACAO_WORKFLOW_v1.json` v1.0.0
- `MAPEAMENTO_MVP_ATUAL_PARA_3_MOTORES_v1.md` v1.0.0
- `checklist_homologacao_v2.html` (critérios de homologação MVP)
- `plataforma_operacional_cirurgia_blueprint.docx` (visão estratégica)

---

## 1. PROPÓSITO

Motor 1 é o núcleo executivo do NEUROAUTH. Sua responsabilidade exclusiva é **receber um episódio cirúrgico, validá-lo contra as regras do convênio e conduzir a máquina de estados da autorização até uma decisão terminal**.

Motor 1 não gera documentos. Não calcula faturamento. Não armazena resultados financeiros. Ele faz uma coisa: **move o episódio do estado `preenchimento` até `autorizado`, `negado`, ou `arquivado`** — e registra cada passo com precisão auditável.

A premissa operacional é clara: o fluxo de autorização cirúrgica hoje é primitivo — WhatsApp, e-mail, planilha manual, documentos espalhados. Motor 1 elimina esse fluxo substituindo-o por um pipeline estruturado, rastreável e resistente a glosa.

---

## 2. ESCOPO

Motor 1 é responsável por tudo o que acontece entre o momento em que o formulário é enviado e o momento em que o convênio emite uma decisão final (aprovação ou negativa). Inclui:

**2.1 Recepção de Dados**
Receber o payload do `index.html`, validar estrutura contra `EPISODIO_CIRURGICO_SCHEMA_v1.json`, criar o objeto episódio no banco de dados, e definir `estado_atual = "preenchimento"`.

**2.2 Validação de Completude**
Verificar se todos os campos obrigatórios para o tipo de atendimento (eletivo/urgência/emergência) estão presentes e válidos. Verificar coerência entre procedimento TUSS, CID-10 e tipo de acesso. Verificar cobertura do convênio para o procedimento solicitado.

**2.3 Validação Clínica e Regulatória**
Verificar: CRM ativo, CNES do hospital, código TUSS válido, CID-10 compatível com procedimento, OPME com registro ANVISA quando `necessita_opme = true`, prazo de validade da carteirinha do paciente, coerência entre nível de complexidade e procedimento.

**2.4 Geração de Pendências**
Quando validação detecta problema, criar registro em `pendencias[]` com tipo, descrição, campo, e flag `bloqueia_envio`. Notificar responsável. Aguardar resolução humana. Retornar ao fluxo após resolução.

**2.5 Gestão da Máquina de Estados**
Executar transições de estado conforme `STATUS_AUTORIZACAO_WORKFLOW_v1.json`. Validar que a transição solicitada está na lista `transicoes_permitidas` do estado atual. Rejeitar com HTTP 422 qualquer transição não autorizada. Registrar cada transição em `historico_estados` e `timeline_eventos`.

**2.6 Disparo de Comunicações Operacionais**
Quando um estado com `comunicacoes_disparadas` for atingido, Motor 1 prepara e envia a mensagem conforme template e canal configurados. Registra em `mensagens_disparadas[]`.

**2.7 Gestão de Prazo e SLA**
Calcular urgência baseada em `data_prevista_procedimento` e `tipo_atendimento`. Monitorar SLA do convênio: urgência = 4h, eletivo = 72h (RN ANS 259/2011). Disparar alerta quando SLA em risco.

**2.8 Orquestração do Processo de Recurso**
Quando episódio é negado e equipe decide recorrer: gerenciar estados `recurso_em_preparo → recurso_enviado → pendente_retorno_recurso`. Solicitar ao Motor 2 geração do documento de recurso. Aguardar retorno do convênio. Registrar resultado.

---

## 3. FORA DE ESCOPO DO MOTOR 1

Motor 1 não executa nenhuma das seguintes funções. Qualquer tentativa de atribuir essas responsabilidades ao Motor 1 é um erro de arquitetura:

| Função | Responsável Correto |
|---|---|
| Geração de PDF (SADT, guia internação, OPME, recurso) | Motor 2 |
| Armazenamento de documentos gerados | Motor 2 |
| Versionamento de documentos | Motor 2 |
| Registro de valor autorizado, pago ou glosado | Motor 3 |
| Lançamento de competência de faturamento | Motor 3 |
| Gestão de glosa financeira (valores, recuperação) | Motor 3 |
| Exportação para Google Sheets (relatórios) | Motor 3 |
| Nota fiscal eletrônica | Motor 3 |
| Agendamento de cirurgia (data/sala/equipe) | Módulo futuro (v2) |
| Prontuário eletrônico | Fora do NEUROAUTH v1 |
| Prescrição médica | Fora do NEUROAUTH v1 |
| ERP hospitalar | Fora do NEUROAUTH v1 |

Motor 1 **aciona** Motor 2 e Motor 3 via evento — mas não executa suas funções.

---

## 4. ENTRADAS

### 4.1 Entrada Principal — Payload do Formulário

**Origem:** `POST /api/v1/episodios`
**Fonte:** `index.html` via `NA_FASTAPI_URL = 'https://neuroauth-api.onrender.com'`
**Formato:** JSON conforme `EPISODIO_CIRURGICO_SCHEMA_v1.json`

**Campos obrigatórios para aceitar o payload:**

```
request_id              — UUID v4, obrigatório para idempotência
paciente.carteirinha    — número da carteirinha do beneficiário
paciente.nome           — nome completo
paciente.cpf            — CPF válido (padrão \d{3}\.\d{3}\.\d{3}-\d{2})
paciente.data_nascimento — ISO 8601 date
medico.crm              — CRM com estado (ex: CRM/CE 12345)
medico.especialidade    — especialidade principal
hospital.cnes           — CNES do hospital
convenio.id_convenio    — identificador interno do convênio
convenio.codigo_tiss    — código operadora ANS
procedimento_principal.codigo_tuss  — código TUSS/CBHPM
procedimento_principal.cid_principal — CID-10 principal
identificacao_caso.tipo_atendimento — enum: eletivo | urgencia | emergencia
```

**Campos obrigatórios adicionais quando `tipo_atendimento = "eletivo"`:**
```
procedimento_principal.data_prevista_procedimento — ISO 8601 datetime
```

**Campos obrigatórios quando `opme.necessita_opme = true`:**
```
opme.itens[]            — array com ≥1 item
opme.itens[].codigo_anvisa — registro ANVISA obrigatório
opme.itens[].descricao  — descrição do item
opme.itens[].fabricante — nome do fabricante
opme.itens[].quantidade — integer ≥ 1
opme.justificativa_clinica — texto obrigatório quando OPME presente
```

### 4.2 Entrada de Transição de Estado

**Origem:** `PATCH /api/v1/episodios/{id_episodio}/transicao`
**Corpo:**
```json
{
  "estado_destino": "em_analise",
  "origem_acao": "motor_1 | operador | medico | convenio",
  "observacao": "texto opcional",
  "request_id": "UUID para idempotência"
}
```

### 4.3 Entrada de Resolução de Pendência

**Origem:** `PATCH /api/v1/episodios/{id_episodio}/pendencias/{id_pendencia}`
**Corpo:**
```json
{
  "acao": "resolvida | descartada",
  "resolucao": "descrição da resolução",
  "resolvido_por": "id do usuário ou motor"
}
```

### 4.4 Entrada de Retorno do Convênio

**Origem:** `POST /api/v1/episodios/{id_episodio}/retorno_convenio`
**Corpo:**
```json
{
  "decisao": "autorizado | negado | pendente_complemento",
  "numero_autorizacao": "string (quando autorizado)",
  "validade_autorizacao": "ISO 8601 date",
  "motivo_negativa": "string (quando negado)",
  "codigo_negativa_tiss": "string (quando negado)",
  "request_id": "UUID"
}
```

---

## 5. PROCESSAMENTO

### 5.1 Pipeline de Criação de Episódio

```
1. Receber POST /api/v1/episodios
2. Verificar idempotência via request_id
   → Se request_id já processado: retornar resposta original (HTTP 200 + episódio existente)
   → Se novo: continuar
3. Validar estrutura JSON contra EPISODIO_CIRURGICO_SCHEMA_v1.json
   → Falha de schema: HTTP 422 com erros detalhados por campo
4. Gerar id_episodio (UUID v4) — imutável após criação
5. Definir estado_atual = "preenchimento"
6. Registrar evento em timeline_eventos:
   tipo: "episodio_criado", origem: "formulario_web"
7. Persistir episódio no banco de dados
8. Retornar HTTP 201 com id_episodio e estado_atual
9. Disparar assincronamente: transição automática para "validacao"
```

### 5.2 Pipeline de Validação (estado `validacao`)

Executado automaticamente após criação. Timeout máximo: 60 segundos. Se timeout: estado → `pendente_complemento` com pendência tipo `erro_tecnico_envio`.

```
1. Entrar em estado "validacao" (machine-only, sem interação humana)
2. Executar checks em paralelo:

   CHECK A — Completude de Campos
   → Verificar todos os campos required do schema para o tipo_atendimento
   → Verificar coerência OPME: se necessita_opme=true, validar itens[]
   → Resultado: PASS | FAIL [lista de campos ausentes]

   CHECK B — Validação Clínica
   → CID-10 compatível com especialidade do médico (tabela interna)
   → Procedimento TUSS compatível com CID-10 (tabela TISS)
   → Complexidade do procedimento compatível com tipo de hospital (CNES)
   → Resultado: PASS | FAIL [lista de incompatibilidades]

   CHECK C — Validação Regulatória
   → Código TUSS existe e está ativo na tabela de procedimentos
   → CID-10 existe e está ativo (CID-10 versão OMS)
   → CNES do hospital está ativo no CNES/SCNES
   → Carteirinha dentro da validade
   → Resultado: PASS | FAIL [lista de erros regulatórios]

   CHECK D — Cobertura do Convênio
   → Procedimento TUSS está no rol de cobertura do convenio.id_convenio
   → OPME itens estão na lista de OPME cobertos pelo convênio (quando aplicável)
   → Hospital está na rede credenciada do convênio
   → Resultado: PASS | FAIL [itens não cobertos]

3. Consolidar resultados:
   → Todos PASS: transicionar para "em_analise"
   → Algum FAIL: criar pendencias[], transicionar para "pendente_complemento"

4. Registrar resultado em timeline_eventos e historico_estados
```

### 5.3 Pipeline de Análise (estado `em_analise`)

```
1. Motor 1 solicita ao Motor 2: gerar SADT ou Guia de Internação
2. Aguardar confirmação de Motor 2 (documento gerado e armazenado)
3. Registrar referência do documento em documentos_gerados[]
4. Disparar comunicação: notificar operador que episódio está pronto para envio
5. Transicionar para "pronto_para_envio"
   → (Motor 2 assume a partir daqui para envio ao convênio)
```

### 5.4 Pipeline de Resolução de Pendência

```
1. Operador humano resolve pendência via interface administrativa ou API
2. Motor 1 recebe PATCH /pendencias/{id}
3. Marcar pendência como resolvida
4. Verificar se existem outras pendencias com bloqueia_envio = true
5. Se não há mais pendências bloqueantes:
   → Retornar ao pipeline de validação (re-executar todos os checks)
6. Se ainda há pendências bloqueantes:
   → Manter estado "pendente_complemento"
   → Notificar operador sobre pendências remanescentes
```

### 5.5 Pipeline de Recurso

```
1. Episódio entra em estado "negado"
2. Motor 1 dispara alerta imediato (WhatsApp + email) para médico e equipe
3. Operador decide: aceitar negativa ou recorrer
4. Se recurso:
   → Transicionar para "recurso_em_preparo"
   → Motor 1 solicita ao Motor 2: gerar documento "recurso_glosa"
   → Aguardar geração do documento
5. Operador revisa e aprova o documento de recurso
6. Transicionar para "recurso_enviado"
7. Aguardar retorno do convênio: estado "pendente_retorno_recurso"
8. Receber resultado:
   → Aprovado: transicionar para "autorizado"
   → Negado definitivo: manter "negado", registrar como encerrado
```

---

## 6. DECISÕES

### 6.1 Decisões que Motor 1 pode tomar automaticamente (sem intervenção humana)

| Decisão | Condição | Ação |
|---|---|---|
| Aceitar payload | Estrutura JSON válida + request_id único | Criar episódio, estado = preenchimento |
| Rejeitar payload | Schema inválido | HTTP 422 com detalhes |
| Iniciar validação | Estado = preenchimento, episódio recém-criado | Transição automática para validacao |
| Aprovar validação | Todos os 4 checks passam | Transição para em_analise |
| Criar pendência | Qualquer check falha | Criar pendencia[], transição para pendente_complemento |
| Disparar alerta de SLA | SLA em risco (urgência > 3h, eletivo > 60h) | Notificação automática |
| Retornar à validação | Todas pendências bloqueantes resolvidas | Re-executar pipeline de validação |
| Idempotência | request_id já processado | Retornar resposta original, sem reprocessar |
| Timeout de validação | Validação > 60s sem resposta | Criar pendência tipo erro_tecnico_envio |

### 6.2 Decisões que Motor 1 NÃO pode tomar sem intervenção humana

| Decisão | Quem decide | Motivo |
|---|---|---|
| Aprovar autorização | Convênio | Decisão regulatória exclusiva da operadora |
| Negar autorização | Convênio | Decisão regulatória exclusiva da operadora |
| Aceitar negativa sem recurso | Médico/equipe | Decisão clínica e estratégica |
| Iniciar recurso | Médico/equipe | Requer avaliação clínica e documental |
| Arquivar episódio | Operador autorizado | Ação terminal e irreversível |
| Substituir OPME listado | Médico | Decisão clínica |
| Alterar CID-10 após criação | Médico + operador | Impacta compliance e auditoria |
| Alterar procedimento TUSS após envio | Médico + operador | Impacta cobertura e legalidade |
| Liberar episódio com pendência bloqueante | Operador supervisor | Bypass consciente e auditado |

**Regra:** Qualquer ação de um humano sobre o episódio é registrada em `timeline_eventos` com `origem = "operador"` ou `"medico"`, nunca com `"motor_1"`.

---

## 7. SAÍDAS

### 7.1 Saídas Diretas (Motor 1 produz e persiste)

**Episódio criado:**
```json
HTTP 201
{
  "id_episodio": "uuid-v4",
  "estado_atual": "preenchimento",
  "request_id": "uuid-original",
  "criado_em": "ISO 8601 datetime"
}
```

**Resultado de transição:**
```json
HTTP 200
{
  "id_episodio": "uuid",
  "estado_anterior": "em_analise",
  "estado_atual": "pronto_para_envio",
  "transicionado_em": "ISO 8601 datetime",
  "origem": "motor_1"
}
```

**Erro de transição inválida:**
```json
HTTP 422
{
  "erro": "transicao_invalida",
  "estado_atual": "arquivado",
  "estado_destino_solicitado": "em_analise",
  "motivo": "Estado arquivado é terminal. Transição bloqueada permanentemente.",
  "transicoes_permitidas": []
}
```

**Pendências identificadas:**
```json
{
  "id_episodio": "uuid",
  "pendencias": [
    {
      "id_pendencia": "uuid",
      "tipo": "cid_incompativel",
      "descricao": "CID M51.1 não compatível com procedimento TUSS 40701014 para convênio Unimed Cariri",
      "campo_afetado": "procedimento_principal.cid_principal",
      "bloqueia_envio": true,
      "criada_em": "ISO 8601"
    }
  ]
}
```

### 7.2 Saídas Indiretas (Motor 1 dispara, outro motor executa)

| Saída | Motor Executor | Condição de Disparo |
|---|---|---|
| Geração de SADT | Motor 2 | Estado `em_analise` |
| Geração de Guia de Internação | Motor 2 | Estado `em_analise` (quando tipo = internação) |
| Geração de Guia OPME | Motor 2 | Estado `em_analise` + `opme.necessita_opme = true` |
| Geração de Documento de Recurso | Motor 2 | Estado `recurso_em_preparo` |
| Registro de valor autorizado | Motor 3 | Estado `autorizado` |
| Lançamento de faturamento | Motor 3 | Estado `faturado` |

### 7.3 Saídas de Comunicação (Motor 1 dispara via `mensagens_disparadas`)

| Estado | Canal | Destinatário | Conteúdo |
|---|---|---|---|
| `pendente_complemento` | WhatsApp | Operador | "Episódio {id} bloqueado: {lista de pendências}" |
| `em_analise` | Email | Médico | "Episódio {id} em análise — documentos gerados" |
| `negado` | WhatsApp | Médico + Operador | "ALERTA: Episódio {id} NEGADO — {motivo}" (prioridade crítica) |
| `autorizado` | WhatsApp + Email | Paciente + Médico | "Cirurgia autorizada — {número autorização}" |
| `recurso_em_preparo` | Email | Médico | "Recurso em preparação — revisar documento" |
| SLA em risco | WhatsApp | Operador | "URGENTE: SLA vencendo em {X}h — episódio {id}" |

---

## 8. INTEGRAÇÕES

### 8.1 `index.html` → Motor 1

**Protocolo:** HTTPS POST
**URL:** `https://neuroauth-api.onrender.com/api/v1/episodios`
**Variável:** `NA_FASTAPI_URL` (já configurada no frontend)
**Payload:** JSON conforme `EPISODIO_CIRURGICO_SCHEMA_v1.json`
**Resposta esperada:** HTTP 201 com `id_episodio`
**Falha:** Frontend exibe erro ao usuário. Não reenviar automaticamente sem novo `request_id`.

**Adaptação pendente no frontend:**
- Gerar `request_id` (UUID v4) a cada submit (não reutilizar)
- Incluir `tipo_atendimento` como campo obrigatório no formulário
- Validar OPME: se `necessita_opme = true`, exigir ≥1 item com código ANVISA
- Corrigir inconsistência: PROC001 (microdiscectomia) não deve popular cage PLIF no OPME_DB (apontado no checklist_homologacao_v2)

### 8.2 Motor 1 → Make.com (fase de transição)

**Uso atual:** Motor 1 chama Make.com webhook para:
- Envio de notificações WhatsApp (durante transição)
- Atualização da planilha PLANILHA_NEUROAUTH aba EPISODIOS (backup de auditoria)

**Protocolo:** HTTP POST para webhook Make.com
**Payload mínimo:**
```json
{
  "id_episodio": "uuid",
  "estado_atual": "em_analise",
  "paciente_nome": "string",
  "procedimento_tuss": "string",
  "convenio": "string",
  "evento": "string (tipo do evento)"
}
```
**Deprecação:** Make.com é substituído gradualmente à medida que Motor 1 implementa comunicação nativa e Motor 3 substitui a planilha.

### 8.3 Motor 1 → Motor 2

**Protocolo:** Evento interno (fila de mensagens ou chamada HTTP interna)
**Trigger:** Motor 1 entra em estado `em_analise` ou `recurso_em_preparo`
**Payload:**
```json
{
  "id_episodio": "uuid",
  "tipo_documento": "sadt | guia_internacao | guia_opme | recurso_glosa",
  "dados_episodio": { ... bloco completo do schema ... }
}
```
**Resposta esperada:** Motor 2 confirma geração e retorna:
```json
{
  "id_documento": "uuid",
  "tipo": "sadt",
  "versao": 1,
  "hash_md5": "string",
  "url_storage": "string"
}
```
Motor 1 persiste isso em `documentos_gerados[]` do episódio.

### 8.4 Motor 1 → Motor 3

**Protocolo:** Evento ao entrar nos estados `autorizado` e `faturado`
**Payload para `autorizado`:**
```json
{
  "id_episodio": "uuid",
  "numero_autorizacao": "string",
  "validade_autorizacao": "ISO date",
  "valor_autorizado": "decimal"
}
```
Motor 3 persiste em `billing_context` do episódio.

### 8.5 Motor 1 → Google Sheets (fase de transição via Make.com)

Motor 1 não escreve diretamente na planilha. Aciona Make.com com evento, e o cenário Make.com atualiza a aba EPISODIOS da PLANILHA_NEUROAUTH.
Colunas esperadas: `id_episodio`, `paciente`, `médico`, `convenio`, `procedimento`, `estado_atual`, `data_criacao`, `data_ultima_atualizacao`.

---

## 9. REGRAS DE NEGÓCIO

### 9.1 Regras de Validação

**R01 — Idempotência obrigatória**
Todo endpoint que cria ou muta estado aceita `request_id`. Se o mesmo `request_id` for recebido novamente, retornar a resposta original sem reprocessar. Logar tentativa de reprocessamento em `timeline_eventos`.

**R02 — CID-10 compatível com procedimento**
A tabela interna `tuss_cid_compatibilidade` define quais CIDs são aceitos para cada código TUSS. Motor 1 valida no CHECK B. Incompatibilidade gera pendência tipo `cid_incompativel`.

**R03 — OPME exige código ANVISA**
Se `necessita_opme = true`, cada item em `opme.itens[]` deve ter `codigo_anvisa` preenchido e válido. Sem código ANVISA: pendência tipo `opme_nao_autorizada` com `bloqueia_envio = true`.

**R04 — Carteirinha dentro da validade**
Campo `paciente.validade_carteirinha` deve ser ≥ data do procedimento (ou data atual para urgência). Carteirinha vencida: pendência tipo `dados_beneficiario_invalidos`.

**R05 — Hospital na rede credenciada**
CNES do hospital deve estar na lista de hospitais credenciados do `convenio.id_convenio`. Hospital não credenciado: pendência tipo `conflito_cobertura`.

**R06 — Procedimento TUSS coberto**
Código TUSS deve estar no rol de cobertura do convênio. Procedimento não coberto: pendência tipo `procedimento_nao_coberto`. Esta pendência não pode ser resolvida automaticamente — requer confirmação manual ou substituição de procedimento.

**R07 — SLA por tipo de atendimento**
- `emergencia`: SLA = imediato. Motor 1 sinaliza prioridade máxima em todos os logs.
- `urgencia`: SLA = 4h após criação do episódio. Alerta em 3h.
- `eletivo`: SLA = 72h. Alerta em 60h. Alerta crítico quando data_prevista_procedimento < 5 dias.

**R08 — Estado `arquivado` é permanentemente imutável**
Nenhuma transição é permitida a partir de `arquivado`. Nenhuma mutação de campo é permitida. Qualquer tentativa retorna HTTP 422 com `hard_block_permanente: true`.

**R09 — Histórico é append-only**
`historico_estados` e `timeline_eventos` nunca são editados ou deletados. Toda mutação adiciona um novo registro. Não existe endpoint de DELETE ou PATCH para esses arrays.

**R10 — `id_episodio` é imutável**
Uma vez gerado na criação, o `id_episodio` nunca muda, nunca é reutilizado, e nunca é deletado fisicamente (soft delete via `metadata.soft_delete = true`).

### 9.2 Regras de Bloqueio

**B01 — Pendência bloqueante impede envio**
Se qualquer pendência em `pendencias[]` tiver `bloqueia_envio = true`, o episódio não pode transicionar para `pronto_para_envio`. Motor 1 retorna HTTP 409 se a transição for solicitada.

**B02 — Documentos obrigatórios antes do envio**
Motor 1 só aceita transição `em_analise → pronto_para_envio` após confirmar que Motor 2 gerou e armazenou pelo menos 1 documento do tipo correto para o episódio.

**B03 — Sem reprocessamento de episódio arquivado**
Episódio com `estado_atual = "arquivado"` não pode ser reativado por nenhuma via, incluindo chamadas diretas ao banco de dados. Log de tentativa de bypass deve ser gerado.

**B04 — Autorização sem número é inválida**
Transição para estado `autorizado` requer `numero_autorizacao` não-nulo. Motor 1 rejeita a transição com HTTP 422 se o campo estiver ausente.

### 9.3 Regras de Cobertura de Convênio (Unimed Cariri — referência operacional)

Com base nos manuais enviados (Manual de Codificação Coluna, Diretrizes de Pedidos Coluna, Manual de Negativas):

**Coluna — Validações críticas:**
- Procedimentos de coluna requerem `niveis_anatomicos` especificados (L1-L5, S1, C1-C7, T1-T12)
- `via_acesso` deve ser compatível com o nível anatômico (ex: lombar = posterior ou anterior)
- Artroplastia cervical anterior requer justificativa clínica documentada
- OPME para coluna: cage, parafusos, placa — cada item com ANVISA e fabricante

**Neurocirurgia — Validações críticas:**
- Angiografia cerebral: solicitar SADT com código TUSS específico de angiografia
- Procedimentos intracranianos: CNES deve ter UTI credenciada
- Microdiscectomia (PROC001): não inclui cage PLIF — incompatibilidade identificada no checklist

---

## 10. GATILHOS POR ESTADO

Cada estado da máquina ativa ações específicas no Motor 1. Tabela de responsabilidades:

| Estado | Motor 1 faz automaticamente |
|---|---|
| `preenchimento` | Valida schema. Gera id_episodio. Registra criação. Dispara pipeline de validação. |
| `validacao` | Executa 4 checks. Decide próximo estado. Timeout = 60s. |
| `em_analise` | Solicita documentos ao Motor 2. Notifica operador. Calcula SLA. |
| `pendente_complemento` | Cria pendencias[]. Notifica responsável. Aguarda resolução. Alerta se SLA próximo. |
| `pronto_para_envio` | Confirma documentos gerados. Passa controle ao Motor 2. Registra handoff. |
| `enviado` | Registra timestamp de envio. Inicia contagem de SLA de resposta do convênio. |
| `em_analise` (convênio) | Aguarda. Monitora SLA. Dispara alerta se convênio não responde. |
| `autorizado` | Registra número de autorização. Notifica médico e paciente. Aciona Motor 3. |
| `negado` | Dispara alerta imediato (crítico). Notifica médico. Aguarda decisão de recurso. |
| `recurso_em_preparo` | Solicita documento de recurso ao Motor 2. Notifica médico para revisão. |
| `recurso_enviado` | Registra envio do recurso. Inicia contagem de prazo de retorno. |
| `pendente_retorno_recurso` | Aguarda. Monitora prazo. Alerta se sem resposta. |
| `faturado` | Aciona Motor 3 para lançamento de billing. |
| `arquivado` | Bloqueia qualquer mutação futura (hard_block_permanente). |

---

## 11. LOGS E AUDITORIA

### 11.1 Estrutura de Evento (`timeline_eventos`)

Cada ação de Motor 1 gera um evento append-only:

```json
{
  "id_evento": "uuid-v4",
  "timestamp": "ISO 8601 datetime com timezone",
  "tipo": "validacao_iniciada | validacao_concluida | pendencia_criada | estado_alterado | comunicacao_disparada | ...",
  "origem": "motor_1 | operador | medico | convenio | formulario_web",
  "estado_antes": "string | null",
  "estado_depois": "string | null",
  "dados": { ... contexto específico do evento ... },
  "request_id": "uuid (quando aplicável)"
}
```

### 11.2 Eventos Obrigatórios do Motor 1

Motor 1 deve gerar os seguintes eventos sem exceção:

```
episodio_criado           — criação do episódio (origem: formulario_web)
validacao_iniciada        — início do pipeline de validação (origem: motor_1)
validacao_concluida       — resultado dos 4 checks (dados: resumo dos checks)
pendencia_criada          — cada pendência criada (dados: tipo, campo, bloqueia_envio)
pendencia_resolvida       — cada pendência resolvida (dados: resolucao, resolvido_por)
estado_alterado           — cada transição de estado (dados: estado_antes, estado_depois, origem)
comunicacao_disparada     — cada mensagem enviada (dados: canal, destinatario, template)
documento_solicitado      — solicitação ao Motor 2 (dados: tipo_documento)
documento_confirmado      — confirmação do Motor 2 (dados: id_documento, hash_md5)
sla_alerta                — quando SLA em risco (dados: horas_restantes, tipo_atendimento)
transicao_invalida_tentada — tentativa de transição bloqueada (dados: estado_destino, motivo)
bypass_manual             — quando operador ignora regra (dados: regra_ignorada, justificativa)
```

### 11.3 Requisitos Mínimos de Auditoria TISS/ANS

- Todo episódio deve ter rastreabilidade completa do estado inicial até o estado terminal
- Timestamps com timezone obrigatórios em todos os eventos
- Identificação da origem de toda mutação (motor, operador, convênio)
- Pendências devem registrar criação e resolução com responsável identificado
- Autorização deve registrar número de autorização emitido pelo convênio
- Negativas devem registrar código de negativa TISS
- Retenção mínima de logs: 5 anos (conforme regulamentação ANS)

---

## 12. FALHAS E CONTINGÊNCIA

### 12.1 Modos de Falha Conhecidos

| Falha | Impacto | Resposta do Motor 1 |
|---|---|---|
| FastAPI indisponível (Render cold start) | Formulário não consegue criar episódio | Frontend exibe erro. Usuário deve tentar após 30s. Não reenviar automaticamente — gerar novo request_id. |
| Banco de dados inacessível | Motor 1 não persiste episódio | HTTP 503. Log de falha. Não criar episódio parcial. |
| Timeout de validação (> 60s) | Episódio fica em estado `validacao` | Criar pendência tipo `erro_tecnico_envio`. Mover para `pendente_complemento`. Alertar operador. |
| Motor 2 não responde | Documentos não gerados | Motor 1 registra `documento_solicitado` sem `documento_confirmado`. Criar alerta. Retry automático (max 3x, intervalo 5min). Após 3 falhas: pendência `erro_tecnico_envio`. |
| Make.com indisponível | Notificações não enviadas | Registrar falha em `mensagens_disparadas` com status `falha`. Não bloquear fluxo principal. Retry automático. |
| Payload sem request_id | Risco de duplicação | Rejeitar com HTTP 400. `request_id` é obrigatório em produção. |
| Transição inválida solicitada | Tentativa de corromper estado | HTTP 422. Registrar `transicao_invalida_tentada` em timeline. Alertar se padrão de tentativas suspeitas. |

### 12.2 Fallback Manual

Motor 1 deve expor os seguintes endpoints de fallback para uso em emergências:

**Override de estado (supervisor autorizado):**
```
POST /api/v1/episodios/{id}/admin/override-estado
Body: { "estado_destino": "...", "justificativa": "...", "autorizado_por": "id" }
Requer: token de administrador
Resultado: Transição executada + evento bypass_manual registrado
```

**Reprocessamento de validação:**
```
POST /api/v1/episodios/{id}/admin/revalidar
Requer: token de administrador
Resultado: Re-executa pipeline de validação sem criar novo episódio
```

**Injeção manual de retorno de convênio:**
```
POST /api/v1/episodios/{id}/retorno_convenio
Body: { "decisao": "autorizado", "numero_autorizacao": "...", ... }
Resultado: Motor 1 processa como se fosse retorno real do convênio
```

### 12.3 Procedimento de Contingência Operacional

Quando Motor 1 estiver fora do ar e houver episódio urgente:

1. Operador documenta caso manualmente na planilha PLANILHA_NEUROAUTH (modo degradado)
2. Ao restaurar Motor 1: inserir episódio via API com timestamps históricos
3. Inserir eventos retroativos em `timeline_eventos` com `origem = "entrada_retroativa_manual"`
4. Marcar `metadata.ambiente = "staging"` para episódios inseridos retroativamente até validação

---

## 13. MVP OPERACIONAL — Motor 1 v1.0

### 13.1 Definição de MVP Mínimo

Motor 1 v1.0 está pronto para produção quando os seguintes itens estiverem funcionando end-to-end:

**Recepção:**
- [ ] `POST /api/v1/episodios` aceita payload do `index.html`
- [ ] Idempotência por `request_id` funcionando
- [ ] Validação de schema Pydantic v2 com erros detalhados por campo
- [ ] `id_episodio` UUID gerado e imutável
- [ ] Estado inicial `preenchimento` criado e persistido no banco

**Validação:**
- [ ] CHECK A (completude) funcionando para campos obrigatórios do schema
- [ ] CHECK B (validação clínica) com tabela TUSS-CID mínima (coluna + neurocirurgia)
- [ ] CHECK C (regulatório) com validação de formato de CRM, CNES, CID-10
- [ ] CHECK D (cobertura) com lista mínima de procedimentos cobertos pela Unimed Cariri
- [ ] Pendências criadas corretamente com `bloqueia_envio` quando aplicável
- [ ] Timeout de 60s implementado com fallback para `pendente_complemento`

**Máquina de Estados:**
- [ ] `PATCH /api/v1/episodios/{id}/transicao` funcionando
- [ ] Transições válidas executadas conforme workflow
- [ ] Transições inválidas rejeitadas com HTTP 422
- [ ] `historico_estados` e `timeline_eventos` append-only funcionando
- [ ] Estado `arquivado` bloqueado permanentemente

**Comunicação (modo Make.com):**
- [ ] Motor 1 aciona Make.com webhook nos estados críticos: `pendente_complemento`, `negado`, `autorizado`
- [ ] WhatsApp de alerta para `negado` com prioridade crítica funcionando

**Banco de Dados:**
- [ ] Episódios persistidos (não mais stateless)
- [ ] `GET /api/v1/episodios/{id}` retorna episódio completo
- [ ] Soft delete implementado (`metadata.soft_delete`)

**Integração Motor 2 (mínima):**
- [ ] Motor 1 chama Motor 2 ao entrar em `em_analise`
- [ ] Motor 1 registra documento recebido em `documentos_gerados[]`

### 13.2 Critérios de GO/NO-GO para v1.0 (baseado em checklist_homologacao_v2)

**GO obrigatório:**
- Formulário envia payload e recebe `id_episodio` — sem erros
- Episódio com campos válidos chega a `em_analise` sem intervenção
- Episódio com campo obrigatório faltando cria pendência e bloqueia envio
- OPME sem código ANVISA é bloqueado
- Negativa dispara alerta WhatsApp em < 2 minutos
- Estado `arquivado` rejeita qualquer transição

**NO-GO bloqueante:**
- Episódio duplicado criado com mesmo `request_id`
- Transição inválida executada sem erro
- `historico_estados` modificado retroativamente
- Episódio criado sem persistência (stateless)
- Pendência com `bloqueia_envio = true` não bloqueia envio

### 13.3 Stack Técnica Mínima para v1.0

```
Backend:    FastAPI + Python 3.11
Validação:  Pydantic v2.7.1
Banco:      Supabase (PostgreSQL) — recomendado pela simplicidade de setup
Auth:       JWT simples (Bearer token) para endpoints de admin
Deploy:     Render.com (Python 3.11.0 via PYTHON_VERSION env var)
Fila:       Sem fila em v1.0 — chamadas síncronas com retry manual
Notif:      Make.com webhook (bridge temporária)
```

---

## 14. BACKLOG DE EVOLUÇÃO

### Motor 1 v1.1 — Robustez

**Objetivo:** Tornar o Motor 1 resistente a falhas e apto para volume real.

- [ ] Implementar fila de mensagens assíncrona (Redis + RQ ou Celery) para pipeline de validação
- [ ] Retry automático para chamadas ao Motor 2 (max 3x, backoff exponencial)
- [ ] Retry automático para notificações Make.com
- [ ] Monitoramento de SLA em background (worker que verifica episódios em aberto a cada 15min)
- [ ] Alertas automáticos de SLA sem intervenção humana
- [ ] Rate limiting nos endpoints públicos
- [ ] Logging estruturado (JSON) para integração com Datadog/Sentry
- [ ] Testes automatizados cobrindo todos os casos do checklist_homologacao_v2
- [ ] Migração gradual de Make.com: comunicação WhatsApp nativa via Twilio/360dialog
- [ ] Tabela TUSS-CID expandida (coluna completa + neurocirurgia crânio)

### Motor 1 v1.2 — Automações Adicionais

**Objetivo:** Reduzir intervenção manual para zero nos casos-padrão.

- [ ] Comunicação nativa com portais de autorização online dos convênios (Unimed online)
- [ ] Parser de retorno de autorização: Motor 1 lê XML TISS de resposta do convênio
- [ ] Envio eletrônico de SADT via TISS XML (eliminando envio manual)
- [ ] Detecção automática de prazo de recurso (prazos ANS por tipo de procedimento)
- [ ] Sugestão automática de CID alternativo quando CID principal não coberto
- [ ] Detecção de padrão de glosa por convênio (Motor 1 avisa quando código tem histórico de glosa)
- [ ] Multi-convênio: Motor 1 gerencia casos com cobertura compartilhada
- [ ] Webhook de entrada de convênios (receber decisão em tempo real em vez de consulta manual)
- [ ] Dashboard de SLA em tempo real (integrado com Motor 3)
- [ ] Suporte a multi-tenant por clínica/grupo médico (`tenant_id` ativo)

---

## RESUMO EXECUTIVO

**O que o Motor 1 passa a fazer com clareza:**
Motor 1 é o dono do ciclo de vida da autorização. Recebe o episódio, valida contra regras clínicas e regulatórias, conduz a máquina de 15 estados do fluxo de autorização, cria e resolve pendências, monitora SLA, dispara comunicações operacionais, e orquestra os outros motores nos momentos certos. A equipe administrativa para de gerenciar planilha — gerencia Motor 1.

**O que ainda fica fora do Motor 1:**
Geração e armazenamento de documentos (Motor 2). Tudo relacionado a valor financeiro: autorizado, pago, glosado, faturado, competência (Motor 3). Prontuário eletrônico, prescrição, nota operatória (fora do NEUROAUTH v1). Agendamento de cirurgia (módulo futuro v2).

**Próximo artefato técnico natural:**
`NEUROAUTH_MOTOR2_ENGINE_v1.md` — Especificação Operacional do Motor 2 (Documentos e PDF): define como Motor 2 recebe solicitações do Motor 1, gera SADT/guia internação/OPME/recurso, versiona documentos, armazena com hash, e devolve referências ao episódio. Motor 2 é o que torna o episódio enviável ao convênio.

---

*Documento gerado em 2026-03-27. Versão 1.0.0. Base de implementação do Motor 1 — NEUROAUTH.*
*Alinhado com: EPISODIO_CIRURGICO_SCHEMA_v1.json | STATUS_AUTORIZACAO_WORKFLOW_v1.json | MAPEAMENTO_MVP_ATUAL_PARA_3_MOTORES_v1.md*
*Referências operacionais: checklist_homologacao_v2.html | plataforma_operacional_cirurgia_blueprint.docx*
*Convênio de referência: Unimed Cariri. Especialidade: Neurocirurgia e Coluna. Dr. José Correia Jr.*
