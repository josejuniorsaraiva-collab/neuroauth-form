# ENGINE_REGRAS_COMPLIANCE_v1
**Sistema:** NEUROAUTH | **Data:** 2026-03-27
**Escopo:** Como o sistema carrega, aplica e evolui as regras de compliance

---

## 1. PROBLEMA ATUAL

As regras TISS e anti-glosa estão embutidas em `neuroauth_compliance_engine.js`:

```javascript
const CONVENIO_RULES = {
  'unimed': {
    required_fields: ['cid_principal', 'indicacao_clinica', ...],
    recommended_fields: ['achados_exame', 'deficit_neuro'],
    validation_messages: { ... }
  }
}
```

Isso funciona para 1-2 convênios. Com 10 convênios, o arquivo fica ingerenciável.
Com regras por hospital, por região e por especialidade, é impossível.

**A regra é código. Precisa ser dado.**

---

## 2. MODELO-ALVO: REGRAS COMO DADOS

```
schemas/compliance/
  regras_tiss_geral.json         ← padrão ANS, todos os convênios
  regras_unimed_ce.json          ← específicas da Unimed CE
  regras_bradesco_saude.json     ← específicas do Bradesco
  regras_neurocirurgia.json      ← por especialidade
  regras_anti_glosa.json         ← sugestões de texto
```

Cada arquivo é um array de objetos `REGRA` seguindo `REGRAS_COMPLIANCE_SCHEMA_v1.json`.

---

## 3. COMO O ENGINE CARREGA REGRAS POR CONTEXTO

```javascript
function loadRules(contexto) {
  // contexto = { convenio, hospital, regiao, especialidade, tipo_guia }

  const regras = [];

  // 1. Regras TISS universais (sempre)
  regras.push(...REGRAS_TISS_GERAL);

  // 2. Regras por convênio
  if (REGRAS_CONVENIO[contexto.convenio]) {
    regras.push(...REGRAS_CONVENIO[contexto.convenio]);
  }

  // 3. Regras por hospital
  if (REGRAS_HOSPITAL[contexto.hospital]) {
    regras.push(...REGRAS_HOSPITAL[contexto.hospital]);
  }

  // 4. Regras combinadas hospital × convênio
  const chave = `${contexto.hospital}::${contexto.convenio}`;
  if (REGRAS_COMBINADAS[chave]) {
    regras.push(...REGRAS_COMBINADAS[chave]);
  }

  // 5. Regras por especialidade
  if (REGRAS_ESPECIALIDADE[contexto.especialidade]) {
    regras.push(...REGRAS_ESPECIALIDADE[contexto.especialidade]);
  }

  // 6. Filtrar por tipo_guia
  return regras.filter(r =>
    r.tipo_guia === contexto.tipo_guia || r.tipo_guia === '*'
  );
}
```

---

## 4. COMO O ENGINE APLICA REGRAS EM CASCATA

```javascript
function validateBeforePrint(payload, contexto) {
  const regras = loadRules(contexto);
  const blocks  = [];  // impedem envio
  const warnings = []; // alertam mas permitem

  for (const regra of regras) {
    if (!regra.ativo) continue;
    if (!avaliarCondicao(regra.condicao, payload)) continue;

    const resultado = aplicarValidacao(regra, payload);

    if (!resultado.passou) {
      const item = {
        id_regra: regra.id_regra,
        campo:    regra.campo,
        message:  regra.mensagem,
        sugestao: regra.sugestao_reescrita || null
      };
      if (regra.nivel === 'bloqueante')   blocks.push(item);
      else                                warnings.push(item);
    }
  }

  return {
    can_print: blocks.length === 0,
    blocks,
    warnings
  };
}
```

---

## 5. AVALIAÇÃO DE CONDIÇÃO

