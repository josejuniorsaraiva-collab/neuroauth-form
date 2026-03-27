# NEUROAUTH — Tabela de Mapeamento Oficial
## Guia de Solicitação de Internação · Unimed Ceará
**Versão:** 1.0.0 | **Padrão:** TISS ANS RN 501/2022

---

### Legenda — Classe do Campo

| Código | Classe | Descrição |
|---|---|---|
| `MO` | manual_obrigatorio | Secretária/médico preenche. Bloqueia envio se vazio. |
| `AU` | automatico | Sistema preenche a partir de perfil, lógica ou data atual. |
| `PA` | pos_autorizacao | Só existe após retorno da operadora. Nunca é entrada. |
| `OP` | opcional | Melhora qualidade, mas não bloqueia envio. |

---

### Seção 1 — Identificação da Guia

| # | Campo Oficial | `nome_json` (mestre) | `variavel_make` (achatado) | Origem | Classe |
|---|---|---|---|---|---|
| 1 | Registro ANS | `solicitacao.identificacao_guia.registro_ans` | `registro_ans` | Perfil médico → `perfil.codigo_ans` | `AU` |
| 2 | Nº Guia no Prestador | `solicitacao.identificacao_guia.numero_guia_prestador` | `numero_guia_prestador` | Secretária digita | `MO` |
| 3 | Nº Guia Atribuído pela Operadora | `autorizacao_operadora.numero_guia_operadora` | `_pos_autorizacao.numero_guia_operadora` | Operadora | `PA` |
| 4 | Data da Autorização | `autorizacao_operadora.data_autorizacao` | `_pos_autorizacao.data_autorizacao` | Operadora | `PA` |
| 5 | Senha | `autorizacao_operadora.senha` | `_pos_autorizacao.senha` | Operadora | `PA` |
| 6 | Data de Validade da Senha | `autorizacao_operadora.data_validade_senha` | `_pos_autorizacao.data_validade_senha` | Operadora | `PA` |
| 46 | Data da Solicitação | `solicitacao.identificacao_guia.data_solicitacao` | `data_solicitacao` | Sistema → `new Date()` | `AU` |

---

### Seção 2 — Dados do Beneficiário

| # | Campo Oficial | `nome_json` (mestre) | `variavel_make` (achatado) | Origem | Classe |
|---|---|---|---|---|---|
| 7 | Número da Carteira | `solicitacao.beneficiario.numero_carteira` | `numero_carteira` | Formulário | `MO` |
| 8 | Validade da Carteira | `solicitacao.beneficiario.validade_carteira` | `validade_carteira` | Formulário | `MO` |
| 9 | Atendimento de RN | `solicitacao.beneficiario.atendimento_rn` | `atendimento_rn` | Sistema → `false` | `AU` |
| 10 | Nome | `solicitacao.beneficiario.nome` | `nome_paciente` | Formulário | `MO` |
| 11 | Cartão Nacional de Saúde | `solicitacao.beneficiario.cns` | `cns` | Formulário | `OP` |
| — | Data de Nascimento | `solicitacao.beneficiario.data_nascimento` | `data_nascimento` | Formulário | `OP` |
| — | CPF | `solicitacao.beneficiario.cpf` | `cpf` | Formulário | `OP` |

---

### Seção 3 — Dados do Contratado / Profissional Solicitante

| # | Campo Oficial | `nome_json` (mestre) | `variavel_make` (achatado) | Origem | Classe |
|---|---|---|---|---|---|
| 12 | Código na Operadora (Contratado) | `solicitacao.profissional_solicitante.codigo_operadora_sol` | `codigo_operadora_sol` | Perfil médico | `AU` |
| 13 | Nome do Contratado | `solicitacao.profissional_solicitante.nome_contratado` | `nome_contratado` | Perfil médico | `AU` |
| 14 | Nome do Profissional Solicitante | `solicitacao.profissional_solicitante.nome` | `nome_profissional` | Perfil médico | `AU` |
| 15 | Conselho Profissional | `solicitacao.profissional_solicitante.conselho` | `conselho_profissional` | Perfil médico → `"CRM"` | `AU` |
| 16 | Número no Conselho | `solicitacao.profissional_solicitante.numero_conselho` | `numero_conselho` | Perfil médico | `AU` |
| 17 | UF | `solicitacao.profissional_solicitante.uf_conselho` | `uf_crm` | Perfil médico | `AU` |
| 18 | Código CBO | `solicitacao.profissional_solicitante.cbo` | `cbo` | Perfil médico | `AU` |

