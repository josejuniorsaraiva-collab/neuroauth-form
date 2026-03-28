# MIGRACAO_ESTRUTURA_v1 — Plano de Reorganização do Repositório NEUROAUTH

**Data:** 2026-03-27
**Versão:** v1.0
**Status:** Fase 1 aplicada ✅

---

## 1. O que ficou na raiz — e por quê

Estes arquivos **permanecem na raiz** indefinidamente nesta fase:

| Arquivo | Motivo |
|---|---|
| `index.html` | GitHub Pages exige `index.html` na raiz (ou `/docs`). Mover quebraria o deploy imediatamente sem reconfiguração de build. |
| `manifest.json` | O Service Worker e o browser buscam o manifest via caminho relativo à raiz. Mover exige atualizar o `<link rel="manifest">` no `index.html` e revalidar o PWA. |
| `sw.js` | O Service Worker só pode controlar páginas no mesmo escopo de registro. O escopo padrão é `/` — mover para subpasta restringe o escopo e quebra o cache offline. |
| `icon-192.png` / `icon-512.png` | Referenciados por caminho relativo no `manifest.json`. Mover exige atualizar o JSON. Baixo risco, mas bundlado com a tarefa de mover o manifest. |
| `neuroauth_access_policy.js` | Importado via `<script src="">` no `index.html`. Mover exige atualizar o path no HTML. Será migrado para `src/policies/` na Fase 2, junto com a refatoração do `index.html`. |
| `CNAME` | Arquivo de domínio customizado do GitHub Pages. Deve sempre ficar na raiz. |

---

## 2. O que foi movido nesta fase (Fase 1)

| Arquivo original | Destino | Motivo |
|---|---|---|
| `NEUROAUTH_PlanilhaMae_Convenios_v1.xlsx` | `/data/` | Dado de referência estático, não é código. Sem impacto em runtime. |
| `NEUROAUTH_compliance_prompt_v2.html` | `/docs/` | Documentação/prompt de contexto, não serve frontend. |

> **Nota:** Nenhum dos arquivos críticos foi removido da raiz. A operação foi de **cópia para novo local** — os originais permanecem intactos até confirmação de funcionamento.

---

## 3. Estrutura atual após Fase 1

```
neuroauth-form/
├── index.html                        ← raiz (GitHub Pages)
├── manifest.json                     ← raiz (PWA)
├── sw.js                             ← raiz (Service Worker)
├── icon-192.png                      ← raiz (PWA asset)
├── icon-512.png                      ← raiz (PWA asset)
├── neuroauth_access_policy.js        ← raiz (importado pelo index.html)
├── README.md                         ← raiz (novo ✅)
│
├── docs/                             ← novo ✅
│   └── NEUROAUTH_compliance_prompt_v2.html
│
├── data/                             ← novo ✅
│   └── NEUROAUTH_PlanilhaMae_Convenios_v1.xlsx
│
└── src/                              ← novo ✅ (vazio, pronto para Fase 2)
    ├── core/
    ├── modules/
    ├── services/
    ├── renderers/
    ├── policies/
    └── analytics/
```

---

## 4. O que poderá ser movido nas próximas fases

### Fase 2 — Extração de módulos do `index.html`

Antes de qualquer movimentação do `index.html`, o código interno precisa ser modularizado:

| O que mover | Para onde | Dependência antes de mover |
|---|---|---|
| `neuroauth_access_policy.js` | `src/policies/neuroauth_access_policy.js` | Atualizar `<script src>` no `index.html` |
| Funções de coleta (`collect()`) | `src/core/collector.js` | Extrair para módulo ES6 ou bundle |
| Funções de estado (`__NA_STATE__`) | `src/core/state.js` | Idem |
| Funções de autenticação (`naHandleLogin`, `naFetchPerfil`) | `src/services/auth.js` | Idem |
| Funções de envio (`confirmedSend`) | `src/services/sender.js` | Idem |
| Engine de compliance (`naRunCompliance`) | `src/policies/compliance_engine.js` | Idem |
| Funções de log (`naLog`, `maskEmail`) | `src/core/logger.js` | Idem |

### Fase 2 — Mover `index.html` para `/src` ou manter na raiz com imports

**Opção A (recomendada):** Manter `index.html` na raiz mas transformar em shell leve que importa módulos ES6 de `/src/`.

**Opção B:** Configurar GitHub Pages para servir da pasta `/docs` em vez da raiz, mover `index.html` para `/docs/`. Requer mudança nas configurações do repo no GitHub (Settings → Pages → Source).

---

## 5. Dependências a ajustar antes de migrar `index.html`

Se o `index.html` for eventualmente movido para `/docs/`:

1. **GitHub Pages:** Mudar source de `/ (root)` para `/docs` em Settings → Pages
2. **manifest.json:** Copiar para `/docs/` também, ou ajustar o `<link>` com path absoluto
3. **sw.js:** Registrar com scope explícito: `navigator.serviceWorker.register('/sw.js', { scope: '/' })`
4. **CNAME:** Permanece na raiz independente de onde o `index.html` estiver
5. **`<script src="neuroauth_access_policy.js">`:** Atualizar para novo path relativo

---

## 6. Critérios de sucesso para avançar para Fase 2

- [ ] Deploy FastAPI no Render.com funcionando (`/gerar_sadt`, `/gerar_opme`, `/gerar_tudo`)
- [ ] Make.com webhook reativado (HTTP 200 em produção)
- [ ] Pelo menos 3 médicos alpha usando o sistema sem erros críticos
- [ ] Testes de regressão: fluxo completo Form → PDF → Make → Sheets validado
- [ ] Decisão tomada sobre Opção A vs Opção B para o `index.html`

---

## 7. Regras imutáveis desta migração

1. **Nunca remover** um arquivo da raiz sem confirmar que o substituto está funcionando em produção
2. **Sempre copiar primeiro**, remover depois (nunca mover direto)
3. **GitHub Pages** é o critério de verdade — se quebrar o deploy, a mudança foi prematura
4. **Cada fase** produz um commit atômico e reversível
5. **PHI nunca entra** em nenhum arquivo de schema, config ou documentação

---

*Documento gerado automaticamente pelo Arquiteto de Estrutura NEUROAUTH — 2026-03-27*
