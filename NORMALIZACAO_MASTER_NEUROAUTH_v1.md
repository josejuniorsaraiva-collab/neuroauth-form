# NORMALIZACAO_MASTER_NEUROAUTH_v1
**Sistema:** NEUROAUTH | **Data:** 2026-03-27
**Escopo:** Pipeline completo de normalização de dados — do formulário ao PDF/Make/log

---

## 1. VISÃO GERAL DO PIPELINE

```
FORMULÁRIO HTML
      │ collect() — extrai campos do DOM
      ▼
PAYLOAD FLAT (bruto)
      │ normalização estrutural
      ▼
SCHEMA MESTRE (nested, sem limite)
      │ normalização operacional
      ▼
SCHEMA ACHATADO (flat, slots fixos)
      │
      ├──▶ PDF Engine (fill_*.py)
      ├──▶ Make.com webhook
      ├──▶ Google Sheets / log
      └──▶ Preview HTML
```

---

## 2. ETAPA 1 — FORMULÁRIO → COLETA (collect)

`collect()` é a função que lê todos os campos do DOM e retorna um objeto flat.

### Regras de coleta
- Todos os campos são strings ou null (nunca undefined)
- Arrays de procedimentos e OPME são coletados como objetos antes da flatten
- Campos de data são mantidos no formato `YYYY-MM-DD` (ISO) durante coleta
- Checkboxes viram `"Sim"/"Não"` (string, não boolean)
- Campos vazios viram `""` (string vazia), nunca null

### Estrutura de saída do collect()
```javascript
{
  // ─── Paciente ───
  nome_paciente:    "Dr. Nome do Paciente",
  data_nascimento:  "1972-05-18",   // ISO internamente
  sexo:             "Masculino",
  cpf:              "000.000.000-00",  // NUNCA gravado em storage
  cns:              "700 1234 5678 90", // NUNCA gravado em storage
  numero_carteira:  "123456789",

  // ─── Convênio ───
  convenio:         "Unimed",
  registro_ans:     "303860",

  // ─── Médico ───
  medico_solicitante: "Dr. José Correia Jr.",
  crm:              "CRM/CE 18227",
  cbo:              "225118",

  // ─── Hospital ───
  hospital:         "Hospital Santo Antônio — Barbalha",

  // ─── Clínico ───
  carater:          "E",  // E=eletivo, U=urgência
  cid_principal:    "M51.1",
  indicacao_clinica:"Texto clínico...",
  procedimento:     "Microdiscectomia lombar",
  cod_tuss:         "31009030",
  cod_cbhpm:        "5.07.23.44-8",

  // ─── OPME ───
  necessita_opme:   "Sim",
  opme_items: [
    { descricao:"...", fabricante:"...", qtd:1, anvisa:"...", valor_unitario:0 }
  ],

  // ─── Internação (novos campos) ───
  tipo_internacao:           "2",
  qtde_diarias_solicitadas:  "5",
  regime_internacao:         "1",
  previsao_opme:             "S",
  previsao_quimioterapico:   "N"
}
```

---

## 3. ETAPA 2 — PAYLOAD FLAT → SCHEMA MESTRE

O schema mestre é um objeto nested bem-tipado. A normalização estrutural:

### 3.1 Montar o contexto
```javascript
function buildContexto(d, perfil) {
  return {
    convenio: {
      id_convenio:  normalizeConvenioId(d.convenio),   // "Unimed" → "unimed_ce"
      nome_exibicao: d.convenio,
      registro_ans: d.registro_ans || ANS_MAP[d.convenio]
    },
    hospital: {
      id_hospital:  normalizeHospitalId(d.hospital),   // texto → slug
      nome_hospital: d.hospital,
      cnes: CNES_MAP[d.hospital] || ''                 // futuro: lookup automático
    },
    medico_solicitante: {
      nome:       d.medico_solicitante,
      crm:        d.crm,
      crm_numero: (d.crm || '').replace(/[^\d]/g, ''),
      uf_crm:     (d.crm || '').match(/\/([A-Z]{2})/)?.[1] || 'CE',
      cbo:        d.cbo
    }
  };
}
```

