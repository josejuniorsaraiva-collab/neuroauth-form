# /integration — Conectores Externos

## /make
Cenários e blueprints do Make.com (ex-Integromat).

- `make_blueprint.json` — blueprint exportado do cenário NEUROAUTH
- `NEUROAUTH_Checklist_Make_Validacao.html` — checklist de validação de cenários

## /sheets
Google Apps Scripts para integração com Google Sheets.

- `NEUROAUTH_Bootstrap.gs` — inicialização da planilha mestre
- `NEUROAUTH_Setup.gs` — configuração inicial
- `NEUROAUTH_ImportarSheets.gs` — importação de dados

## Como adicionar nova integração

1. Criar subpasta `/integration/<nome-servico>/`
2. Documentar endpoint, autenticação e formato de payload
3. Referenciar o schema de `/schemas/` correspondente
