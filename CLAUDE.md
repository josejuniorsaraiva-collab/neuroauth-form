# NEUROAUTH — Instruções para o Cowork (Claude Desktop)

## REGRA PRINCIPAL

Quando o usuário disser "faz o deploy", "sobe o index", "publica" ou qualquer variação:

```bash
bash ~/neuroauth-form/deploy.sh
```

Sem perguntar. Sem confirmar. Só executar e reportar o resultado.

---

## CAMINHOS REAIS DO SISTEMA

```
Frontend repo:  ~/neuroauth-form/
Backend repo:   ~/neuroauth/backend/
Deploy script:  ~/neuroauth-form/deploy.sh
Downloads:      ~/Downloads/
```

---

## FLUXO DE DEPLOY (automático)

1. Usuário baixa `index.html` do Claude.ai para `~/Downloads/`
2. Cowork roda: `bash ~/neuroauth-form/deploy.sh`
3. Script valida (Gate C, 7 steps, watermark) e faz push
4. Reportar commit hash + confirmar produção

Se o script não existir:
```bash
cd ~/neuroauth-form && git pull origin main
```

---

## VALIDAÇÃO PÓS-DEPLOY

Após push, verificar em produção:
```javascript
// No console do browser em neuroauth.com.br:
document.querySelectorAll('.step').length // → 7
```

---

## GATES DE SEGURANÇA

| Gate | Status | O que faz |
|------|--------|-----------|
| A | ✅ fechado | JWT real via backend Render |
| B | ✅ fechado | Dados clínicos em sessionStorage volátil |
| C | ✅ fechado | URLs Make.com removidas do frontend |

**Nunca fazer deploy se Gate C estiver aberto** (deploy.sh bloqueia automaticamente).

---

## REPOSITÓRIO

```
GitHub: josejuniorsaraiva-collab/neuroauth-form
Branch: main
Deploy: GitHub Pages → neuroauth.com.br
```

---

## ESTADO ATUAL DO SISTEMA

- Motor v2.0: `/decide` no Render
- Hub: `control_hub.html`
- Formulário principal: `index.html`
- Backend: `~/neuroauth/backend/`

---

## SE ALGO QUEBRAR

```bash
# Ver últimos commits
cd ~/neuroauth-form && git log --oneline -5

# Reverter último commit
git revert HEAD --no-edit && git push origin main

# Forçar versão do remote
git fetch origin && git reset --hard origin/main
```

---

## IMPORTANTE

- Nunca assumir que um arquivo foi deployado sem evidência de push
- Sempre mostrar o commit hash após push bem-sucedido
- Se o deploy.sh falhar na validação, parar e reportar o erro exato
