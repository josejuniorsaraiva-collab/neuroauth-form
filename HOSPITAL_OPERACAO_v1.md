# HOSPITAL_OPERACAO_v1
**Sistema:** NEUROAUTH | **Data:** 2026-03-27
**Escopo:** O que muda por hospital, o que muda só por convênio, onde cada lógica deve morar

---

## 1. O HOSPITAL COMO ENTIDADE

Hospital não é um campo de texto. É uma entidade com estado próprio:
- Tem CNES (obrigatório em documentos TISS)
- Tem convênios credenciados (filtra o select de convênio no formulário)
- Tem médicos habilitados (filtra quem pode operar aqui)
- Tem fluxo interno de autorização (prazos, contatos, triagem)
- Tem padrão de acomodação (preenche o campo default na guia)

### O que o sistema faz hoje

O hospital é um `<input type="text">` sem validação ou estrutura. O médico digita o nome livremente. Isso significa:
- "Hospital Santo Antônio" e "H. Santo Antônio — Barbalha" são entidades diferentes para o sistema
- O CNES nunca é preenchido automaticamente
- Não existe filtro de convênios por hospital
- Não há como saber quais médicos operam em qual hospital

---

## 2. O QUE MUDA POR HOSPITAL

### 2.1 Convênios disponíveis
O formulário deve mostrar apenas os convênios em que o hospital é credenciado.
```
Hospital A credenciado: Unimed, Bradesco
Hospital B credenciado: Unimed, SulAmérica, Amil
→ Select de convênio muda conforme o hospital selecionado
```

### 2.2 Padrões de preenchimento
| Campo | Hospital A | Hospital B |
|---|---|---|
| Acomodação padrão | Apartamento | Enfermaria |
| Regime | Internação | Hospital-dia |
| CNES | 2517753 | 3987654 |
| Endereço na guia | Rua X, 100 — Barbalha | Av. Y, 200 — Juazeiro |

### 2.3 Fluxo interno de autorização
Alguns hospitais têm central de autorizações própria — o médico entrega a guia para o hospital que encaminha ao convênio. Outros, o médico envia diretamente.

### 2.4 Exigências documentais adicionais
- Hospital A exige laudo assinado além da guia digital
- Hospital B exige pré-internação (consulta prévia)
- Hospital C aceita somente envio pelo portal do convênio

---

## 3. O QUE MUDA SÓ POR CONVÊNIO (não por hospital)

- Template PDF do formulário
- Campos obrigatórios por tipo de guia
- Tabela de codificação (TUSS, CBHPM)
- Prazo legal de resposta do convênio
- Canal de envio (portal web, API, Make.com)
- Regras anti-glosa

---

## 4. O QUE DEPENDE DA COMBINAÇÃO HOSPITAL + CONVÊNIO

Esta é a lógica mais complexa e a que mais causa erros hoje. A combinação gera regras específicas:

| Hospital | Convênio | Regra específica |
|---|---|---|
| HSA Barbalha | Unimed CE | Guia OPME precisa de cotação em formulário próprio do hospital |
| Coração do Cariri | Bradesco | Médico deve incluir telefone da central de autorizações do hospital |
| HSA Barbalha | SulAmérica | OPME com valor > R$5.000 exige 2ª assinatura do diretor médico |

### Onde essa lógica deve morar
```
schemas/compliance/REGRAS_COMPLIANCE_SCHEMA_v1.json

{
  "id_regra": "R-HSA-UNIMED-001",
  "tipo": "campo_adicional",
  "hospital": "hosp_santo_antonio_barbalha",
  "convenio": "unimed_ce",
  "tipo_guia": "opme",
  "campo": "cotacao_hospital_proprio",
  "bloqueante": false,
  "mensagem": "HSA Barbalha exige formulário de cotação próprio para OPME."
}
```

**Regra de ouro:** A lógica `hospital × convênio` mora no schema de regras, não no código do formulário.

---

## 5. ONDE CADA COISA DEVE MORAR

| Lógica | Local |
|---|---|
| CNES do hospital | `schemas/hospitais/<id>.json::identificacao.cnes` |
| Convênios disponíveis | `schemas/hospitais/<id>.json::convenios_ativos[]` |
| Acomodação padrão | `schemas/hospitais/<id>.json::padrao_documentacao.padrao_acomodacao` |
| Fluxo de autorização | `schemas/hospitais/<id>.json::fluxo_interno_autorizacao` |
| Regras hospital × convênio | `schemas/compliance/REGRAS_COMPLIANCE_SCHEMA_v1.json` |
| Preenchimento automático no form | `index.html` carrega do schema ao selecionar hospital |

---

## 6. ROTEIRO DE IMPLANTAÇÃO

### Fase atual (alpha)
O hospital é digitado manualmente. CNES não é preenchido automaticamente.
Funciona para o MVP.

### Fase 2 (escala)
1. Criar `schemas/hospitais/hosp_santo_antonio_barbalha.json`
2. API endpoint `GET /hospitais` retorna lista de hospitais para o `<select>`
3. Ao selecionar hospital, `<select>` de convênio filtra por `convenios_ativos[]`
4. Campos como CNES, endereço, acomodação padrão são preenchidos automaticamente
5. Make.com recebe `id_hospital` em vez de string livre

### Fase 3 (multi-tenant)
Cada clínica/secretaria vê apenas seus hospitais habilitados.

---

## 7. INVENTÁRIO DE HOSPITAIS — STATUS

| Hospital | id_hospital | Schema | CNES | Convênios mapeados |
|---|---|---|---|---|
| Hospital Santo Antônio — Barbalha | hosp_santo_antonio_barbalha | ⏳ Pendente | 2517753 | Unimed CE |
| Hospital do Coração do Cariri | hosp_coracao_cariri | ⏳ Pendente | a definir | Unimed CE, SulAmérica |
| Hospital Regional do Cariri | hosp_regional_cariri | ⏳ Pendente | a definir | Unimed CE |
