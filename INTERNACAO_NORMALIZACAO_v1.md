# NEUROAUTH — Regras de Normalização
## Schema Mestre → Schema Achatado · Guia de Internação
**Versão:** 1.0.0 | **Escopo:** Internação Hospitalar Unimed Ceará

---

## Princípio Fundamental

> **O schema mestre é a verdade do sistema.**
> O schema achatado é apenas um derivado operacional gerado sob demanda.
> Nunca persistir o achatado como fonte primária. Nunca editar o achatado diretamente.

---

## Regra 1 — Estrutura Geral

O schema mestre possui 4 raízes:

```
solicitacao          ← o que o médico/secretária preenche
autorizacao_operadora ← o que a operadora devolve
workflow             ← status do processo
meta                 ← metadados do sistema
```

O schema achatado é um objeto de primeiro nível com chaves `snake_case`.
Campos `autorizacao_operadora.*` ficam agrupados em `_pos_autorizacao{}` no achatado
para deixar visível que **não são campos de entrada**.

---

## Regra 2 — Procedimentos Dinâmicos → PROC_NN

O mestre armazena procedimentos como array sem limite:

```json
"procedimentos": [
  { "seq": 1, "tabela": "22", "codigo": "3.01.05.03-9", "descricao": "...", "qtde_solicitada": 1 },
  { "seq": 2, "tabela": "22", "codigo": "3.01.05.10-1", "descricao": "...", "qtde_solicitada": 1 }
]
```

A normalização percorre o array e gera chaves numeradas com padding 2 dígitos:

```
procedimentos[0] → tabela_proc_01, codigo_proc_01, descricao_proc_01, qtde_sol_01, qtde_aut_01
procedimentos[1] → tabela_proc_02, codigo_proc_02, descricao_proc_02, qtde_sol_02, qtde_aut_02
...
procedimentos[N] → tabela_proc_NN, ...
```

**Slots vazios** (do item N+1 até o máximo do PDF) são preenchidos com `""`.

**Pseudocódigo:**

```javascript
const MAX_SLOTS_PDF = 12;  // limite do papel, não regra de negócio
const procs = mestre.solicitacao.procedimentos;

for (let i = 0; i < MAX_SLOTS_PDF; i++) {
  const nn  = String(i + 1).padStart(2, '0');
  const p   = procs[i] || {};
  achatado[`tabela_proc_${nn}`]    = p.tabela    ?? '';
  achatado[`codigo_proc_${nn}`]    = p.codigo    ?? '';
  achatado[`descricao_proc_${nn}`] = p.descricao ?? '';
  achatado[`qtde_sol_${nn}`]       = p.qtde_solicitada
                                       ? String(p.qtde_solicitada).padStart(3, '0')
                                       : '';
  achatado[`qtde_aut_${nn}`]       = p.qtde_autorizada ?? '';
}
```

**Regra de negócio:** se `procedimentos.length > 12`, o sistema deve:
1. Gerar múltiplas páginas da guia (futuro), OU
2. Emitir warning no log e truncar no achatado para Make.com, mantendo todos no mestre.

---

## Regra 3 — CID Dinâmicos → CID_NN

O mestre armazena CIDs como:

```json
"cid": {
  "principal":   "C71.1",
  "secundarios": ["G35", "", ""]
}
```

Normalização:

```
cid.principal      → cid_01
cid.secundarios[0] → cid_02
cid.secundarios[1] → cid_03
cid.secundarios[2] → cid_04
```

**Pseudocódigo:**

```javascript
achatado['cid_01'] = mestre.solicitacao.clinica.cid.principal ?? '';
const sec = mestre.solicitacao.clinica.cid.secundarios ?? [];
achatado['cid_02'] = sec[0] ?? '';
achatado['cid_03'] = sec[1] ?? '';
achatado['cid_04'] = sec[2] ?? '';
```

---

## Regra 4 — Campos Pós-Autorização

Campos em `autorizacao_operadora.*` **não são campos de entrada**.
No schema achatado, ficam dentro do objeto `_pos_autorizacao{}` com valores `""` (vazio).

Eles **nunca devem aparecer** em:
- Formulários de entrada do médico ou secretária
- Validações de campos obrigatórios
- Bloqueios de envio