---

### Seção 4 — Hospital / Local Solicitado / Dados da Internação

| # | Campo Oficial | `nome_json` (mestre) | `variavel_make` (achatado) | Origem | Classe |
|---|---|---|---|---|---|
| 19 | Código na Operadora / CNPJ (Hospital) | `solicitacao.hospital.codigo_operadora_exec` | `codigo_operadora_exec` | Perfil médico / cadastro hospital | `AU` |
| 20 | Nome do Hospital / Local Solicitado | `solicitacao.hospital.nome` | `nome_hospital` | Formulário → select | `MO` |
| 21 | Data Sugerida para Internação | `solicitacao.hospital.data_sugerida` | `data_sugerida_internacao` | Derivado de `data_cirurgia` | `AU` |
| 22 | Caráter do Atendimento | `solicitacao.parametros_internacao.carater_atendimento.codigo` | `carater_atendimento` | Formulário | `MO` |
| 23 | Tipo de Internação | `solicitacao.parametros_internacao.tipo_internacao.codigo` | `tipo_internacao` | Formulário | `MO` |
| 24 | Regime de Internação | `solicitacao.parametros_internacao.regime_internacao.codigo` | `regime_internacao` | Formulário | `MO` |
| 25 | Qtde. Diárias Solicitadas | `solicitacao.parametros_internacao.qtde_diarias_solicitadas` | `qtde_diarias_solicitadas` | Formulário | `MO` |
| 26 | Previsão de Uso de OPME | `solicitacao.parametros_internacao.previsao_opme` | `previsao_opme` | Derivado de `necessita_opme` | `AU` |
| 27 | Previsão de Uso de Quimioterápico | `solicitacao.parametros_internacao.previsao_quimioterapico` | `previsao_quimioterapico` | Formulário → padrão `N` | `AU` |

---

### Seção 5 — Indicação Clínica e CID

| # | Campo Oficial | `nome_json` (mestre) | `variavel_make` (achatado) | Origem | Classe |
|---|---|---|---|---|---|
| 28 | Indicação Clínica | `solicitacao.clinica.indicacao_clinica` | `indicacao_clinica` | Formulário / copiloto clínico | `MO` |
| 29 | CID 10 Principal | `solicitacao.clinica.cid.principal` | `cid_01` | Formulário / auto por procedimento | `MO` |
| 30 | CID 10 (2) | `solicitacao.clinica.cid.secundarios[0]` | `cid_02` | Formulário | `OP` |
| 31 | CID 10 (3) | `solicitacao.clinica.cid.secundarios[1]` | `cid_03` | Formulário | `OP` |
| 32 | CID 10 (4) | `solicitacao.clinica.cid.secundarios[2]` | `cid_04` | Formulário | `OP` |
| 33 | Indicação de Acidente | `solicitacao.clinica.indicacao_acidente` | `indicacao_acidente` | Sistema → `false` | `AU` |

---

### Seção 6 — Procedimentos Solicitados (linhas 34–38, dinâmicas)

> No schema mestre: array `solicitacao.procedimentos[]` sem limite.
> No schema achatado: chaves `PROC_01` a `PROC_12` (limite do papel).
> **A regra de negócio não limita. O papel limita.**

