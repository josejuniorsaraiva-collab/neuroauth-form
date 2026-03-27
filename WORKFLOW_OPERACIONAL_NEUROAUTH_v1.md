# WORKFLOW_OPERACIONAL_NEUROAUTH_v1
**Sistema:** NEUROAUTH | **Data:** 2026-03-27
**Escopo:** Máquina de estados da guia — do rascunho ao arquivamento

---

## 1. MÁQUINA DE ESTADOS

```
                        ┌──────────────┐
                        │   rascunho   │ ←── criação automática ao iniciar formulário
                        └──────┬───────┘
                               │ médico começa a preencher
                               ▼
                        ┌──────────────┐
                        │ preenchimento│ ←── campos são alterados
                        └──────┬───────┘
                               │ "Visualizar Guias" (openPreview)
                               ▼
                        ┌──────────────┐
             ┌──────────│  validacao   │
             │          └──────┬───────┘
             │ bloqueios        │ sem bloqueios
             │                  ▼
             │          ┌───────────────────┐
             │          │ pronto_para_envio  │
             │          └──────┬────────────┘
             ▼                 │ "Confirmar Envio"
        preenchimento           ▼
                        ┌───────────────────┐
                        │  enviado_make      │ ←── POST webhook confirmado
                        └──────┬────────────┘
                               │ Make.com gera PDFs
                               ▼
                        ┌───────────────────┐
                        │ documento_gerado   │ ←── PDFs no Drive, episódio no Sheets
                        └──────┬────────────┘
                               │ PDFs enviados ao convênio
                               ▼
                        ┌──────────────────────┐
                        │ pendente_autorizacao  │
                        └─────┬────────────────┘
               ┌──────────────┼──────────────────┐
               │              │                   │
               ▼              ▼                   ▼
         ┌──────────┐   ┌──────────┐    ┌──────────────────┐
         │autorizado│   │  negado  │    │pendente_reenvio   │
         └────┬─────┘   └────┬─────┘    └──────┬───────────┘
              │              │ recurso           │ correção + reenvio
              │              ▼                   └──▶ enviado_make
              │         ┌──────────────────┐
              │         │  em_recurso      │
              │         └──────────────────┘
              ▼
         ┌──────────┐
         │ faturado │ ←── billing registrado
         └────┬─────┘
              │
              ▼
         ┌──────────┐
         │arquivado │ ←── guia finalizada, histórico imutável
         └──────────┘
```

---

## 2. DEFINIÇÃO DE CADA ESTADO

### `rascunho`
- **Descrição:** Guia criada mas não iniciada ativamente.
- **Entrada:** Abertura do formulário com campos vazios ou restaurados do draft.
- **Saída:** Qualquer campo é alterado → `preenchimento`.
- **Quem pode alterar:** Médico / secretária com sessão ativa.
- **Dados persistidos:** Apenas SAFE_DRAFT_FIELDS em sessionStorage.
- **Bloqueios:** Nenhum.

---

### `preenchimento`
- **Descrição:** Formulário sendo preenchido ativamente.
- **Entrada:** Qualquer mudança de campo; ou retorno de `validacao` por bloqueio.
- **Saída:** Clique em "Visualizar Guias" → `validacao`.
- **Quem pode alterar:** Médico / secretária.
- **Log mínimo:** `naLog('field_change', {campo, convenio})`.
- **Bloqueios:** Nenhum — formulário sempre editável.

---

### `validacao`
- **Descrição:** Engine de compliance avalia o payload.
- **Entrada:** `openPreview()` ou `confirmedSend()`.
- **Saída:**
  - Com bloqueios → retorna a `preenchimento` com bloqueios listados.
  - Sem bloqueios → `pronto_para_envio`.
- **Quem executa:** `naRunCompliance()` no frontend (local, sem rede).
- **Log:** `naLog('compliance_run', {blocks_count, warnings_count, convenio})`.
- **Dados:** `__NA_STATE__` atualizado com `{can_print, blocks_count, compliance}`.

---

### `pronto_para_envio`
- **Descrição:** Preview aberto, compliance passou, usuário decide enviar.
- **Entrada:** `naRunCompliance()` retornou `can_print: true`.
- **Saída:** Clique em "Confirmar Envio" → `enviado_make`.
- **Quem pode confirmar:** Médico (perfil_acesso: medico ou cirurgiao).
- **Bloqueios:** Limite de guias do plano; sessão expirada.
- **Log:** `naLog('preview_opened', {proc_id, convenio})`.

---

### `enviado_make`
- **Descrição:** Payload foi enviado ao Make.com e confirmado (HTTP 200).
- **Entrada:** `confirmedSend()` recebe resposta 200 do webhook.
- **Saída:** Make.com processa e chama API → `documento_gerado`.
- **Dados registrados:** `envioConfirmadoEm`, `envioUserEmail`.
- **Idempotência:** `session_token` no payload previne duplo envio.
- **Log:** `naLog('send_ok', {ts, convenio})`.
- **Erro → permanece em `pronto_para_envio`** com mensagem de erro.

---

### `documento_gerado`
- **Descrição:** PDFs gerados pela FastAPI e salvos no Drive.
- **Entrada:** Make.com completa cenário de geração de documentos.
- **Saída:** Make.com envia documentos ao convênio → `pendente_autorizacao`.
- **Dados:** URLs dos PDFs no Drive; ID do episódio no Sheets.
- **Notificação:** Email/WhatsApp para médico com links dos documentos.
- **Log:** Registrado no Google Sheets (episódio).

---

### `pendente_autorizacao`
- **Descrição:** Documentos entregues ao convênio. Aguardando resposta.
- **Prazo:** Convênio tem 72h (eletivo) ou 2h (urgência) para responder.
- **Dados novos neste estado:** `_pos_autorizacao{}` permanece vazio.
- **Quem monitora:** Make.com pode verificar portal do convênio (futuro).

