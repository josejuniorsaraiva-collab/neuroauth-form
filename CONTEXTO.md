# NEUROAUTH — CONTEXTO OPERACIONAL (v3.0.0)

---

## 1. VISÃO GERAL

O NEUROAUTH é um sistema de autorização cirúrgica neuroassistida com foco em:

- geração de guias (SADT / OPME)
- prevenção de glosas
- padronização técnica
- automação de faturamento

**Arquitetura atual:**

```
Frontend (index.html) → coleta + validação + render
Make.com             → processamento + regras + billing
Google Sheets        → base de dados + logs + regras
```

O sistema está em fase **alpha** (3–5 médicos).

---

## 2. ESTADO ATUAL DO FRONTEND

**Versão canônica:**
```javascript
__NA_VERSION__ = '3.0.0'
```

### HARDENING IMPLEMENTADO (CICLOS 1–4)

| # | O que foi feito | Como identificar no código |
|---|-----------------|---------------------------|
| ✅ | SSoT global de estado | `window.__NA_STATE__ = { payload, compliance, ts, dirty }` |
| ✅ | Single collect() no fluxo de envio | topo de `confirmedSend()` |
| ✅ | Debounce 450ms em inputs / change imediato | `naAttachLiveValidation()` |
| ✅ | Guard contra listeners duplicados | `window.__NA_VALIDATION_ATTACHED__` |
| ✅ | Lock de envio + watchdog 15s | `window.__NA_SENDING__` + `clearTimeout` no `finally` |
| ✅ | Função pura de prep PDF | `naBuildPrintData(payload)` |
| ✅ | Logger estruturado | `naLog(event, data)` com 7 eventos mapeados |
| ✅ | Dev bypass ativo | `josejuniorsaraiva@gmail.com` em `naFetchPerfil()` |
| ✅ | Versão unificada | `neuroauth_version: __NA_VERSION__` nos dois payloads |

---

## 3. FLUXO ATUAL

```
Preview:  collect() → naRunCompliance() → render HTML
Envio:    collect() único → gate SSoT → webhook Make.com
Print:    baseado no DOM (independente do payload)
```

---

## 4. LIMITAÇÕES CONHECIDAS

1. **Preview ≠ Payload ≠ Print** — três fluxos independentes, sidebar enrichment só entra no envio
2. **Webhook externo obrigatório** — qualquer email fora do bypass depende do Make.com ativo
3. **Idempotência baseada em timestamp** — suficiente para alpha, insuficiente para escala
4. **Print via DOM** — não derivado do payload, pode divergir em edge cases

---

## 5. RISCOS CONTROLADOS

| Risco | Solução |
|-------|---------|
| Duplo envio | Lock `__NA_SENDING__` |
| Spam de validação | Debounce 450ms |
| Memory leak de listeners | Guard `__NA_VALIDATION_ATTACHED__` |
| Estado inconsistente entre preview e envio | SSoT `__NA_STATE__` com flag `dirty` |
| Envio travado sem recovery | Watchdog 15s + `finally` release |

---

## 6. PRÓXIMOS PASSOS PRIORITÁRIOS

### Nível 1 — Produção alpha
- Reativar webhook Make.com
- Criar whitelist de emails autorizados
- Remover ou condicionar dev bypass

### Nível 2 — Consistência de dados
- Unificar preview + payload (usar `naBuildPrintData`)
- Tornar print derivado do payload (não do DOM)

### Nível 3 — Robustez
- Introduzir `request_id` persistente (UUID por guia)
- Retry controlado com deduplicação server-side
- Audit trail estruturado no Sheets

### Nível 4 — Produto
- Billing automático por guia gerada
- Controle de uso por médico
- Dashboard de ROI

---

## 7. DECISÕES ARQUITETURAIS IMPORTANTES

- Frontend **não contém regras críticas** — delegado ao Make.com
- Google Sheets é a fonte de verdade de regras e dados
- HTML é stateless entre envios (exceto SSoT runtime `__NA_STATE__`)
- `NEUROAUTH_COMPLIANCE.VERSION` ('1.0.1') versiona o engine de conformidade independentemente da aplicação — correto por design
- Print separado intencionalmente: visual (DOM) vs estrutural (payload)

---

## 8. COMO RETOMAR O PROJETO EM QUALQUER SESSÃO

1. Abrir `index.html`
2. Buscar: `__NA_STATE__`, `confirmedSend`, `naRunCompliance`
3. Validar fluxo: `collect → compliance → send`
4. Testar login com `josejuniorsaraiva@gmail.com` (dev bypass)
5. Consultar `HARDENING_DELTA_LOG.md` para histórico completo de mudanças

---

## 9. STATUS ATUAL

```
✅ Hardening estrutural concluído (Ciclos 1–4)
✅ 299 assertions verdes (5 suites)
✅ Mental test 5/5 cenários
✅ Deploy em produção (GitHub Pages)
✅ Versão canônica: 3.0.0
```

**Sistema saiu de "protótipo inteligente" → "operação controlada alpha".**

O próximo salto não é código — é transformar isso em produto fechado com billing e controle de acesso.
