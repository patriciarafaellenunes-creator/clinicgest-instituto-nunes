# ClinicGest — Sistema completo (Fase 1 + Fase 2) + Autenticação real + Frontend

Financeiro, Pacientes, Agenda, CRM de Leads, Orçamentos, Estoque, Compras/
Fornecedores, prontuário eletrônico completo (anamnese, evolução,
odontograma, periodontograma, plano de tratamento, prescrições, exames,
arquivos), contratos e assinatura eletrônica completos (central de
documentos, biblioteca de termos, contratos de profissionais/laboratórios/
fornecedores, automação documental), laboratórios/próteses, comissões, dois
agentes de IA (financeiro e documental), autenticação real, geração de PDF,
e agora um frontend React — **tudo implementado, integrado e testado**. 23
suítes de teste no backend (`api/`), todas rodando contra o **schema real**
(`02-schema-mvp.sql`), mais um teste de integração de ponta a ponta contra
um Postgres real.

## Frontend (React + Vite)

Fica em `frontend/` — projeto próprio, com seu próprio `package.json` e
README. Cobertura real: login, criação de clínica (bootstrap), painel
financeiro (saldo, faturamento, projeção de caixa, inadimplentes) e
pacientes (busca + cadastro, com o aviso de duplicidade do backend
aparecendo na tela). Os outros ~13 módulos do sistema aparecem no menu
lateral como "em construção" com o endpoint indicado — a API já existe e
funciona, só falta a tela.

**Testado de ponta a ponta contra o Postgres real** (a mesma instância
usada para validar o RLS): subi backend e frontend juntos, e simulei com
curl exatamente as chamadas que o `api/client.js` do React faz — login
através do proxy do Vite retornando token válido, dashboard retornando os
números certos pra uma clínica nova, cadastro de paciente funcionando de
verdade. Além do `npm run build` limpo, o fluxo real de dados através do
proxy, contra o banco com RLS ativo, foi confirmado.

O restante deste documento é o histórico de construção módulo por módulo do
**backend**, na ordem em que foi desenvolvido — mantido porque documenta as
decisões de design e os bugs reais encontrados no caminho (não só o estado
final).

## Fase 2 — Prontuário Eletrônico (em andamento)

