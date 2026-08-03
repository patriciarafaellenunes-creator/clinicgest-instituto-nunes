# ClinicGest — Frontend

React + Vite. Cobre login, criação de clínica (bootstrap), painel financeiro
e pacientes com dados reais. Os demais módulos do sistema (agenda, CRM,
orçamentos, estoque, prontuário, documentos etc.) já têm API funcionando e
testada no backend, mas ainda não têm tela própria — aparecem no menu como
"em construção", com o endpoint indicado, em vez de escondidos.

## Rodando localmente

```bash
npm install
npm run dev     # http://localhost:5173, com proxy pra API em localhost:3000
```

Precisa do backend rodando (`cd .. && npm start`) — o Vite só faz proxy das
chamadas `/api/*`, não substitui o servidor.

Se o backend estiver em outro host/porta:
```bash
VITE_API_URL=http://seu-backend:3000 npm run dev
```

## Build de produção

```bash
npm run build    # gera dist/ — testado, builda limpo
npm run preview  # serve o build de produção localmente pra conferir
```

Servir `dist/` é responsabilidade sua (nginx, Vercel, qualquer host
estático) — ele precisa conseguir alcançar a API em produção, então ajuste
a configuração do seu proxy reverso ou `VITE_API_URL` no momento do build.

## O que foi testado de verdade

O fluxo completo — login através do proxy do Vite, chamando o backend real
(Postgres com RLS ativo, exatamente a configuração de produção descrita no
README do backend) — foi testado com `curl` simulando as mesmas chamadas
que o `api/client.js` faz: login retorna token válido com permissões,
`GET /api/financial/dashboard` retorna os dados zerados corretos pra uma
clínica nova, `GET /api/patients` retorna lista vazia, e
`POST /api/patients` cria um paciente de verdade. Não é um teste
automatizado permanente (não há Postgres neste ambiente de desenvolvimento
por padrão, como explicado no README do backend), mas confirma que a
integração frontend → proxy → backend → banco funciona de ponta a ponta,
não só no papel.

## Design

Paleta e tipografia próprias (ver `src/styles/global.css`): verde-petróleo
como cor de marca (não o azul-SaaS genérico, não o terracota que já é
clichê de interface gerada por IA), papel quente como fundo, Fraunces para
títulos + Inter pro corpo + IBM Plex Mono pros números financeiros. O
elemento de assinatura visual é o bloco de "ação imediata" no painel — uma
aba colorida na lateral, como um divisor de ficha de prontuário de papel.