```javascript
function avaliarCondicao(condicao, payload) {
  if (condicao === 'sempre') return true;

  // Condições simples: "campo == valor"
  const match = condicao.match(/^(\w+)\s*==\s*'([^']+)'$/);
  if (match) {
    const [, campo, valor] = match;
    return payload[campo] === valor;
  }

  // Condições de array: "array.length > N"
  const lenMatch = condicao.match(/^(\w+)\.length\s*([><=!]+)\s*(\d+)$/);
  if (lenMatch) {
    const [, campo, op, n] = lenMatch;
    const arr = payload[campo];
    const len = Array.isArray(arr) ? arr.length : 0;
    return eval(`${len} ${op} ${n}`); // eslint: usar função segura em produção
  }

  return false; // condição desconhecida = não aplica
}
```

---

## 6. APLICAÇÃO DE VALIDAÇÃO

```javascript
function aplicarValidacao(regra, payload) {
  const campo = regra.campo;
  const v     = regra.validacao;
  const valor = payload[campo];

  switch (regra.tipo_regra) {
    case 'campo_obrigatorio':
      return { passou: valor !== null && valor !== undefined && String(valor).trim() !== '' };

    case 'texto_insuficiente':
      return { passou: String(valor || '').trim().length >= (v.min_chars || 0) };

    case 'formato_invalido':
      return { passou: new RegExp(v.regex).test(String(valor || '')) };

    case 'valor_fora_de_range':
      const num = Number(valor);
      return { passou: num >= (v.min || -Infinity) && num <= (v.max || Infinity) };

    case 'limite_excedido':
      const arr = Array.isArray(payload[campo]) ? payload[campo] : [];
      return { passou: arr.length <= (v.max_items || Infinity) };

    case 'anti_glosa_texto':
      if (!v.deve_conter_algum) return { passou: true };
      const texto = String(valor || '').toLowerCase();
      return { passou: v.deve_conter_algum.some(p => texto.includes(p.toLowerCase())) };

    default:
      return { passou: true }; // tipo desconhecido = não bloqueia
  }
}
```

---

## 7. SEPARAÇÃO ENTRE TIPOS DE REGRA

| Tipo | Quando aplicar | Usuário vê | Impede envio |
|---|---|---|---|
| `campo_obrigatorio` | Ao tentar enviar | ⛔ Lista de bloqueios | Sim |
| `campo_recomendado` | Ao abrir preview | ⚠️ Aviso suave | Não |
| `texto_insuficiente` | Ao tentar enviar | ⚠️ ou ⛔ conforme nível | Se bloqueante |
| `anti_glosa_texto` | Ao abrir preview | 💡 Sugestão | Nunca |
| `formato_invalido` | Ao sair do campo (blur) | ❌ Inline no campo | Se bloqueante |
| `combinacao_invalida` | Ao tentar enviar | ⛔ Explicação | Sim |

---

## 8. COMO PERSONALIZAR SEM EDITAR CÓDIGO

**Adicionar regra nova sem tocar no engine:**
```json
// schemas/compliance/regras_unimed_ce.json — adicionar ao array:
{
  "id_regra": "R-UNIMED-CE-042",
  "tipo_regra": "campo_obrigatorio",
  "nivel": "bloqueante",
  "convenio": "unimed_ce",
  "tipo_guia": "sadt",
  "campo": "via_acesso",
  "condicao": "especialidade == 'neurocirurgia'",
  "validacao": { "nao_vazio": true },
  "mensagem": "Via de acesso obrigatória para procedimentos neurocirúrgicos na Unimed CE.",
  "ativo": true
}
```

**Desativar regra sem deletar:**
```json
{ "id_regra": "R-TISS-010", "ativo": false }
```

**Mudar nível de bloqueante para alerta:**
```json
{ "id_regra": "R-TISS-010", "nivel": "alerta_alto" }
```

---

## 9. MIGRAÇÃO DO ENGINE ATUAL

O `neuroauth_compliance_engine.js` atual já é um interpreter de regras.
A migração é gradual:

```
Fase 2a: Extrair CONVENIO_RULES para JSON externo
         Engine carrega JSON em vez de ter objeto inline

Fase 2b: Separar regras_tiss_geral.json dos regras_<convenio>.json

Fase 2c: Adicionar campo "condicao" nas regras existentes

Fase 3:  Loader dinâmico por contexto (hospital × convênio × especialidade)
```

**O engine atual não precisa ser reescrito — só precisa aceitar regras de fora.**
