# CONVENIO_MAPEAMENTO_v1
**Sistema:** NEUROAUTH | **Data:** 2026-03-27
**Escopo:** O que varia por convênio, o que é comum, o que não deve ficar hardcoded

---

## 1. O PROBLEMA ATUAL

O frontend trata convênio como uma string em um `<select>`:
```html
<option value="Unimed">Unimed Ceará</option>
```

E as regras vivem embutidas no código:
```javascript
const CONVENIO_RULES = {
  'unimed': { required_fields: [...], ... },
  'bradesco': { ... }
}
```

Isso funciona para 1 convênio. Quebra com 5. Impossível com 20.

---

## 2. O QUE VARIA POR CONVÊNIO

Cada convênio é uma entidade com comportamento próprio. O que muda:

### 2.1 Documentos exigidos
| Convênio | SADT | OPME | Internação | Resumo | Anexo |
|---|---|---|---|---|---|
| Unimed CE | ✅ | ✅ | ✅ | ❌ | ❌ |
| Bradesco Saúde | ✅ | ✅ | ✅ | ✅ | ❌ |
| SulAmérica | ✅ | ✅ | ✅ | ❌ | ✅ |
| Amil | ✅ | ✅ | ✅ | ❌ | ❌ |
| Particular | ❌ | ❌ | ❌ | ✅ | ❌ |

### 2.2 Campos obrigatórios por tipo de guia
Cada convênio pode exigir campos além do padrão TISS. Exemplos reais:
- Bradesco exige **descrição detalhada do material OPME** (campo livre além do código ANVISA)
- SulAmérica exige **relatório de tentativa conservadora** com data de início
- Amil exige **número de autorização prévia** mesmo para cirurgias eletivas de alto custo

### 2.3 Tabela de codificação preferencial
- Unimed: TUSS + CBHPM aceitos
- Bradesco: só TUSS
- Particular: livre (sem tabela)

### 2.4 Layout e template do documento
- Cada convênio tem seu próprio formulário PDF (coordenadas diferentes)
- Motor de preenchimento Python é específico por convênio × tipo de guia
- Orientação pode variar (SADT Unimed = landscape; outros podem ser portrait)

### 2.5 Canal de envio
- Unimed CE: portal + Make.com webhook
- Bradesco: API própria (TISS 3.x)
- Particular: só PDF para impressão/email

### 2.6 Regras anti-glosa
Cada convênio tem seus padrões específicos de recusa. Exemplos:
- Unimed: "indicação clínica deve mencionar falha do tratamento conservador"
- Bradesco: "CID secundário obrigatório para procedimentos ortopédicos"
- SulAmérica: "OPME precisa de 3 cotações para valor > R$10.000"

### 2.7 Prazo e comportamento pós-autorização
- Unimed: 72h para resposta
- Urgência/Emergência: qualquer convênio, 2h por lei
- Formato da senha de autorização varia

---

## 3. O QUE É COMUM A TODOS OS CONVÊNIOS

Não deve ser duplicado em cada implementação — mora no schema mestre:

- Estrutura básica do paciente (nome, CNS, carteirinha, data nascimento)
- Dados do médico solicitante (CRM, CBO, nome)
- Dados do hospital (CNES, nome, endereço)
- Estrutura de procedimentos (código, descrição, quantidade)
- Estrutura de CIDs (principal + secundários)
- Campos pós-autorização (senha, data, validade)
- Data de solicitação, caráter de atendimento
- Assinatura e carimbo do médico

---

## 4. O QUE NÃO DEVE FICAR HARDCODED NO FRONTEND

### Atualmente hardcoded — deve ser externalizado

| O que está hardcoded | Onde está | Onde deve ir |
|---|---|---|
| `registro_ans` por convênio | `index.html::ANS_MAP{}` | `schemas/convenios/<id>.json` |
| Regras TISS por convênio | `neuroauth_compliance_engine.js::CONVENIO_RULES` | `schemas/compliance/REGRAS_COMPLIANCE_SCHEMA_v1.json` |
| Lista de convênios no `<select>` | `index.html` (HTML hardcoded) | Carregada dinamicamente de `schemas/convenios/` |
| Nome do motor PDF por convênio | `api/app.py` (import hardcoded) | Lookup em `schemas/convenios/<id>.json::templates.motor_sadt` |
| Campos obrigatórios por convênio | `neuroauth_compliance_engine.js` | `schemas/convenios/<id>.json::campos_obrigatorios_por_tipo_guia` |

### O que pode continuar no frontend por enquanto (alpha)
- Lógica de UI (tabs, preview, print)
- `collect()` — coleta de campos
- `buildInternacaoVars()` — mapeamento de variáveis

---

## 5. MODELO DE EXPANSÃO — ADICIONAR BRADESCO SAÚDE

```
Passo 1: Criar schemas/convenios/bradesco_saude.json
  → copiar estrutura de unimed_ce.json
  → ajustar registro_ans, templates, campos_obrigatorios

Passo 2: Obter formulário PDF do Bradesco
  → extrair coordenadas com pdfplumber
  → criar fill_bradesco_sadt_v1.py

Passo 3: Adicionar template em TEMPLATES_OFICIAIS/
  → blank_bradesco_sadt_template.pdf

Passo 4: Registrar endpoint na api/app.py
  → POST /gerar_bradesco_sadt

Passo 5: Adicionar regras anti-glosa em schemas/compliance/
  → regras específicas do Bradesco

Passo 6: Adicionar <option> no frontend (temporário) ou
  → carregar opções dinamicamente de /api/convenios
```

**Tempo estimado para um novo convênio com formulário disponível: 1 dia de trabalho.**

---

## 6. INVENTÁRIO DE CONVÊNIOS — STATUS

| Convênio | id_convenio | Schema | Motor SADT | Motor OPME | Motor Internação |
|---|---|---|---|---|---|
| Unimed Ceará | unimed_ce | ✅ Criado | ✅ v2 | ✅ v2 | ✅ v1 |
| Bradesco Saúde | bradesco_saude | ⏳ Pendente | ⏳ | ⏳ | ⏳ |
| SulAmérica | sulamerica | ⏳ Pendente | ⏳ | ⏳ | ⏳ |
| Amil | amil | ⏳ Pendente | ⏳ | ⏳ | ⏳ |
| Hapvida | hapvida | ⏳ Pendente | ⏳ | ⏳ | ⏳ |
| Particular | particular | ⏳ Pendente | N/A | N/A | N/A |
