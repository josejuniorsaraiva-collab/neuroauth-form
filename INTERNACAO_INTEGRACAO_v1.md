# NEUROAUTH — Guia de Internação: Integração ao Sistema
**Versão:** 1.0.0 | **Data:** 2026-03-27

---

## 1. Mapa Completo de Campos (49 campos, 12 linhas de proc.)

| # | Campo (var_name) | Label na Guia | Grupo | Origem |
|---|---|---|---|---|
| 1 | `registro_ans` | 1 - Registro ANS | Identificação | AUTO — operadora |
| 2 | `numero_guia_prestador` | 2 - Nº Guia no Prestador | Identificação | MANUAL |
| 3 | `numero_guia_operadora` | 3 - Nº Guia Atribuído pela Operadora | Identificação | AUTO — operadora |
| 4 | `data_autorizacao` | 4 - Data da Autorização | Autorização prévia | AUTO — resposta operadora |
| 5 | `senha` | 5 - Senha | Autorização prévia | AUTO — resposta operadora |
| 6 | `data_validade_senha` | 6 - Data de Validade da Senha | Autorização prévia | AUTO — resposta operadora |
| 7 | `numero_carteira` | 7 - Número da Carteira | Beneficiário | MANUAL |
| 8 | `validade_carteira` | 8 - Validade da Carteira | Beneficiário | MANUAL |
| 9 | `atendimento_rn` | 9 - Atendimento de RN | Beneficiário | AUTO — padrão N |
| 10 | `nome_paciente` | 10 - Nome | Beneficiário | MANUAL |
| 11 | `cns` | 11 - Cartão Nacional de Saúde | Beneficiário | MANUAL (opcional alpha) |
| 12 | `codigo_operadora_sol` | 12 - Código na Operadora | Contratado Solic. | AUTO — perfil médico |
| 13 | `nome_contratado` | 13 - Nome do Contratado | Contratado Solic. | AUTO — perfil médico |
| 14 | `nome_profissional` | 14 - Nome do Profissional Solicitante | Profissional | AUTO — perfil médico |
| 15 | `conselho_profissional` | 15 - Conselho Profissional | Profissional | AUTO — perfil médico |
| 16 | `numero_conselho` | 16 - Número no Conselho | Profissional | AUTO — perfil médico |
| 17 | `uf_crm` | 17 - UF | Profissional | AUTO — perfil médico |
| 18 | `cbo` | 18 - Código CBO | Profissional | AUTO — perfil médico |
| 19 | `codigo_operadora_exec` | 19 - Código na Operadora / CNPJ | Hospital | AUTO — hospital selecionado |
| 20 | `nome_hospital` | 20 - Nome do Hospital / Local Solicitado | Hospital | MANUAL — select |
| 21 | `data_sugerida_internacao` | 21 - Data sugerida para internação | Hospital | MANUAL = data_cirurgia |
| 22 | `carater_atendimento` | 22 - Caráter do Atendimento | Internação | MANUAL |
| 23 | `tipo_internacao` | 23 - Tipo de Internação | Internação | MANUAL (novo campo) |
| 24 | `regime_internacao` | 24 - Regime de Internação | Internação | MANUAL |
| 25 | `qtde_diarias_solicitadas` | 25 - Qtde. Diárias Solicitadas | Internação | MANUAL (novo campo) |
| 26 | `previsao_opme` | 26 - Previsão de uso de OPME | Internação | AUTO — necessita_opme |
| 27 | `previsao_quimioterapico` | 27 - Previsão de uso de quimioterápico | Internação | AUTO — padrão N |
| 28 | `indicacao_clinica` | 28 - Indicação Clínica | Clínica | MANUAL / AUTO via copiloto |
| 29 | `cid10_principal` | 29 - CID 10 Principal | Clínica | MANUAL / AUTO via procedimento |
| 30 | `cid10_2` | 30 - CID 10 (2) | Clínica | MANUAL (opcional) |
| 31 | `cid10_3` | 31 - CID 10 (3) | Clínica | MANUAL (opcional) |
| 32 | `cid10_4` | 32 - CID 10 (4) | Clínica | MANUAL (opcional) |
| 33 | `indicacao_acidente` | 33 - Indicação de Acidente | Clínica | AUTO — padrão N |
| 34-38 | `tabela_N` / `codigo_procedimento_N` / `descricao_procedimento_N` / `quantidade_solicitada_N` | 34-38 × 12 linhas | Procedimentos | MANUAL / AUTO via BANCO MESTRE |
| 39 | `data_admissao` | 39 - Data Provável da Admissão Hospitalar | Autorização | MANUAL = data_cirurgia |
| 40 | `qtde_diarias_autorizadas` | 40 - Qtde. Diárias Autorizadas | Autorização | AUTO — resposta operadora |
| 41 | `tipo_acomodacao_autorizada` | 41 - Tipo da Acomodação Autorizada | Autorização | AUTO — resposta operadora |
| 42 | `codigo_operadora_autorizado` | 42 - Código na Operadora / CNPJ autorizado | Autorização | AUTO — resposta operadora |
| 43 | `nome_hospital_autorizado` | 43 - Nome do Hospital / Local Autorizado | Autorização | AUTO — resposta operadora |
| 44 | `codigo_cnes_autorizado` | 44 - Código CNES | Autorização | AUTO — resposta operadora |
| 45 | `observacao_justificativa` | 45 - Observação / Justificativa | Observação | AUTO = tto_conservador + achados |
| 46 | `data_solicitacao` | 46 - Data da Solicitação | Rodapé | AUTO — data atual |

