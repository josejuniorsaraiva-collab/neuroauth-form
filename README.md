# NEUROAUTH — Plataforma de Autorização Médica

NEUROAUTH é uma plataforma web de preenchimento, validação e envio de guias médicas para convênios de saúde, com foco em neurorradiologia e procedimentos de alta complexidade.

---

## Fluxo Principal

```
Form → Controller → Compliance → Render → Make → Sheets → Billing
```

| Etapa | Responsável | Descrição |
|---|---|---|
| **Form** | `index.html` | Interface de coleta de dados clínicos e administrativos |
| **Controller** | `index.html` (JS interno) | Orquestra coleta, validação e envio |
| **Compliance** | `neuroauth_access_policy.js` | Avalia regras por convênio, hospital e procedimento |
| **Render** | FastAPI (`fill_engine.py`) | Preenche PDFs com coordenadas pdfplumber → reportlab |
| **Make** | Webhook Make.com | Recebe payload, valida `id_token`, aciona automações |
| **Sheets** | Google Sheets (via Make) | Registra guias, status e histórico |
| **Billing** | `neuroauth_access_policy.js` | Aplica regras de faturamento por tier e convênio |

---

## Estrutura de Pastas

```
neuroauth-form/
├── index.html                  ← Frontend principal (GitHub Pages)
├── manifest.json               ← PWA manifest
├── sw.js                       ← Service Worker
├── icon-192.png                ← Ícone PWA
├── icon-512.png                ← Ícone PWA
├── neuroauth_access_policy.js  ← Engine de compliance e billing
├── README.md                   ← Este arquivo
│
├── docs/                       ← Documentação técnica e clínica
├── data/                       ← Planilhas de referência e dados estáticos
│
└── src/                        ← Código fonte modular (migração progressiva)
    ├── core/                   ← Lógica central: coletor, estado, sessão
    ├── modules/                ← Módulos de domínio: convênio, hospital, médico
    ├── services/               ← Integrações externas: Make, FastAPI, Google
    ├── renderers/              ← Geração de PDF e formulários
    ├── policies/               ← Regras de compliance e billing
    └── analytics/              ← Logs, auditoria e métricas
```

---

## Como Rodar Localmente

### Frontend (GitHub Pages / local)

```bash
# Clonar o repositório
git clone https://github.com/SEU_USUARIO/neuroauth-form.git
cd neuroauth-form

# Abrir direto no navegador
open index.html

# OU usar servidor local simples
python3 -m http.server 8080
# Acessar: http://localhost:8080
```

### Backend PDF (FastAPI)

```bash
cd render/
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Endpoints:
- `POST /gerar_sadt` — Gera guia SADT em PDF
- `POST /gerar_opme` — Gera guia OPME em PDF
- `POST /gerar_tudo` — Gera todos os documentos em ZIP

---

## Variáveis de Configuração

As variáveis de ambiente estão definidas no topo do `index.html`:

```javascript
var NA_PROFILE_WH  = 'https://...';   // Webhook Make.com — validação de perfil
var WH             = 'https://...';   // Webhook Make.com — envio de guia
var NA_FASTAPI_URL = 'https://...';   // FastAPI no Render.com
```

---

## Versão Atual

**v3.0-alpha** — plataforma funcional em fase de testes com médicos alpha.

| Item | Status |
|---|---|
| Fluxo principal (SADT + OPME) | ✅ Funcionando |
| Compliance por convênio | ✅ Ativo (Unimed CE) |
| Autenticação Google | ✅ JWT server-side |
| PHI em localStorage | ✅ Removido |
| DEV_BYPASS de produção | ✅ Removido |
| FastAPI (Render.com) | ⏳ Deploy pendente |
| Make.com webhook | ⏳ Reativação pendente |
| Multi-convênio | 🔲 Fase 2 |

---

## Segurança

- Nenhum dado do paciente (CPF, CNS, nome) é gravado em `localStorage`
- Autenticação via Google JWT validado server-side (Make.com)
- Funções críticas bloqueadas com `Object.defineProperty`
- Logs sanitizados — campos PHI nunca aparecem no console

---

## Licença

Projeto proprietário — uso restrito. © 2024–2026 NEUROAUTH.
