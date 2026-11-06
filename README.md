# BarberApp — Zé Barbeiro

Sistema web de agendamento para barbearias. Clientes reservam horários com o barbeiro e o serviço desejados; barbeiros gerenciam a própria agenda; o administrador mantém o cadastro de barbeiros e serviços e acompanha todos os atendimentos.

Back-end em **Node.js + Fastify**, com dados, login e fotos no **Supabase** (PostgreSQL, Auth e Storage), validação com **Zod** e relatórios em PDF (**pdfkit**) e Excel (**ExcelJS**). O front-end é HTML, CSS e JavaScript (módulos ES) com Bootstrap via CDN.

## Sumário

- [Funcionalidades](#funcionalidades)
- [Como executar](#como-executar)
- [Supabase](#supabase)
- [Usuários de demonstração](#usuários-de-demonstração)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Identidade visual](#identidade-visual)
- [Arquitetura](#arquitetura)
- [API](#api)
- [Regras de negócio](#regras-de-negócio)
- [Segurança](#segurança)
- [Testes](#testes)
- [Configuração](#configuração)

## Funcionalidades

| Perfil | O que pode fazer |
| --- | --- |
| **Cliente** | Criar conta, escolher o serviço e ver os barbeiros (com foto) que têm horários livres na data, agendar, cancelar agendamentos futuros e consultar o histórico. |
| **Barbeiro** | Acompanhar o próprio painel de indicadores, exportar os próprios relatórios em PDF e Excel, ver a agenda do dia, incluir atendimentos manualmente (informando o nome do cliente), bloquear horários, concluir atendimentos e consultar o histórico. |
| **Administrador** | Acompanhar o painel com gráficos e destaques da barbearia, consultar e exportar relatórios de todos os barbeiros (PDF e Excel), cadastrar e editar barbeiros (foto, dias, horários e serviços) e serviços; consultar a agenda e o histórico de qualquer barbeiro. |

Todos os perfis têm a página **Minha conta**, onde editam nome, celular, nascimento e e-mail (a troca de e-mail exige a senha atual) e alteram a senha. Barbeiros também trocam a própria foto por ali.

## Como executar

Pré-requisitos: **Node.js 20.12 ou superior** e um projeto no [Supabase](https://supabase.com) (o plano gratuito atende).

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie o banco no Supabase (veja [Supabase](#supabase)) e copie `.env.example` para `.env`, preenchendo `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.

3. (Opcional) Carregue os dados de exemplo:

   ```bash
   npm run db:seed
   ```

4. Inicie:

   ```bash
   npm start
   ```

Acesse <http://127.0.0.1:3000>. O login fica em `/login.html` e o cadastro de clientes em `/cadastro.html`.

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia o servidor e reinicia automaticamente ao salvar arquivos. |
| `npm test` | Executa os testes automatizados (não precisa de Supabase). |
| `npm run db:seed` | Cria usuários, serviços, barbeiros e agendamentos de exemplo no Supabase. Pode ser executado de novo sem duplicar dados. |

## Supabase

A aplicação usa três recursos do Supabase:

| Recurso | Uso |
| --- | --- |
| **PostgreSQL** | Tabelas `perfis`, `servicos`, `barbeiros`, `barbeiro_servicos` e `agendamentos`. |
| **Auth** | E-mail e senha de todos os usuários, sessões (access token + refresh token). |
| **Storage** | Bucket público `fotos-barbeiros`, só leitura pela URL. |

### Criando o banco

O esquema completo está em [`supabase/migrations/20261106120000_esquema_inicial.sql`](supabase/migrations/20261106120000_esquema_inicial.sql) (tabelas, restrições, índices, RLS, funções e o bucket de fotos). Use uma das opções:

- **Painel**: abra *SQL Editor*, cole o conteúdo do arquivo e execute.
- **Supabase CLI**: `npx supabase link --project-ref <ref>` e depois `npx supabase db push`.

### Ajustes no painel

- *Authentication → Sign In / Providers → Email*: **desative "Allow new users to sign up"**. Os cadastros são feitos pela API (que valida idade mínima, celular etc.) com a chave de serviço, então o cadastro público direto no Supabase não é necessário e só abriria uma porta para contornar as regras.
- *Authentication → Sessions* (opcional): ajuste a duração do access token (padrão: 1 hora). O site renova a sessão automaticamente com o refresh token.

### Chaves

Em *Project Settings → API Keys*:

- `SUPABASE_ANON_KEY`: chave **anon** (ou *publishable*).
- `SUPABASE_SERVICE_ROLE_KEY`: chave **service_role** (ou *secret*). Ela ignora o RLS: fica **somente no servidor**, no `.env`, nunca no front-end nem no Git.

### Criando o primeiro administrador

O `npm run db:seed` já cria `adm@adm.com.br`. Para promover outro usuário (depois de ele criar a conta pelo site), rode no *SQL Editor*:

```sql
update public.perfis set perfil = 'administrador' where email = 'pessoa@exemplo.com';
```

## Usuários de demonstração

Criados pelo `npm run db:seed`. Todos usam a senha **`barber123`** (ou o valor de `SEED_PASSWORD`).

| Perfil | E-mail |
| --- | --- |
| Administrador | `adm@adm.com.br` |
| Barbeiro | `barbeiro@barbeiro.com.br` |
| Cliente | `cliente@cliente.com.br` |

> Troque as senhas antes de usar o sistema com dados reais.

## Estrutura do projeto

```text
.
├── data/seed.json              # Dados de exemplo usados pelo npm run db:seed
├── public/                     # Front-end servido estaticamente
│   ├── css/                    # base, app (área logada), auth, landing
│   ├── img/
│   ├── js/
│   │   ├── core/               # API (com renovação de sessão), sessão, DOM, formulários, formatação
│   │   ├── components/         # app-shell, crud-page, history-page, gráficos, filtros...
│   │   └── pages/              # Um módulo por página
│   └── *.html
├── scripts/seed.js             # Dados de exemplo no Supabase
├── server/
│   ├── auth/rate-limiter.js    # Limite de tentativas de login (IP + e-mail)
│   ├── domain/                 # Regras puras: horários, agenda, perfis, idade mínima
│   ├── http/errors.js          # Erros com status HTTP e mensagem para o usuário
│   ├── infra/supabase/         # Adaptadores: repositórios (Postgres), identidade (Auth), fotos (Storage)
│   ├── reports/                # PDF (pdfkit) e Excel (ExcelJS)
│   ├── services/               # Casos de uso por recurso
│   ├── app.js                  # Composição do Fastify (segurança, erros, rotas, estáticos)
│   ├── config.js               # Variáveis de ambiente validadas com Zod
│   ├── index.js                # Ponto de entrada (liga os adaptadores do Supabase)
│   ├── routes.js               # Rotas e regras de acesso
│   └── schemas.js              # Esquemas Zod de todas as entradas
├── supabase/migrations/        # Esquema do banco (SQL)
└── test/
    ├── support/                # Adaptadores em memória (mesmo contrato do Supabase)
    └── *.test.js               # Testes com node:test
```

## Identidade visual

A interface usa a mesma atmosfera da página inicial: madeira escura, couro e latão.

| Token | Cor | Uso |
| --- | --- | --- |
| `--espresso` | `#1b130e` | Fundo |
| `--walnut` | `#251a13` | Painéis e modais |
| `--seam` | `#4a3628` | Bordas e divisores |
| `--brass` | `#c9a063` | Ações principais e destaques |
| `--ivory` | `#f3e9dc` | Texto |
| `--sand` | `#bfae9a` | Texto secundário |

- Títulos em serifa clássica (Palatino/Iowan, nativas do sistema, sem download de fontes) e textos em `system-ui`.
- Bootstrap no tema escuro (`data-bs-theme="dark"`) com as variáveis sobrescritas em `base.css`.
- Status dos atendimentos em selos coloridos (agendado, concluído, cancelado, bloqueado).
- Campos de valor com máscara de moeda (R$) e de telefone com máscara de celular.
- Campos obrigatórios marcados com asterisco e campos de senha com botão de olho para mostrar/ocultar.
- Confirmações usam um diálogo próprio (nada de `alert`/`confirm` do navegador) e as barras de rolagem ficam ocultas.
- Animações curtas: entrada da página, abertura de modais e menus, notificações e linhas da tabela após uma busca. Tudo é desativado com `prefers-reduced-motion`.
- Login e cadastro são páginas próprias, e não modais: têm URL própria, funcionam com o botão Voltar e com gerenciadores de senha, e recebem o usuário quando a sessão expira. O cadastro faz login automaticamente e leva direto ao agendamento.

## Arquitetura

```text
Navegador ──fetch──▶ Fastify (helmet, rate limit) ──▶ routes (perfil) ──▶ services (Zod + regras) ──▶ domain
                                                                              │
                                                     ┌────────────────────────┼─────────────────────────┐
                                                     ▼                        ▼                         ▼
                                              repos (Postgres)        identity (Auth)          photos (Storage)
                                                     └──────────────── Supabase ───────────────────────┘
```

- **Front-end**: cada página carrega um módulo de `js/pages`. O `app-shell` protege a página pelo perfil, monta o cabeçalho, o rodapé e os modais da conta. Nenhum dado da API é inserido como HTML. O cliente HTTP renova o access token sozinho quando ele expira.
- **Back-end**: os `services` concentram as regras de negócio e validam toda entrada com Zod; o `domain` contém funções puras e testáveis. Os serviços não conhecem o Supabase: recebem **repositórios**, **identidade** e **fotos** por injeção (portas e adaptadores). Em produção entram os adaptadores de `server/infra/supabase`; nos testes, versões em memória com o mesmo contrato.
- **O navegador nunca fala direto com o Supabase.** Toda leitura e escrita passa pela API, que usa a chave de serviço. Por isso o RLS fica ativo e **sem políticas** em todas as tabelas: as chaves públicas não acessam nada, mesmo que vazem.
- **Integridade no banco**: chaves estrangeiras, `check` para status, dias, expediente e valores, nome de serviço único (sem diferenciar maiúsculas) e um **índice único parcial** que impede dois agendamentos ativos no mesmo barbeiro/data/horário — a garantia final contra reserva dupla, mesmo com acessos simultâneos.
- **Dados**: datas em ISO (`AAAA-MM-DD`), horários `HH:MM`, valores em `numeric(10,2)` e IDs `uuid`.

## API

Todas as rotas ficam sob `/api`, recebem e devolvem JSON e, exceto login, renovação e cadastro, exigem o cabeçalho `Authorization: Bearer <token>` (o access token do Supabase Auth). Erros retornam `{ "erro": "mensagem" }` com o status HTTP adequado (400, 401, 403, 404, 409, 413, 415, 422, 429).

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| POST | `/auth/login` | público | Autentica e devolve `{ token, refreshToken, expiraEm, usuario }`. |
| POST | `/auth/refresh` | público | Troca o `refreshToken` por uma nova sessão. |
| POST | `/auth/logout` | autenticado | Encerra a sessão. |
| GET | `/auth/me` | autenticado | Dados do usuário logado. |
| PUT | `/auth/me` | autenticado | Edita nome, e-mail, celular e nascimento (trocar o e-mail exige `senhaAtual`). |
| PUT / DELETE | `/auth/me/foto` | barbeiro | O próprio barbeiro troca ou remove sua foto. |
| PUT | `/auth/senha` | autenticado | Altera a senha (`senhaAtual`, `novaSenha`). |
| POST | `/clientes` | público | Cadastro de cliente. |
| GET | `/barbeiros` | autenticado | Lista completa (admin) ou barbeiros ativos com seus serviços. |
| GET / POST / PUT | `/barbeiros[/:id]` | administrador | Consulta, cadastro e edição. |
| PUT / DELETE | `/barbeiros/:id/foto` | administrador | Envia (corpo binário JPG/PNG/WEBP, até 2 MB) ou remove a foto. |
| GET | `/servicos` | autenticado | Todos (admin) ou somente ativos. |
| POST / PUT | `/servicos[/:id]` | administrador | Cadastro e edição. |
| GET | `/agenda?barbeiroId=&data=` | barbeiro, administrador | Agenda completa do dia (barbeiro vê sempre a própria). |
| GET | `/disponibilidade?servicoId=&data=&barbeiroId=` | autenticado | Horários livres e futuros por barbeiro, sem dados de outros clientes. |
| GET | `/agendamentos?inicio=&fim=&situacao=&barbeiroId=` | autenticado | Histórico (`situacao`: `pendentes` ou `concluidos`). |
| POST | `/agendamentos` | cliente, barbeiro | Reserva (cliente); atendimento manual com cliente e serviço, ou bloqueio (barbeiro). |
| PATCH | `/agendamentos/:id/concluir` | barbeiro | Conclui um atendimento. |
| GET | `/relatorios?inicio=&fim=&barbeiroId=` | barbeiro, administrador | Indicadores, gráficos, destaques e lista de atendimentos do período. |
| GET | `/relatorios/pdf?...` | barbeiro, administrador | Relatório em PDF com a identidade visual do site. |
| GET | `/relatorios/xlsx?...` | barbeiro, administrador | Planilha Excel com os dados para cálculos. |
| PATCH | `/agendamentos/:id/cancelar` | cliente, barbeiro | Cancela (o registro é mantido com status `Cancelado`). |

## Painel e relatórios

- **Painel** (`painel.html`): indicadores (faturamento, atendimentos concluídos, ticket médio e taxa de cancelamento, comparados ao período anterior de mesmo tamanho), gráficos de faturamento por dia, serviços, dias da semana, horários de pico e, para o administrador, faturamento por barbeiro, além de destaques escritos automaticamente.
- **Relatórios** (`relatorios.html`): os mesmos indicadores, desempenho por barbeiro e a lista de atendimentos, com exportação em **PDF** e **Excel**.
- **Escopo**: o administrador vê todos os barbeiros (ou filtra um); o barbeiro vê e exporta apenas os próprios dados — o servidor ignora qualquer tentativa de pedir dados de outro barbeiro.
- **PDF**: gerado no servidor com pdfkit, com cabeçalho no tom café, logo, detalhes em latão, cartões de indicadores, destaques e tabelas paginadas (cabeçalho repetido e "Página x de y").
- **Excel**: abas *Atendimentos*, *Por barbeiro* (administrador), *Por serviço* e *Por dia*; datas e valores são números de verdade (somas e tabelas dinâmicas funcionam direto), com cabeçalho fixo e filtro. Textos que começam com `=`, `+`, `-` ou `@` são neutralizados para não virarem fórmulas.
- O faturamento considera atendimentos **concluídos**. O valor do serviço é gravado no momento do agendamento, então mudar o preço depois não altera relatórios passados.

## Regras de negócio

- Os horários têm 30 minutos e vão do início do expediente até o último horário que **termina** dentro dele (ex.: 16:00–19:00 gera 16:00 … 18:30).
- Só é possível reservar em dias atendidos pelo barbeiro, dentro do expediente, em horários livres e que ainda não passaram.
- Reservas de vários horários são atômicas: ou todos são criados, ou nenhum.
- Clientes não veem a agenda dos barbeiros: apenas os horários livres e futuros para o serviço escolhido. Quem ocupa os demais horários nunca é exposto.
- Clientes cancelam apenas os próprios agendamentos futuros com status `Agendado`.
- O barbeiro inclui atendimentos digitando o nome do cliente (celular opcional; não precisa ter cadastro) e escolhendo um serviço que ele oferece. O horário fica ocupado na hora, o valor vem do serviço e o status é "Agendado pelo barbeiro".
- Barbeiros cancelam apenas bloqueios e atendimentos incluídos por eles, e só concluem atendimentos de hoje ou de datas anteriores.
- Cancelamentos liberam o horário e permanecem no histórico.
- Data de nascimento é obrigatória. Clientes precisam ter pelo menos 16 anos; para menores, o sistema orienta que um responsável faça o agendamento ou entre em contato com a barbearia.
- O "agora" considera o fuso `America/Sao_Paulo` (configurável).

## Segurança

- Senhas e sessões no **Supabase Auth** (hash bcrypt, tokens JWT de curta duração + refresh token). A API valida cada token no servidor de Auth, então sessões encerradas deixam de valer na hora.
- Logout encerra a sessão no Supabase; trocar a senha ou o e-mail encerra as demais sessões; a senha redefinida pelo administrador encerra todas as sessões do barbeiro.
- Trocar o e-mail ou a senha exige a senha atual.
- Autorização por perfil em todas as rotas, além de verificação de propriedade dos agendamentos (de outra pessoa responde 404).
- Limite de tentativas de login por IP + e-mail (só falhas contam) e limite geral de requisições por IP na API.
- Validação de toda entrada com **Zod** (campos desconhecidos são descartados, então ninguém consegue, por exemplo, se cadastrar como administrador); limite de tamanho do corpo.
- Chave de serviço apenas no servidor; RLS ativo sem políticas; funções SQL executáveis somente pela `service_role`.
- Cabeçalhos de segurança via `@fastify/helmet` (`Content-Security-Policy` sem scripts inline, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS em produção) e Bootstrap carregado com SRI.
- Apenas a pasta `public/` é servida (sem arquivos ocultos, como `.env`).
- Fotos: o navegador recorta e redesenha a imagem antes do envio (descartando metadados como GPS); o servidor valida o tipo pela assinatura do arquivo e o tamanho, e salva com nome aleatório. O bucket também restringe tipo e tamanho.
- Erros internos são registrados no log (sem o cabeçalho `Authorization`) e o usuário recebe apenas uma mensagem genérica.
- Front-end sem `innerHTML` com dados dinâmicos, eliminando XSS.

> Em produção, use HTTPS (por exemplo, atrás de um proxy reverso) com `NODE_ENV=production` e `TRUST_PROXY=true`.

## Testes

```bash
npm test
```

A suíte usa o executor nativo `node:test` e **não precisa de Supabase**: a API roda inteira com `app.inject` do Fastify e adaptadores em memória (`test/support/memory-adapters.js`) que seguem o mesmo contrato dos adaptadores reais. Cobre:

- funções de domínio (horários, datas, fuso, status), limite de tentativas e esquemas Zod;
- a API ponta a ponta: login, renovação e logout, cadastro (com desfazer do login no Auth se o perfil falhar), autorização por perfil, fotos, reservas, conflitos e reservas simultâneas, cancelamento, conclusão, histórico, relatórios, exportações, cabeçalhos de segurança e arquivos estáticos.

Para validar a integração com o Supabase de verdade, use um projeto de desenvolvimento (separado do de produção), rode `npm run db:seed` e navegue pelos fluxos principais.

## Configuração

Variáveis de ambiente (veja `.env.example`). São validadas na inicialização: se faltar algo obrigatório, o servidor não sobe e diz o que corrigir.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `SUPABASE_URL` | — | URL do projeto (`https://xxxx.supabase.co`). **Obrigatória.** |
| `SUPABASE_ANON_KEY` | — | Chave anon/publishable. **Obrigatória.** |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Chave service_role/secret (somente servidor). **Obrigatória.** |
| `SUPABASE_BUCKET_FOTOS` | `fotos-barbeiros` | Bucket das fotos dos barbeiros. |
| `NODE_ENV` | `development` | Use `production` em produção (ativa HSTS). |
| `HOST` | `127.0.0.1` | Endereço de escuta (`0.0.0.0` em contêineres). |
| `PORT` | `3000` | Porta HTTP. |
| `APP_TIMEZONE` | `America/Sao_Paulo` | Fuso usado para decidir se um horário já passou. |
| `LOG_LEVEL` | `info` | Nível do log (`debug`, `info`, `warn`, `error`...). |
| `TRUST_PROXY` | `false` | `true` atrás de proxy reverso, para usar o IP real do cliente. |
| `LOGIN_MAX_ATTEMPTS` | `5` | Tentativas de login com falha antes do bloqueio temporário. |
| `LOGIN_WINDOW_MINUTES` | `15` | Janela do bloqueio de login. |
| `API_RATE_LIMIT_PER_MINUTE` | `300` | Requisições por minuto por IP na API. |
| `SEED_PASSWORD` | `barber123` | Senha dos usuários criados pelo `db:seed`. |