Eles **devem aparecer** apenas em:
- Tela de acompanhamento pós-envio
- Webhook de resposta da operadora (Make.com → NEUROAUTH)
- Geração do PDF completo para arquivamento final

---

## Regra 5 — Formatação de Datas

| Formato no Mestre | Formato no Achatado | Regra |
|---|---|---|
| `"2026-03-27"` (ISO 8601) | `"27/03/2026"` (DD/MM/YYYY) | Reverter partes com `/` |
| `"2027-12"` (ano-mês) | `"12/2027"` (MM/YYYY) | Reverter mês e ano |
| `"2026-03-27T21:00:00Z"` (ISO com hora) | `"27/03/2026"` | Ignorar hora, formatar data |
| `null` | `""` | Nulo vira string vazia |

**Pseudocódigo:**

```javascript
function fmtData(iso) {
  if (!iso) return '';
  const parts = iso.split('T')[0].split('-');  // ["2026","03","27"]
  return parts.reverse().join('/');             // "27/03/2026"
}
```

---

## Regra 6 — Booleanos → Códigos TISS

| Campo no Mestre | Valor booleano | Valor no Achatado |
|---|---|---|
| `previsao_opme` | `true` | `"S"` |
| `previsao_opme` | `false` | `"N"` |
| `previsao_quimioterapico` | `true` | `"S"` |
| `previsao_quimioterapico` | `false` | `"N"` |
| `atendimento_rn` | `true` | `"S"` |
| `atendimento_rn` | `false` | `"N"` |
| `indicacao_acidente` | `true` | `"S"` |
| `indicacao_acidente` | `false` | `"N"` |

---

## Regra 7 — Campos Derivados Automáticos

Estes campos não são digitados — são calculados no momento da normalização:

| Campo Achatado | Fonte no Mestre | Lógica |
|---|---|---|
| `registro_ans` | `meta.convenio_slug` → perfil | Lookup tabela ANS por convenio |
| `data_solicitacao` | `solicitacao.identificacao_guia.data_solicitacao` | Fallback: `new Date()` formatada |
| `data_sugerida_internacao` | `solicitacao.hospital.data_sugerida` | Fallback: `solicitacao.clinica.data_cirurgia` |
| `previsao_opme` | `solicitacao.opme.necessita` | `true → "S"`, `false → "N"` |
| `observacao_justificativa` | `solicitacao.clinica.*` + `solicitacao.observacao` | `buildObs()`: concatena tto_conservador + déficit + achados + observacao |
| `carater_atendimento` | `solicitacao.parametros_internacao.carater_atendimento.codigo` | Já é código ("1","2","3") |
| `qtde_diarias_solicitadas` | `solicitacao.parametros_internacao.qtde_diarias_solicitadas` | `padStart(3, '0')` → `"005"` |

---

## Regra 8 — O Limite de 12 Linhas é Restrição do Papel

O PDF da Guia de Internação tem 12 linhas de procedimento.
**Isso é uma limitação física do formulário impresso, não uma regra de negócio.**

Implicações:
- O schema mestre **não tem limite** no array `procedimentos[]`
- O schema achatado respeita o limite de 12 apenas para geração do PDF e Make.com
- Se um caso tiver 15 procedimentos, o mestre armazena todos os 15
- O gerador de PDF usa os primeiros 12 e registra warning no log
- Versão futura: geração de segunda página ou guia complementar

---

## Fluxo Completo de Normalização

```
[Formulário index.html]
        ↓  collect()
[Objeto JavaScript bruto]
        ↓  buildInternacaoVars(d)
[Schema Achatado Parcial] ──────────────────→ [API /gerar_internacao]
        ↓  enrichFromMestre()                        ↓
[Schema Mestre Completo]              [fill_unimed_internacao_v1.py]
        ↓  persistir no sistema                      ↓
[Banco / Google Sheets]              [PDF gerado sobre template oficial]
        ↓
[Make.com webhook payload]
= Schema Achatado + _pos_autorizacao vazio
        ↓  (após resposta da operadora)
[_pos_autorizacao preenchido]
        ↓  merge no schema mestre
[Schema Mestre Atualizado com autorização]
        ↓  re-normalizar
[Schema Achatado Final completo]
        ↓
[PDF arquivamento / Drive]
```
