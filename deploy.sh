#!/bin/bash
set -e
FRONTEND_REPO="$HOME/neuroauth-form"
DOWNLOADS="$HOME/Downloads"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; exit 1; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
info() { echo -e "${BLUE}→ $1${NC}"; }

echo -e "${BLUE}╔═══════════════════════════════════╗${NC}"
echo -e "${BLUE}║   NEUROAUTH — DEPLOY SCRIPT       ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════╝${NC}"

cd "$FRONTEND_REPO" || err "Repo não encontrado: $FRONTEND_REPO"

[ -f "$DOWNLOADS/index.html" ] || err "index.html não encontrado em Downloads"

# Validar Gate C
if grep -q 'hook\.us2\.make\.com' "$DOWNLOADS/index.html"; then
  err "Gate C ABERTO: URL Make.com exposta no index.html — não deployar"
fi
ok "Gate C: sem URLs Make.com expostas"

# Validar 7 steps
steps=$(grep -c 'class="step' "$DOWNLOADS/index.html" || echo 0)
[ "$steps" -ge 7 ] || err "index.html: menos de 7 steps encontrados ($steps)"
ok "7 steps presentes"

grep -q 'naToggleTipoGuia' "$DOWNLOADS/index.html" || err "naToggleTipoGuia ausente"
ok "naToggleTipoGuia presente"

grep -q 'translate(-50%,-50%)' "$DOWNLOADS/index.html" || err "watermark fix ausente"
ok "watermark presente"

# Copiar arquivos
cp "$DOWNLOADS/index.html" ./index.html
ok "index.html copiado"

[ -f "$DOWNLOADS/relay_routes.py" ] && cp "$DOWNLOADS/relay_routes.py" ./relay_routes.py && ok "relay_routes.py copiado"

# Verificar mudanças
if git diff --quiet && git diff --cached --quiet; then
  warn "Sem mudanças detectadas — já está atualizado"
  exit 0
fi

git diff --stat

git add index.html
[ -f relay_routes.py ] && git add relay_routes.py
[ -f deploy.sh ] && git add deploy.sh

git commit -m "deploy: $(date '+%Y-%m-%d %H:%M')"
git push origin main
ok "Push concluído — GitHub Pages atualiza em ~60s"
git log --oneline -1

echo ""
echo -e "${YELLOW}Checklist:${NC}"
echo "  [ ] Abrir neuroauth.com.br + Cmd+Shift+R"
echo "  [ ] Console: document.querySelectorAll('.step').length → 7"
echo "  [ ] Testar tipo_guia Internação/SADT"