---

### `autorizado`
- **Descrição:** Convênio liberou a autorização.
- **Entrada:** Senha de autorização recebida.
- **Dados preenchidos:** `senha_autorizacao`, `data_autorizacao`, `validade_autorizacao`, procedimentos autorizados.
- **Saída:** `faturado`.
- **Notificação:** Médico / secretária notificados.

---

### `negado`
- **Descrição:** Convênio negou a autorização.
- **Dados:** `codigo_glosa`, `motivo_glosa`.
- **Saída:**
  - Médico aceita → `arquivado`.
  - Médico recorre → `em_recurso`.
  - Médico corrige e reenvia → `pendente_reenvio`.
- **Notificação:** Alerta ao médico com motivo da glosa.

---

### `pendente_reenvio`
- **Descrição:** Guia negada, médico está corrigindo para reenvio.
- **Nota:** Nova versão da guia (`versao_guia` incrementa).
- **Saída:** Nova submissão → `enviado_make`.

---

### `em_recurso`
- **Descrição:** Médico abriu recurso administrativo no convênio.
- **Prazo:** Variável por convênio.
- **Saída:** `autorizado` ou `arquivado` (recurso indeferido).

---

### `faturado`
- **Descrição:** Serviço prestado; billing registrado no BillingBridge.
- **Entrada:** Autorização confirmada + procedimento realizado.
- **Dados:** `billing_id`, `amount_brl`, `billing_status`.
- **Saída:** `arquivado`.

---

### `arquivado`
- **Descrição:** Guia finalizada. Histórico imutável.
- **Regra de ouro:** Guia arquivada nunca é deletada. Apenas marcada como arquivada.
- **Acesso:** Disponível para consulta histórica indefinidamente.

---

## 3. TRANSIÇÕES E EVENTOS

| De | Para | Evento | Quem dispara |
|---|---|---|---|
| `rascunho` | `preenchimento` | Campo alterado | Frontend |
| `preenchimento` | `validacao` | openPreview() / confirmedSend() | Usuário |
| `validacao` | `preenchimento` | Bloqueios encontrados | Engine |
| `validacao` | `pronto_para_envio` | can_print = true | Engine |
| `pronto_para_envio` | `enviado_make` | Clique em confirmar + HTTP 200 | Usuário + webhook |
| `enviado_make` | `documento_gerado` | Make.com completa cenário | Make.com |
| `documento_gerado` | `pendente_autorizacao` | Documentos enviados ao convênio | Make.com |
| `pendente_autorizacao` | `autorizado` | Senha recebida | Operador / Make.com |
| `pendente_autorizacao` | `negado` | Código de glosa recebido | Operador / Make.com |
| `pendente_autorizacao` | `pendente_reenvio` | Usuário decide corrigir | Usuário |
| `negado` | `em_recurso` | Usuário abre recurso | Usuário |
| `negado` | `pendente_reenvio` | Usuário corrige | Usuário |
| `autorizado` | `faturado` | BillingBridge.finalizeGuide() | Sistema |
| `faturado` | `arquivado` | Período de retenção ativo | Sistema (automático) |
| `em_recurso` | `autorizado` | Recurso deferido | Operador |
| `em_recurso` | `arquivado` | Recurso indeferido | Operador |

---

## 4. LOGS MÍNIMOS POR ESTADO

```javascript
const STATE_LOGS = {
  rascunho:             { event: 'guia_criada',           dados: ['convenio', 'tipo_guia'] },
  preenchimento:        { event: 'field_changed',          dados: ['campo', 'convenio'] },
  validacao:            { event: 'compliance_run',         dados: ['blocks_count', 'warnings_count'] },
  pronto_para_envio:    { event: 'preview_opened',         dados: ['proc_id', 'convenio'] },
  enviado_make:         { event: 'send_ok',                dados: ['ts', 'convenio'] },
  documento_gerado:     { event: 'document_generated',     dados: ['case_id', 'pdfs_gerados'] },
  pendente_autorizacao: { event: 'awaiting_authorization', dados: ['case_id', 'convenio'] },
  autorizado:           { event: 'authorized',             dados: ['case_id', 'senha_hash'] },
  negado:               { event: 'denied',                 dados: ['case_id', 'cod_glosa'] },
  faturado:             { event: 'billed',                 dados: ['case_id', 'billing_id', 'sku'] },
  arquivado:            { event: 'archived',               dados: ['case_id'] }
};
```

---

## 5. ESTADO ATUAL DE IMPLEMENTAÇÃO

| Estado | Implementado | Onde |
|---|---|---|
| rascunho | ✅ Implícito | `index.html` — formulário vazio |
| preenchimento | ✅ Implícito | `index.html` — dirty flag |
| validacao | ✅ Funcional | `naRunCompliance()` |
| pronto_para_envio | ✅ Funcional | `can_print = true` no compliance |
| enviado_make | ✅ Funcional | `confirmedSend()` → HTTP 200 |
| documento_gerado | ✅ Funcional | Make.com → Drive + Sheets |
| pendente_autorizacao | ⚠️ Implícito | Não rastreado no sistema |
| autorizado | ⚠️ Manual | Operador digita senha manualmente |
| negado | ⚠️ Ausente | Não há tratamento de glosa |
| pendente_reenvio | ⚠️ Ausente | — |
| em_recurso | ⚠️ Ausente | — |
| faturado | ⚠️ Parcial | BillingBridge em memória |
| arquivado | ⚠️ Parcial | Episódio no Sheets mas sem estado formal |

**A máquina de estados existe hoje de forma implícita. A Fase 2 a torna explícita e persistida.**