### 3.2 Montar procedimentos como array
```javascript
function buildProcedimentos(d) {
  // Coleta as linhas de procedimento do formulário
  const rows = [];
  if (d.procedimento) {
    rows.push({
      ordem: 1,
      tabela: d.cod_tuss ? 'TUSS' : 'CBHPM',
      codigo: d.cod_tuss || d.cod_cbhpm || '',
      descricao: d.procedimento,
      quantidade_solicitada: parseInt(d.qtd_proc || '1'),
      lateralidade: d.lateralidade || 'N/A',
      via_acesso: d.via_acesso || ''
    });
  }
  // Adicionar procedimentos extras (proc_2, proc_3...)
  for (let i = 2; i <= 12; i++) {
    if (d[`procedimento_${i}`]) {
      rows.push({ ordem: i, descricao: d[`procedimento_${i}`], ... });
    }
  }
  return rows;
}
```

### 3.3 Montar CIDs como array
```javascript
function buildCids(d) {
  return [
    d.cid_principal,
    d.cid2 || '',
    d.cid3 || '',
    d.cid4 || ''
  ]
  .filter(c => c && c.trim())
  .map((codigo, idx) => ({
    ordem: idx + 1,
    codigo: codigo.trim().toUpperCase()
  }));
}
```

---

## 4. ETAPA 3 — SCHEMA MESTRE → SCHEMA ACHATADO

O schema achatado é a "representação operacional" — pronta para PDF e Make.com.

### Regra 1: Array dinâmico → slots fixos

```javascript
const MAX_SLOTS_PDF = 12; // limite do formulário físico — NÃO é limite de negócio

function flattenProcedimentos(procedimentos) {
  const flat = {};
  for (let i = 1; i <= MAX_SLOTS_PDF; i++) {
    const proc = procedimentos[i - 1] || {};
    flat[`tabela_proc_${String(i).padStart(2,'0')}`]    = proc.tabela || '';
    flat[`codigo_proc_${String(i).padStart(2,'0')}`]    = proc.codigo || '';
    flat[`descricao_proc_${String(i).padStart(2,'0')}`] = proc.descricao || '';
    flat[`qtde_sol_${String(i).padStart(2,'0')}`]       = proc.quantidade_solicitada || '';
  }
  return flat;
}
```

### Regra 2: CIDs dinâmicos → CID_01..04

```javascript
function flattenCids(cids) {
  return {
    cid_01: cids[0]?.codigo || '',
    cid_02: cids[1]?.codigo || '',
    cid_03: cids[2]?.codigo || '',
    cid_04: cids[3]?.codigo || ''
  };
}
```

### Regra 3: Booleans → códigos TISS

```javascript
function normalizeTissBoolean(valor) {
  if (valor === true || valor === 'Sim' || valor === 'S' || valor === '1') return 'S';
  return 'N';
}

// Aplicar em: previsao_opme, previsao_quimioterapico, deficit_neuro, tto_conservador
```

### Regra 4: Datas → formato TISS (DD/MM/YYYY)

```javascript
function normalizarData(valor) {
  if (!valor) return '';
  // ISO 8601: YYYY-MM-DD → DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [y, m, d] = valor.split('-');
    return `${d}/${m}/${y}`;
  }
  // Já está no formato correto
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) return valor;
  return valor; // retorna como está se formato desconhecido
}
```

### Regra 5: Isolamento pós-autorização

```javascript
function buildPosAutorizacao() {
  // Sempre vazio na solicitação. Nunca exposto como campo de input.
  return {
    senha_autorizacao: '',
    data_autorizacao: '',
    validade_autorizacao: '',
    diarias_autorizadas: '',
    codigo_glosa: '',
    motivo_glosa: ''
  };
}
```

### Regra 6: Defaults do perfil entram no pipeline

```javascript
function applyPerfilDefaults(flat, perfil) {
  // Se o campo está vazio e o perfil tem um default, usar o default
  if (!flat.hospital && perfil.hospital_padrao) {
    flat.hospital = perfil.hospital_padrao;
  }
  if (!flat.convenio && perfil.convenio_padrao) {
    flat.convenio = perfil.convenio_padrao;
  }
  return flat;
}
```

### Regra 7: CPF e CNS — nunca no payload Make.com