---

## 2. Classificação: Manual × Automático × Oculto no Alpha

### 🔴 Obrigatório Manual (secretária preenche)
| Campo | Por que manual |
|---|---|
| `nome_paciente` | Identificação única do paciente |
| `numero_carteira` | Específico por atendimento |
| `numero_guia_prestador` | Número de controle interno |
| `nome_hospital` | Decisão clínica |
| `carater_atendimento` | Decisão clínica (Eletivo/Urgência) |
| `tipo_internacao` | Exigência TISS (código 1-9) |
| `regime_internacao` | Exigência TISS |
| `qtde_diarias_solicitadas` | Decisão clínica |
| `indicacao_clinica` | Texto clínico (copiloto auxilia) |
| `cid10_principal` | Diagnóstico principal |
| `procedimentos (linhas 1-N)` | Seleção de procedimentos |

### 🟡 Automático por Perfil do Médico
| Campo | Fonte |
|---|---|
| `registro_ans` | `perfil.codigo_ans` |
| `nome_profissional` | `perfil.medico_nome` |
| `conselho_profissional` | `perfil.conselho` = "CRM" |
| `numero_conselho` | `perfil.crm` (só números) |
| `uf_crm` | `perfil.uf_crm` |
| `cbo` | `perfil.cbo` |
| `nome_contratado` | `perfil.hospital_padrao` |
| `codigo_operadora_sol` | `perfil.codigo_operadora` |

### 🟡 Automático por Lógica do Sistema
| Campo | Lógica |
|---|---|
| `previsao_opme` | `necessita_opme === 'Sim' ? 'S' : 'N'` |
| `previsao_quimioterapico` | Sempre "N" (neurocirurgia) |
| `atendimento_rn` | Sempre "N" por default |
| `indicacao_acidente` | Sempre "N" por default |
| `data_solicitacao` | `new Date()` formatada |
| `data_sugerida_internacao` | = `data_cirurgia` do formulário |
| `data_admissao` | = `data_cirurgia` do formulário |
| `validade_carteira` | Formatada de `validade_carteira` (date → DD/MM/YYYY) |
| `observacao_justificativa` | Gerada de `tto_conservador` + `deficit_neuro` + `achados_exame` |

### 🟢 Oculto no Alpha (preenchido só pós-autorização)
| Campo | Quando preencher |
|---|---|
| `senha` | Após retorno da operadora |
| `data_autorizacao` | Após retorno da operadora |
| `data_validade_senha` | Após retorno da operadora |
| `numero_guia_operadora` | Após retorno da operadora |
| `qtde_diarias_autorizadas` | Após retorno da operadora |
| `tipo_acomodacao_autorizada` | Após retorno da operadora |
| `codigo_operadora_autorizado` | Após retorno da operadora |
| `nome_hospital_autorizado` | Após retorno da operadora |
| `codigo_cnes_autorizado` | Após retorno da operadora |

---

## 3. Campos Novos Necessários no index.html

O formulário atual já tem quase tudo. Faltam apenas **4 campos** para cobrir 100% da Guia de Internação:

| Campo novo | Onde adicionar | Tipo | Label |
|---|---|---|---|
| `tipo_internacao` | Tab 1 (Convênio) | `<select>` | Tipo de Internação |
| `qtde_diarias_solicitadas` | Tab 1 (Convênio) | `<input number>` | Diárias Solicitadas |
| `previsao_quimioterapico` | Tab 4 (OPME) | `<select>` | Previsão quimioterápico |
| `numero_guia_prestador` | Tab 1 (Convênio) | `<input text>` | Nº Guia (Prestador) |

---

## 4. Plano de Integração com o Formulário Atual