Esta é a parte que exige mais cuidado do sistema inteiro: nada pode ser
apagado ou alterado silenciosamente, porque o prontuário tem valor jurídico.
A regra de segurança do documento 2 do briefing ("correções devem gerar uma
nova versão, mantendo o registro original na auditoria") foi implementada
como **impossibilidade estrutural**, não como convenção:

**Anamnese** — cada atualização cria uma nova versão (`clinical_anamnesis`).
A versão anterior nunca é editada, só marcada como não-atual
(`is_current = false`) e preservada. Testei criando duas versões e
confirmando que a primeira continua com o texto original intacto depois da
segunda ser criada.

**Evolução clínica** — cada atendimento gera um registro. "Corrigir" uma
evolução **não edita a linha existente** — cria uma linha nova apontando
para a original (`supersedes_id`) e marca a original como não-atual. Não
existe nenhuma função no código que faça `UPDATE` no texto de uma evolução
já criada. Testei: correção gera um registro com ID diferente, o texto
original permanece intacto, e tentar corrigir uma versão que já foi
substituída é bloqueado (`NOT_CURRENT_VERSION`) — só dá pra corrigir a
versão vigente, preservando a cadeia completa.

**Alertas clínicos integrados à Agenda** — se a anamnese atual tem alertas
(ex: uso de anticoagulante) ou classificação de risco alta, esses alertas
aparecem automaticamente ao agendar uma consulta para o paciente, junto com
o alerta financeiro que já existia. Testado de ponta a ponta.

**Odontograma** — cada dente/face é um "slot" versionado com a mesma
imutabilidade da evolução clínica. Testei: cárie registrada no dente 26/face
oclusal → depois tratada com restauração → o histórico mostra as duas
versões encadeadas, o odontograma **atual** mostra só a restauração, mas a
cárie original continua intacta na cadeia. Também tem **reconstrução do
odontograma em qualquer data do passado** e **comparação entre dois
momentos** (usando `DISTINCT ON` para pegar, por dente/face, a versão mais
recente até aquela data — sem precisar duplicar dados em snapshots).

**Periodontograma** — cada visita gera um exame completo (múltiplas medições
por dente/sítio: profundidade de sondagem, sangramento, recessão,
mobilidade, furca, placa, supuração). Testei um cenário real de progressão
de doença periodontal: sítio com 3mm sem sangramento na primeira visita,
6mm com sangramento seis meses depois — a comparação entre os dois exames
identifica exatamente esse sítio, calcula o delta (+3mm) e classifica como
"progressão". Correção de um exame segue a mesma regra de imutabilidade:
gera um exame novo encadeado, o original nunca é alterado.

**Plano de tratamento clínico** — a ponte entre prontuário e financeiro.
Diferente do orçamento (que é sobre dinheiro), o plano é sobre sequência e
prioridade clínica: fases, ordem recomendada, se precisa de laboratório,
alternativas de tratamento. O paciente decide **item a item** (aceito ou
recusado, com motivo obrigatório na recusa). Testei o fluxo completo: plano
com restauração (aceita) e implante (recusado, "vai avaliar em outra
clínica"), convertido em orçamento — **o orçamento gerado tem só a
restauração, R$400, o implante recusado não entra**. A conversão reaproveita
o `budgetsService` da Fase 1 inteiro (mesmo cálculo, mesma validação de
desconto), só filtrando os itens aceitos antes — sem duplicar lógica
financeira dentro do módulo clínico.

**Exames e diagnóstico** — mesmo padrão de imutabilidade, com um diferencial:
um exame pode ser vinculado a um item específico do plano de tratamento
(fechando o ciclo achado → hipótese diagnóstica → decisão de tratamento).
Testei vincular uma radiografia a um item de tratamento endodôntico,
corrigir o diagnóstico depois (sem apagar o achado original), e confirmar
que o exame substituído some da listagem "atual" mas continua no banco.

**Arquivos do paciente** — metadados de arquivos (o arquivo em si fica em
object storage, fora do MVP). Regra dura: **não existe exclusão física em
nenhum lugar do código** — só exclusão lógica, com motivo obrigatório, e o
registro nunca some do banco (testei e confirmei que ele continua lá mesmo
"excluído"). Também rastreia autorização de uso de imagem por arquivo —
testei registrar uma foto sem autorização, ela aparece na checagem de
pendências, autorizo, ela some da lista.

**Com isso, o documento 2 do briefing (prontuário eletrônico) está 100%
implementado**: anamnese, evolução clínica, odontograma, periodontograma,
plano de tratamento, prescrições/atestados, exames e diagnóstico, arquivos
do paciente — todos com o mesmo padrão de segurança (sem alteração
silenciosa, sem exclusão física, correção sempre em cadeia auditável).

## Fase 2 — Documento 3 (Contratos, Termos e Assinatura Eletrônica)

**Central de documentos genérica implementada** — o núcleo que serve
contratos e termos de paciente, profissional, laboratório e fornecedor
através de um único modelo (`documents` + `document_signatures`), em vez de
4 estruturas separadas. Regras testadas de ponta a ponta:

- **Assinatura parcial vs. completa**: um documento com 2 signatários fica
  `parcialmente_assinado` depois do primeiro, e só vira `assinado`
  automaticamente quando o último assina. Cada assinatura gera um código de
  validação.
- **Trava após assinatura completa** — a regra mais importante do módulo:
  testei tentar editar e tentar assinar de novo um documento já totalmente
  assinado, e os dois foram bloqueados (`DOCUMENT_LOCKED`). O único caminho
  pra mudar algo é `reviseDocument`, que cria uma versão nova encadeada — a
  versão assinada original nunca é tocada.
- **Checagem de documento obrigatório antes de procedimento**: cadastrei um
  modelo de termo marcado como obrigatório para "Implante". Antes de existir
  o documento assinado, a checagem bloqueia; depois de assinado, libera —
  isso é o gancho pronto pra automação "ao iniciar o atendimento, bloquear o
  procedimento se faltar documento obrigatório" (seção 11 do documento 3).
- **Consultas para automação/agente de IA**: assinaturas pendentes por
  paciente, documentos vencendo em N dias — as mesmas perguntas que o
  agente documental da seção 13 do briefing precisa responder.

**Contratos de profissionais** (seção 4) — usa a central de documentos
(`partyType: 'professional'`) mais uma tabela própria para dados que o
**sistema** precisa consultar, não só um humano ler: especialidades e
procedimentos autorizados, tipo de remuneração, percentual de comissão. A
regra mais importante — "o aplicativo deve impedir que um profissional seja
escalado para procedimentos ou especialidades não autorizados" — está
implementada como **bloqueio real na Agenda**, não como alerta.

Isso pegou um bug de integração de verdade durante o teste: a primeira
versão checava autorização só por `procedureId`, mas o contrato de teste
restringia por **especialidade** — o bloqueio simplesmente não disparava,
porque ninguém buscava a especialidade do procedimento antes de checar. Só
apareceu porque o teste validava o cenário de ponta a ponta (contrato
assinado → tentativa de agendamento fora da especialidade → deveria
bloquear) em vez de testar as funções isoladas. Corrigido: a agenda agora
busca a especialidade do procedimento antes de checar autorização. Também
confirmei que um contrato **em rascunho não bloqueia nada** — só o assinado
vale — e que profissionais sem nenhum contrato cadastrado não são afetados
(evita travar clínicas que ainda não migraram os contratos pro sistema).

**Contratos de laboratório e fornecedor** (seções 5-6) — reaproveitam a
tabela `suppliers` já existente desde a Fase 1: um laboratório é a mesma
entidade cadastral que um fornecedor (razão social, CNPJ, contatos), o que
muda é a categoria do documento e os termos estruturados do contrato (prazo
de entrega, garantia, política de refazimento, tabela de preços). Testei um
cenário realista: uma mesma empresa que presta serviço de laboratório de
próteses **e** vende material de escritório — dois contratos distintos, com
categorias diferentes, cada um com seu próprio ciclo de assinatura
independente. Confirmei que assinar o contrato de laboratório não faz o de
fornecedor aparecer como "ativo" (e vice-versa) — são rastreados
separadamente mesmo sendo a mesma empresa.

### Documento 3 — 100% completo

**Automação documental** (seção 11) — a peça final que liga tudo: aprovar
um plano de tratamento agora **gera automaticamente**, como rascunho, os
termos de consentimento ainda faltantes para os procedimentos aceitos pelo
paciente (usando a biblioteca de termos). A automação **nunca assina
sozinha** — isso continua exigindo uma pessoa. Testei o fluxo completo:
plano aceito → aprovado → termo de endodontia gerado automaticamente com o
nome do paciente já preenchido → aprovar de novo não duplica nada
(idempotente) → assinar o termo gerado (por uma pessoa) libera o
procedimento. Também tem notificação automática de contratos vencendo,
idempotente por documento (não spama a mesma notificação toda vez que roda).

**Agente de IA documental** (seção 13) — mesmo princípio do agente
financeiro: só responde através de ferramentas somente leitura, nunca
inventa. Sete ferramentas cobrindo as perguntas do briefing: assinaturas
pendentes, contratos vencendo, quais procedimentos exigem termo específico,
fornecedores/laboratórios sem contrato vigente, pacientes sem autorização de
uso de imagem, agendamentos com documentação incompleta, e autorização de um
profissional para um procedimento. Testado com dados reais (grounding) e com
um mock da API validando o loop de orquestração de ponta a ponta — igual ao
agente financeiro, sem acesso à API real neste ambiente de desenvolvimento.

Durante o teste, o pg-mem (simulador usado nos testes) rejeitou uma consulta
`NOT EXISTS` correlacionada que o PostgreSQL real aceitaria sem problema —
reescrita como `LEFT JOIN ... WHERE x IS NULL`, que é mais portável e
funciona igual nos dois. Vale mencionar porque é o tipo de ajuste que só
aparece rodando teste de verdade, não lendo o código.

**Com isso, o documento 3 do briefing original está funcionalmente
completo**: central de documentos, biblioteca de termos, contratos de
profissionais (com bloqueio real), contratos de laboratório/fornecedor,
automação documental e agente de IA documental — todos integrados e
testados. As únicas partes que ficam de fora são integrações externas
(assinatura eletrônica com certificado real, geração de PDF) e as "abas por
especialidade" (seção 7), que são majoritariamente estrutura de frontend.

## Fase 1 (100% completa) — resumo

**Financeiro** — contas a pagar/receber, fluxo de caixa, projeção, dashboard,
auditoria automática. **Pacientes** — cadastro com deduplicação.
**Agenda** — conflitos, alertas (financeiro + clínico). **CRM** — funil de
14 etapas. **Orçamentos** — aprovação gera contrato/parcelas/contas a
receber automaticamente. **Estoque** — custo médio ponderado, ficha técnica
por procedimento. **Compras** — recebimento gera estoque + conta a pagar.
**Agente de IA** — tool use somente leitura sobre os services acima.

## Estrutura

```
src/
  services/
    financialService.js, patientsService.js, agendaService.js,
    leadsService.js, budgetsService.js, inventoryService.js,
    purchasingService.js, aiAgentService.js, auditService.js
    clinicalRecordsService.js   → Fase 2: anamnese + evolução clínica
    odontogramService.js        → odontograma versionado por dente/face
    periodontalService.js       → exames periodontais + comparação de progressão
    treatmentPlanService.js     → plano clínico → conversão em orçamento real
    clinicalDocumentsService.js → receitas, atestados, encaminhamentos
    clinicalExamsService.js     → NOVO: exames e diagnóstico versionados
    patientFilesService.js      → metadados de arquivos, exclusão lógica
    documentsService.js         → central de documentos/contratos/assinatura
    termsLibraryService.js      → catálogo de termos + instanciação
    professionalContractService.js → autorização + comissão de profissionais
    supplierContractService.js  → contratos de laboratório/fornecedor
    documentAutomationService.js → NOVO: geração automática de termos
    documentAgentService.js     → agente de IA documental
    labOrderService.js          → laboratórios/próteses
    commissionService.js        → cálculo de comissão
    authService.js               → NOVO: bootstrap de clínica + login real
  routes/
    auth.js   → NOVO (única rota sem requireAuth)
    financial.js, patients.js, agenda.js, leads.js, budgets.js,
    inventory.js, agent.js, purchasing.js
    clinicalRecords.js, odontogram.js, periodontal.js, treatmentPlans.js,
    clinicalDocuments.js, clinicalExams.js, patientFiles.js
    documents.js, termsLibrary.js, professionalContracts.js,
    supplierContracts.js, documentAutomation.js
    labOrders.js, commissions.js
  db/pool.js       → withClient, withTenantClient, setTenantContext (RLS)
  middleware/auth.js, index.js
03-row-level-security.sql   → NOVO: policies de RLS (não testado por pg-mem, ver nota acima)
test/
  auth.test.js                → NOVO: bootstrap + login + JWT + desambiguação
  (21 suítes anteriores, sem alteração)
```

## Rodando localmente

```bash
npm install
cp .env.example .env   # ajuste Postgres, JWT_SECRET, e adicione sua ANTHROPIC_API_KEY
psql -f ../02-schema-mvp.sql seu_banco             # aplica o schema
psql -f ../03-row-level-security.sql seu_banco     # aplica o RLS (opcional em dev, recomendado em produção)
npm start                # sobe a API em http://localhost:3000
npm test                 # roda as 22 suítes de teste (não precisa de Postgres nem de API key)
```

Se aplicar o RLS, crie as duas roles antes de conectar a aplicação (senão
nenhuma query autenticada vai retornar dados — RLS bloqueia por padrão):
```sql
CREATE ROLE app_user LOGIN PASSWORD 'sua-senha';
CREATE ROLE auth_service_user LOGIN PASSWORD 'sua-outra-senha' BYPASSRLS;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, auth_service_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user, auth_service_user;
```

Para validar o RLS de ponta a ponta contra o seu próprio Postgres (o mesmo
teste que rodei aqui durante o desenvolvimento):
```bash
PGUSER=app_user PGPASSWORD=sua-senha AUTH_PGUSER=auth_service_user AUTH_PGPASSWORD=sua-outra-senha \
  node test-integration/rls-real-postgres.test.js
```

Para usar o sistema de verdade pela primeira vez:
```bash
curl -X POST http://localhost:3000/api/auth/bootstrap-clinic \
  -H "Content-Type: application/json" \
  -d '{
    "companyLegalName": "Sua Clínica LTDA",
    "clinicName": "Sua Clínica",
    "ownerFullName": "Seu Nome",
    "ownerEmail": "voce@suaclinica.com",
    "ownerPassword": "umasenhaforte123"
  }'

curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "voce@suaclinica.com", "password": "umasenhaforte123"}'
# o token retornado vai no header Authorization: Bearer <token> de todas as outras rotas
```

## Fase 2 — módulos operacionais finais (100% completos)

**Laboratórios e próteses** — rastreamento de trabalhos enviados a
laboratórios, com os 11 status do briefing (solicitação → moldagem →
enviado → produção → prova → ajuste → recebido → instalado → finalizado).
**Detecção automática de atraso** (previsão de entrega vencida e ainda não
recebida) — testei um trabalho com entrega prevista no passado e ele
aparece no alerta corretamente, já com nome do paciente e do laboratório.
**Finalizar o trabalho gera a conta a pagar de verdade**, mesma filosofia
de `purchasingService`: nada duplicado, testei tentar finalizar duas vezes
e o sistema bloqueia.

**Comissões** — cálculo de comissão sobre recebimento real (não sobre
promessa de venda), ligando contratos de profissionais ao financeiro. A
exigência do briefing de "evitar pagamento duplicado" virou uma **garantia
de banco de dados**, não só lógica de aplicação: `commission_payout_items.
accounts_receivable_id` tem constraint UNIQUE, então mesmo que a query de
elegibilidade tivesse um bug, o banco rejeitaria a duplicata. Testei o
cenário completo: profissional com contrato de 30% de comissão sobre
recebimento → paciente paga R$1.000 de um procedimento dela → apuração
calcula R$300 de comissão certinho → **calcular de novo no mesmo período
não encontra mais nada elegível** (o recebimento já foi usado) → aprovar →
pagar gera uma conta a pagar real de R$300 para ela.

**Com isso, todos os módulos mapeados no plano mestre para a Fase 2 estão
completos**: prontuário eletrônico, contratos/assinatura eletrônica,
laboratórios/próteses e comissões.

## Status geral do projeto

**Fase 1 (MVP core, seção 26 do briefing): 100% completa.**
**Fase 2 (prontuário + contratos + laboratórios + comissões): 100% completa.**

22 suítes de teste, todas rodando contra o schema real do PostgreSQL (via
pg-mem), cobrindo desde as regras de negócio mais simples até as
integrações mais complexas — o exemplo mais completo é a cadeia: aprovar um
plano de tratamento → gera termo de consentimento automaticamente → paciente
assina → procedimento libera na agenda → profissional só é escalado se o
contrato dela autorizar aquela especialidade → dinheiro recebido do
procedimento → apurado como comissão → vira conta a pagar pra ela.

## Autenticação real (última lacuna crítica, agora fechada)

O `middleware/auth.js` sempre validou um JWT — mas até agora nada no
sistema **emitia** um. Isso fechava um buraco de "ovo e galinha": não havia
como criar o primeiro usuário sem já ter um token, e não havia token sem já
ter um usuário.

**`POST /api/auth/bootstrap-clinic`** cria a primeira empresa, clínica,
unidade, o perfil "Proprietário" (com todas as 35 permissões do sistema) e
o primeiro usuário, numa única transação. **`POST /api/auth/login`** verifica
e-mail/senha (hash bcrypt, nunca texto puro) e emite um JWT de verdade, já
com as permissões resolvidas — o mesmo formato que `middleware/auth.js`
espera.

Alguns cuidados testados especificamente:
- **Senha errada e e-mail inexistente retornam a mesma mensagem de erro**
  (`INVALID_CREDENTIALS`) — não dá pra descobrir se um e-mail está
  cadastrado só tentando logar com senhas erradas.
- **Hash da senha nunca aparece em nenhuma resposta**, nem no bootstrap nem
  no login.
- **Mesmo e-mail em clínicas diferentes** (o schema permite, já que a
  unicidade é por `clinic_id + email`, não global) exige informar
  `clinicId` explicitamente para desambiguar — evita logar na clínica
  errada por coincidência de e-mail.

### Bug real de schema encontrado e corrigido

Escrever o teste de autenticação (a primeira vez que algo de fato insere em
`user_roles`) revelou um bug que existia desde a Fase 1: a tabela tinha
`PRIMARY KEY (user_id, role_id, unit_id)` com `unit_id` **nullable** — e
`unit_id = NULL` era o valor pretendido para "usuário tem a role em todas as
unidades". Isso é inválido em SQL padrão (colunas de chave primária não
podem ser nulas) e teria falhado em produção também, não só no pg-mem.
Corrigido: `user_roles` agora tem um `id` próprio como chave primária, e
`UNIQUE (user_id, role_id, unit_id)` para a regra de negócio — que
corretamente permite múltiplos `NULL` em `unit_id`. Rodei as outras 22
suítes depois da correção; nenhuma regressão, porque nada mais no sistema
inseria nessa tabela ainda.

**Nota de segurança sobre `bootstrap-clinic` em produção:** esse endpoint
fica aberto sem autenticação de propósito (é o único jeito de começar), mas
isso significa que qualquer pessoa que o encontrar pode criar uma clínica.
Antes de produção, isso precisa de alguma proteção — rate limiting,
aprovação manual, convite, ou desativar a rota depois do primeiro uso.

## Row-Level Security (implementado E validado contra um Postgres real)

Diferente de tudo mais neste projeto, RLS não podia ser testado via pg-mem
— **o simulador usado nas 22 suítes de teste não implementa
`ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, nem `current_setting`/
`set_config`**. Confirmei isso antes de escrever qualquer coisa, pra não
colocar SQL inválido no meio do schema principal.

Em vez de deixar isso como uma pendência documentada, **consegui instalar
um PostgreSQL 16 real neste ambiente de desenvolvimento** (não estava
disponível inicialmente) e validei tudo de ponta a ponta — o que revelou
**dois bugs reais** que só apareceriam em produção, não em teste unitário:

**Bug 1 — bootstrap-clinic quebrava com RLS ativo.** Criar uma clínica nova
insere em `units`/`roles`/`users`, todas protegidas por RLS — mas não existe
contexto de clínica pra definir antes da clínica existir (ela está sendo
criada nessa mesma transação). Corrigido: `authService.bootstrapClinic`
agora define o contexto de sessão pro `clinic.id` recém-criado logo depois
de inserir a clínica, antes de tocar qualquer tabela protegida.

**Bug 2 — login precisa buscar por e-mail sem saber a clínica** (é
literalmente o propósito da consulta), o que é estruturalmente incompatível
com uma role de aplicação comum sob RLS. A solução não foi abrir uma
política permissiva nas tabelas de identidade (isso vazaria a possibilidade
de qualquer usuário autenticado listar usuários de outras clínicas) — foi
criar uma **segunda credencial de banco**, com o atributo `BYPASSRLS`,
usada exclusivamente por login e bootstrap. Todas as outras 21 rotas
continuam usando a role comum, sem esse privilégio.

**O que foi validado de verdade, contra Postgres 16, com dados reais:**
- Duas clínicas com um paciente cada; `app_user` (role sem privilégio
  elevado) só enxerga o paciente da clínica ativa no contexto da sessão.
- Trocar de clínica na mesma conexão troca os dados visíveis — sem vazar
  nada da anterior.
- `INSERT` tentando gravar `clinic_id` de outra clínica é **rejeitado pelo
  banco** (`WITH CHECK`), não silenciosamente ignorado.
- Sem contexto de clínica definido, toda leitura retorna zero linhas.
- **Reaproveitamento de conexão do pool não vaza contexto entre
  requisições** — testei especificamente se uma conexão que acabou de
  atender a Clínica B, reaproveitada numa chamada sem `clinicId`, herdaria
  os dados da B por engano. Não herda: falha com erro, não com vazamento.
- O fluxo completo (bootstrap → login → operação autenticada) funcionando
  com as duas credenciais reais, exatamente como rodaria em produção.

Isso está registrado permanentemente em
`test-integration/rls-real-postgres.test.js` — diferente das 22 suítes em
`test/`, este não roda contra pg-mem; precisa de um Postgres de verdade
(instruções de setup no topo do próprio arquivo). `03-row-level-security.sql`
termina com o checklist completo, agora marcado como validado, não só
escrito.

## Geração de PDF (documentos e receitas viram arquivo de verdade)

Fecha a lacuna "documentos existem como texto estruturado, falta
renderizar como PDF". Usa `pdf-lib` (JS puro, sem sidecar Python) para
gerar PDFs reais a partir dos dados que já existem em `documentsService`
(contratos/termos, com bloco de assinaturas) e `clinicalDocumentsService`
(receitas, atestados, encaminhamentos etc.).

Dois novos endpoints:
- `GET /api/documents/:id/pdf` — contrato ou termo, com nome do
  paciente/profissional/fornecedor resolvido automaticamente e o status de
  cada assinatura (assinado/pendente/recusado, com data e código de
  validação quando aplicável).
- `GET /api/clinical-documents/documents/:id/pdf` — receita, atestado,
  declaração etc., com o conteúdo específico de cada tipo renderizado
  corretamente (lista de medicamentos numa receita, dias de afastamento e
  motivo num atestado).

**Testado de verdade, não só "parece um PDF"**: o teste gera cada tipo de
documento e depois **extrai o texto de volta** do PDF binário para
confirmar que os dados reais estão lá — nome da paciente, número do
documento, status de cada assinatura, código de validação, cada
medicamento com sua dosagem específica, motivo de cancelamento. Também
testei quebra de página automática com um texto longo (300 repetições de
um parágrafo) e confirmei que nenhuma palavra se perde na transição entre
páginas — minha primeira estimativa de "quanto texto força a quebra" estava
errada (120 repetições ainda cabiam numa página só), o teste pegou isso e
corrigi para 300.

## O que falta para produção

- **Rodar o checklist de `03-row-level-security.sql` no SEU banco de
  produção** — validei a lógica e a arquitetura contra um Postgres 16 real
  neste ambiente de desenvolvimento, mas as roles/credenciais de produção
  são suas, e vale confirmar lá também antes de ir ao ar.
- **Integrações externas**: assinatura eletrônica com certificado real
  (ICP-Brasil ou plataforma como serviço), geração de PDF (✓ já feito),
  WhatsApp/e-mail para lembretes automáticos — ver `INTEGRATIONS.md` para
  o guia completo de como plugar cada uma, com os pontos exatos do código
  já preparados para receber a integração.
- **Frontend**: tudo o que existe até aqui é a API — não há nenhuma
  interface.
- **Proteção do endpoint de bootstrap**: rate limiting, aprovação manual ou
  desativação após o primeiro uso (ver nota de segurança acima).
- **Revisão jurídica**: prontuário e termos precisam de validação por
  profissional habilitado antes de uso definitivo em produção.

## Próximo passo sugerido

Com autenticação real, row-level security implementado e **validado contra
um Postgres de verdade**, o backend está funcionalmente completo e testado
para todos os módulos do briefing original — incluindo a camada de
segurança que normalmente fica só na promessa. As frentes que restam
(frontend, integrações externas de assinatura/PDF/WhatsApp) são projetos de
outra natureza inteiramente.