```javascript
function sanitizePHI(flat) {
  // PHI só vai ao PDF (via API server-side), NUNCA ao Make.com
  const phi_fields = ['cpf', 'cns', 'numero_carteira'];
  const makePayload = Object.assign({}, flat);
  phi_fields.forEach(f => { makePayload[f] = '[PROTEGIDO]'; });
  return makePayload;
}
```

### Regra 8: Campos numéricos

```javascript
function normalizarNumerico(valor, casas_decimais = 0, pad_length = 0) {
  const num = String(valor || '').replace(/\D/g, '');
  if (!num) return '';
  const parsed = parseInt(num, 10);
  if (isNaN(parsed)) return '';
  return pad_length > 0 ? String(parsed).padStart(pad_length, '0') : String(parsed);
}
// Exemplos:
// qtde_diarias_solicitadas: "5" → "005" (padStart 3)
// registro_ans: "303860" → "303860" (nenhum pad)
```

---

## 5. PIPELINE COMPLETO ILUSTRADO

```
collect()
│
│  { nome_paciente:"...", crm:"CRM/CE 18227", procedimento:"Microdiscectomia",
│    cod_tuss:"31009030", cid_principal:"M51.1", tipo_internacao:"2",
│    opme_items:[{...}], necessita_opme:"Sim", ... }
│
▼  buildContexto() + buildProcedimentos() + buildCids()
│
│  SCHEMA MESTRE:
│  { identificacao:{...}, paciente:{...}, medico:{...},
│    procedimentos:[{ordem:1, codigo:"31009030", ...}],
│    cids:[{codigo:"M51.1"}, ...],
│    materiais_opme:[{descricao:"...", anvisa:"..."}],
│    contexto_clinico:{...} }
│
▼  flattenProcedimentos() + flattenCids() + normalizações
│
│  SCHEMA ACHATADO:
│  { tabela_proc_01:"TUSS", codigo_proc_01:"31009030",
│    descricao_proc_01:"Microdiscectomia lombar",
│    qtde_sol_01:"1",
│    tabela_proc_02:"", codigo_proc_02:"", ... (até 12)
│    cid_01:"M51.1", cid_02:"", cid_03:"", cid_04:"",
│    data_solicitacao:"27/03/2026",
│    qtde_diarias_solicitadas:"005",
│    previsao_opme:"S",
│    _pos_autorizacao:{ senha:"", data:"", ... }
│  }
│
├──▶ fill_unimed_internacao_v1.py → INTERNACAO_2026-UNIMED-INTERN-00001.pdf
├──▶ POST Make.com (PHI sanitizado) → Google Sheets + Drive + notificação
└──▶ naLog (eventos operacionais, sem PHI)
```

---

## 6. TABELA MESTRA DE NORMALIZAÇÕES

| Campo | Entrada | Saída | Regra |
|---|---|---|---|
| `crm` | `"CRM/CE 18227"` | `crm_numero:"18227"`, `uf_crm:"CE"` | Extração por regex |
| `data_solicitacao` | `"2026-03-27"` | `"27/03/2026"` | ISO → DD/MM/YYYY |
| `data_nascimento` | `"1972-05-18"` | `"18/05/1972"` | ISO → DD/MM/YYYY |
| `previsao_opme` | `"Sim"` / `true` | `"S"` | Boolean → TISS |
| `tto_conservador` | `"Não"` / `false` | `"N"` | Boolean → TISS |
| `carater` | `"eletivo"` / `"E"` | `"E"` | Normaliza para código TISS |
| `qtde_diarias_solicitadas` | `"5"` / `5` | `"005"` | Número → string padStart(3) |
| `procedimentos[0..n]` | Array dinâmico | `PROC_01..12` | Array → slots fixos |
| `cids[0..3]` | Array dinâmico | `CID_01..04` | Array → slots fixos |
| `opme_items[0..5]` | Array dinâmico | `material_01..06_campo` | Array → slots fixos |
| `cpf`, `cns` | Dados reais | `"[PROTEGIDO]"` no Make.com | Sanitização PHI |
| `registro_ans` | Ausente | `"303860"` (lookup por convênio) | Default por convênio |
| `cnes` | Ausente | `"2517753"` (lookup por hospital) | Default por hospital |