### Fase 1 — Campos (esta sessão)
- [ ] Adicionar 4 campos novos nos tabs existentes
- [ ] Atualizar `collect()` para incluir os novos campos
- [ ] Adicionar `buildInternacaoVars()` que mapeia collect() → variáveis da guia
- [ ] Adicionar aba "Guia Internação" no painel de preview (ao lado de SADT/OPME)
- [ ] Adicionar `renderInternacao()` para preview HTML
- [ ] Adicionar botão "🏥 Imprimir Internação" no footer
- [ ] Adicionar `printGuia('internacao')` no `printGuia()` dispatcher

### Fase 2 — Motor PDF (já pronto)
- [x] `fill_unimed_internacao_v1.py` — coordenadas calibradas, 49 campos, 12 linhas
- [x] `POST /gerar_internacao` — endpoint FastAPI ativo
- [x] `TEMPLATES_OFICIAIS/blank_internacao_template.pdf` — instalado
- [ ] Conectar botão "Gerar PDF Internação" ao endpoint da API

### Fase 3 — Make.com (após webhook reativar)
- [ ] Adicionar módulo de geração de internação no cenário Make
- [ ] Workflow: Form → /gerar_internacao → /gerar_sadt (se necessário) → /gerar_opme (se OPME) → Drive/email

---

## 5. Mapeamento collect() → Guia de Internação

```javascript
function buildInternacaoVars(d) {
  // d = resultado de collect()
  return {
    // Identificação
    registro_ans:           d.codigo_ans           || '311269',
    numero_guia_prestador:  d.numero_guia_prestador || '',
    // Beneficiário
    numero_carteira:        d.numero_carteira       || '',
    validade_carteira:      d.validade_carteira     || '',
    atendimento_rn:         'N',
    nome_paciente:          (d.nome_paciente||'').toUpperCase(),
    cns:                    d.cns                   || '',
    // Profissional (do perfil)
    nome_profissional:      d.medico_solicitante    || '',
    conselho_profissional:  'CRM',
    numero_conselho:        (d.crm||'').replace(/\D/g,''),
    uf_crm:                 (d.crm||'').replace(/.*\//,'').trim() || 'CE',
    cbo:                    d.cbo                   || '225125',
    // Hospital
    nome_hospital:          d.hospital              || '',
    data_sugerida_internacao: fmtDate(d.data_cirurgia),
    // Internação
    carater_atendimento:    d.carater_cod           || '1',
    tipo_internacao:        d.tipo_internacao       || '1',
    regime_internacao:      regimaCode(d.regime),
    qtde_diarias_solicitadas: String(d.qtde_diarias_solicitadas||'').padStart(3,'0'),
    previsao_opme:          d.necessita_opme==='Sim' ? 'S' : 'N',
    previsao_quimioterapico: 'N',
    // Clínica
    indicacao_clinica:      d.indicacao_clinica     || '',
    cid10_principal:        d.cid_principal         || '',
    cid10_2:                d.cid2                  || '',
    cid10_3:                '',
    cid10_4:                '',
    indicacao_acidente:     'N',
    // Procedimentos (linha 1 = procedimento principal)
    tabela_1:               d.tabela_cbhpm          || '22',
    codigo_procedimento_1:  d.cod_cbhpm             || '',
    descricao_procedimento_1: d.procedimento        || '',
    quantidade_solicitada_1: '001',
    // Observação
    observacao_justificativa: buildObs(d),
    data_solicitacao:       fmtDate(new Date()),
  };
}
```

---

## 6. Roadmap — Guia de Internação no NEUROAUTH

| Etapa | O que | Quando | Dependência |
|---|---|---|---|
| ✅ Motor PDF | fill_unimed_internacao_v1.py, 49 campos | Feito | — |
| ✅ API endpoint | POST /gerar_internacao | Feito | Motor PDF |
| ✅ Template | blank_internacao_template.pdf | Feito | PDF original |
| 🔄 Form campos | 4 novos campos no index.html | Esta sessão | — |
| 🔄 Preview | Aba Internação no painel direito | Esta sessão | Form campos |
| 🔄 collect() | Mapear buildInternacaoVars() | Esta sessão | Form campos |
| ⏳ PDF button | Botão "Gerar PDF" → API endpoint | Próxima sessão | API live |
| ⏳ Make.com | Webhook reativado + módulo internação | Após API deploy | Render.com |
| ⏳ Pós-autorização | Tela para preencher campos da operadora | v2 | Make.com |
| ⏳ Impressão 3-em-1 | SADT + Internação + OPME em lote | v2 | Todos os motores |