| Linha | Campo Oficial | `nome_json` (mestre) | `variavel_make` (achatado) | Origem | Classe |
|---|---|---|---|---|---|
| N | Tabela (34) | `procedimentos[N-1].tabela` | `tabela_proc_NN` | Formulário → padrão `"22"` | `MO` |
| N | Código do Procedimento (35) | `procedimentos[N-1].codigo` | `codigo_proc_NN` | Formulário / Banco Mestre | `MO` |
| N | Descrição (36) | `procedimentos[N-1].descricao` | `descricao_proc_NN` | Formulário / Banco Mestre | `MO` |
| N | Qtde. Solicitada (37) | `procedimentos[N-1].qtde_solicitada` | `qtde_sol_NN` | Formulário → padrão `1` | `MO` |
| N | Qtde. Autorizada (38) | `procedimentos[N-1].qtde_autorizada` | `qtde_aut_NN` | Operadora | `PA` |

---

### Seção 7 — Dados da Autorização (pós-operadora)

| # | Campo Oficial | `nome_json` (mestre) | `variavel_make` (achatado) | Origem | Classe |
|---|---|---|---|---|---|
| 39 | Data Provável da Admissão Hospitalar | `autorizacao_operadora.data_admissao` | `_pos_autorizacao.data_admissao` | Operadora | `PA` |
| 40 | Qtde. Diárias Autorizadas | `autorizacao_operadora.qtde_diarias_autorizadas` | `_pos_autorizacao.qtde_diarias_autorizadas` | Operadora | `PA` |
| 41 | Tipo da Acomodação Autorizada | `autorizacao_operadora.tipo_acomodacao_autorizada` | `_pos_autorizacao.tipo_acomodacao_autorizada` | Operadora | `PA` |
| 42 | Código na Operadora / CNPJ Autorizado | `autorizacao_operadora.hospital_autorizado.codigo_operadora` | `_pos_autorizacao.codigo_operadora_autorizado` | Operadora | `PA` |
| 43 | Nome do Hospital / Local Autorizado | `autorizacao_operadora.hospital_autorizado.nome` | `_pos_autorizacao.nome_hospital_autorizado` | Operadora | `PA` |
| 44 | Código CNES | `autorizacao_operadora.hospital_autorizado.cnes` | `_pos_autorizacao.codigo_cnes_autorizado` | Operadora | `PA` |

---

### Seção 8 — Observação e Assinaturas

| # | Campo Oficial | `nome_json` (mestre) | `variavel_make` (achatado) | Origem | Classe |
|---|---|---|---|---|---|
| 45 | Observação / Justificativa | `solicitacao.observacao` | `observacao_justificativa` | Auto: tto_conservador + déficit + achados | `AU` |
| 47 | Assinatura Profissional Solicitante | `solicitacao.assinaturas.profissional_assinatura_digital` | — | Digital / manuscrita | `OP` |
| 48 | Assinatura do Beneficiário | `solicitacao.assinaturas.beneficiario_assinatura_digital` | — | Digital / manuscrita | `OP` |
| 49 | Assinatura Responsável pela Autorização | — | — | Operadora | `PA` |

---

### Seção 9 — Meta / Workflow (não aparecem na guia impressa)

| Campo | `nome_json` (mestre) | `variavel_make` (achatado) | Classe |
|---|---|---|---|
| ID do caso | `meta.case_id` | `case_id` | `AU` |
| Status workflow | `workflow.status` | `workflow_status` | `AU` |
| Prioridade | `workflow.prioridade` | `prioridade` | `OP` |
| E-mail usuário | `meta.usuario_email` | `usuario_email` | `AU` |
| PDFs gerados (URLs) | `workflow.pdfs_gerados.*` | `url_pdf_internacao` etc. | `AU` |

---

### Totais por Classe

| Classe | Qtd. campos | Descrição |
|---|---|---|
| `MO` manual_obrigatorio | **11** | Bloqueiam envio se vazios |
| `AU` automatico | **21** | Sistema preenche, zero atrito para secretária |
| `PA` pos_autorizacao | **13** | Chegam após retorno da operadora |
| `OP` opcional | **8** | Enriquecem sem obrigar |
| **Total** | **53** | Incluindo campos meta/workflow |
