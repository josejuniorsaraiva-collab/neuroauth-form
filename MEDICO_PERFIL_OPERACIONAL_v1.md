# MEDICO_PERFIL_OPERACIONAL_v1
**Sistema:** NEUROAUTH | **Data:** 2026-03-27
**Escopo:** Separação entre dados cadastrais, preferências, permissões e defaults de preenchimento

---

## 1. O MÉDICO COMO PERFIL OPERACIONAL

Login é autenticação. Perfil é comportamento.

Hoje, o NEUROAUTH usa o perfil do médico apenas para:
- Preencher nome e CRM no formulário
- Decidir se o email tem acesso ao sistema

Em escala, o perfil deve fazer muito mais:
- Filtrar convênios disponíveis (só mostra Unimed se o médico for credenciado)
- Filtrar hospitais disponíveis
- Pré-preencher campos repetitivos (hospital padrão, CBO, acomodação)
- Sugerir procedimentos e OPME favoritas
- Aplicar limites de billing por plano
- Determinar permissões de interface

---

## 2. SEPARAÇÃO DE RESPONSABILIDADES

### 2.1 Dados cadastrais (imutáveis ou raramente modificados)
Vêm do CFM, não do usuário.
```
nome, crm, cbo, especialidade, subespecialidade, rqe
```
Onde moram: planilha MEDICOS no Google Sheets + `schemas/medicos/`

### 2.2 Preferências (configuradas pelo médico)
Configuram o comportamento padrão do formulário.
```
hospital_padrao, convenio_padrao, carater_atendimento_padrao,
indicacao_clinica_templates, procedimentos_favoritos, opme_favoritas,
calendario_id, contato_secretaria
```
Onde moram: planilha MEDICOS (colunas adicionais) ou banco de preferências futuro

### 2.3 Permissões (definidas pelo administrador)
Determinam o que o médico pode ver e fazer.
```
perfil_acesso, pode_ver_billing, pode_exportar_dados,
pode_ver_historico_outros, limite_guias_mes
```
Onde moram: planilha MEDICOS (colunas de permissão)

### 2.4 Defaults de preenchimento (derivados do perfil)
São calculados em runtime a partir dos dados acima.
```javascript
// index.html::naEnterForm() após login bem-sucedido:
sv('medico_solicitante', perfil.nome);
sv('crm', perfil.crm);
sv('cbo', perfil.cbo);
sv('hospital', perfil.hospital_padrao);
sv('convenio', perfil.convenio_padrao);
```

### 2.5 Regras específicas de cobrança
Calculadas pelo BillingBridge em runtime.
```
plano, guias_incluidas_mes, desconto_percentual, asaas_customer_id
```

---

## 3. FLUXO DE LOGIN → PERFIL → FORMULÁRIO

```
[1] Google Sign-In → id_token

[2] POST NA_PROFILE_WH {id_token}
    Make.com:
      → validar token (Google tokeninfo)
      → buscar email na planilha MEDICOS
      → retornar perfil completo

[3] Perfil retornado:
    {
      medico_id, nome, email, crm, crm_numero, uf_crm, cbo,
      especialidade, hospital_padrao, convenio_padrao,
      hospitais_habilitados[], convenios_habilitados[],
      perfil_acesso, plano,
      email_secretaria, whatsapp_secretaria, calendario_id
    }

[4] index.html::naEnterForm(perfil):
    → preenche campos automáticos
    → filtra <select> de hospital pelos hospitais_habilitados[]
    → filtra <select> de convênio pelos convenios_habilitados[]
    → carrega procedimentos_favoritos no autocomplete
    → configura billing limit (guias restantes no mês)
```

---

## 4. ESTRUTURA DA PLANILHA MEDICOS (Google Sheets)

| Coluna | Campo | Tipo | Origem |
|---|---|---|---|
| A | email | string | Google OAuth |
| B | medico_id | string | Sistema |
| C | nome | string | CFM/cadastro |
| D | crm | string | CFM |
| E | uf_crm | string | CFM |
| F | cbo | string | CBO |
| G | especialidade | string | cadastro |
| H | hospital_padrao | id_hospital | preferência |
| I | convenio_padrao | id_convenio | preferência |
| J | hospitais_habilitados | JSON array | cadastro |
| K | convenios_habilitados | JSON array | cadastro |
| L | perfil_acesso | enum | admin |
| M | plano | enum | billing |
| N | ativo | boolean | admin |
| O | email_secretaria | email | preferência |
| P | whatsapp_secretaria | string | preferência |
| Q | calendario_id | string | Google Calendar |
| R | limite_guias_mes | integer | plano |

---

## 5. O QUE MUDA POR MÉDICO (vs. por convênio)

| Campo | Por Médico | Por Convênio | Por Hospital |
|---|---|---|---|
| Nome no cabeçalho | ✅ | ❌ | ❌ |
| CRM/CBO na guia | ✅ | ❌ | ❌ |
| Convênios disponíveis | ✅ (habilitados pelo médico) | ❌ | ✅ (credenciados) |
| Procedimentos sugeridos | ✅ (favoritos) | ❌ | ❌ |
| OPME sugerida | ✅ (favoritas) | ❌ | ❌ |
| Template de indicação | ✅ (templates do médico) | ❌ | ❌ |
| Limite de guias | ✅ (plano) | ❌ | ❌ |
| Campos obrigatórios da guia | ❌ | ✅ | ✅ |
| Template PDF | ❌ | ✅ | ❌ |
| Regras anti-glosa | ❌ | ✅ | ❌ |
