#!/bin/bash
# =============================================================================
# NEUROAUTH — Script de Aplicação da Estrutura de Produto v1
# Roda UMA vez dentro da pasta clonada do repositório neuroauth-form
# =============================================================================

set -e  # Para imediatamente se qualquer comando falhar

echo "🚀 NEUROAUTH — Aplicando estrutura de produto v1..."
echo ""

# Verificar se está dentro do repo correto
if [ ! -f "index.html" ]; then
  echo "❌ ERRO: index.html não encontrado."
  echo "   Execute este script DENTRO da pasta neuroauth-form clonada."
  exit 1
fi

echo "✅ Repositório identificado: $(pwd)"
echo ""

# -----------------------------------------------------------------------------
# 1. Criar estrutura de diretórios
# -----------------------------------------------------------------------------
echo "📁 Criando estrutura de diretórios..."

mkdir -p docs
mkdir -p data
mkdir -p src/core
mkdir -p src/modules
mkdir -p src/services
mkdir -p src/renderers
mkdir -p src/policies
mkdir -p src/analytics

echo "   /docs ✅"
echo "   /data ✅"
echo "   /src/core ✅"
echo "   /src/modules ✅"
echo "   /src/services ✅"
echo "   /src/renderers ✅"
echo "   /src/policies ✅"
echo "   /src/analytics ✅"
echo ""

# -----------------------------------------------------------------------------
# 2. Criar .gitkeep nas pastas src (para o Git rastrear pastas vazias)
# -----------------------------------------------------------------------------
echo "📌 Criando .gitkeep nas pastas src..."

for dir in core modules services renderers policies analytics; do
  if [ ! "$(ls -A src/$dir 2>/dev/null)" ]; then
    touch "src/$dir/.gitkeep"
    echo "   src/$dir/.gitkeep ✅"
  fi
done
echo ""

# -----------------------------------------------------------------------------
# 3. Mover arquivos não-críticos (se existirem na raiz)
# -----------------------------------------------------------------------------
echo "📦 Movendo arquivos não-críticos..."

if [ -f "NEUROAUTH_PlanilhaMae_Convenios_v1.xlsx" ]; then
  mv "NEUROAUTH_PlanilhaMae_Convenios_v1.xlsx" "data/"
  echo "   NEUROAUTH_PlanilhaMae_Convenios_v1.xlsx → /data ✅"
else
  echo "   NEUROAUTH_PlanilhaMae_Convenios_v1.xlsx não encontrado na raiz (ok)"
fi

if [ -f "NEUROAUTH_compliance_prompt_v2.html" ]; then
  mv "NEUROAUTH_compliance_prompt_v2.html" "docs/"
  echo "   NEUROAUTH_compliance_prompt_v2.html → /docs ✅"
else
  echo "   NEUROAUTH_compliance_prompt_v2.html não encontrado na raiz (ok)"
fi

echo ""

# -----------------------------------------------------------------------------
# 4. Copiar README.md e MIGRACAO_ESTRUTURA_v1.md
#    (esses arquivos devem estar na mesma pasta que este script)
# -----------------------------------------------------------------------------
echo "📄 Instalando README.md e MIGRACAO_ESTRUTURA_v1.md..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/README.md" ]; then
  cp "$SCRIPT_DIR/README.md" ./README.md
  echo "   README.md ✅"
else
  echo "   ⚠️  README.md não encontrado junto ao script — pule esta etapa e copie manualmente"
fi

if [ -f "$SCRIPT_DIR/MIGRACAO_ESTRUTURA_v1.md" ]; then
  cp "$SCRIPT_DIR/MIGRACAO_ESTRUTURA_v1.md" ./MIGRACAO_ESTRUTURA_v1.md
  echo "   MIGRACAO_ESTRUTURA_v1.md ✅"
else
  echo "   ⚠️  MIGRACAO_ESTRUTURA_v1.md não encontrado junto ao script — copie manualmente"
fi

echo ""

# -----------------------------------------------------------------------------
# 5. Git — Staging e commit
# -----------------------------------------------------------------------------
echo "🔧 Preparando commit Git..."

git add docs/ data/ src/ README.md MIGRACAO_ESTRUTURA_v1.md 2>/dev/null || true
git add -u 2>/dev/null || true  # rastreia arquivos movidos (git detecta como rename)

echo ""
echo "📋 Status do Git:"
git status --short
echo ""

read -p "Confirmar commit? (s/N): " CONFIRM
if [[ "$CONFIRM" =~ ^[sS]$ ]]; then
  git commit -m "refactor: estrutura de produto inicial + organização modular sem quebrar pages"
  echo ""
  echo "✅ Commit criado com sucesso!"
  echo ""
  echo "Para enviar ao GitHub:"
  echo "   git push origin main"
else
  echo "Commit cancelado. Os arquivos já estão staged — rode manualmente quando quiser:"
  echo "   git commit -m \"refactor: estrutura de produto inicial + organização modular sem quebrar pages\""
fi

echo ""
echo "✅ Estrutura de produto NEUROAUTH v1 aplicada com sucesso!"
echo ""
echo "Próximos passos:"
echo "  1. git push origin main"
echo "  2. Conferir GitHub Pages em https://SEU_USUARIO.github.io/neuroauth-form/"
echo "  3. Reativar webhook Make.com (próxima etapa do roadmap)"
