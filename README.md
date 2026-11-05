# BarberApp — Zé Barbeiro

Sistema web de agendamento para barbearias. Clientes reservam horários com o barbeiro e o serviço desejados; barbeiros gerenciam a própria agenda; o administrador mantém o cadastro de barbeiros e serviços e acompanha todos os atendimentos.

O projeto não tem dependências externas: o back-end usa apenas módulos nativos do Node.js e o front-end é HTML, CSS e JavaScript (módulos ES) com Bootstrap via CDN.

## Sumário

- [Funcionalidades](#funcionalidades)
- [Como executar](#como-executar)
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
| **Barbeiro** | Ver a agenda do dia, incluir atendimentos manualmente (informando o nome do cliente), bloquear horários, concluir atendimentos e consultar o histórico. |
| **Administrador** | Cadastrar e editar barbeiros (foto, dias, horários e serviços) e serviços; consultar a agenda e o histórico de qualquer barbeiro. |

Todos os perfis têm a página **Minha conta**, onde editam nome, celular, nascimento e e-mail (a troca de e-mail exige a senha atual) e alteram a senha.

## Como executar

Pré-requisito: **Node.js 20 ou superior**. Não é necessário `npm install`.

```bash
npm start
```

Acesse <http://127.0.0.1:3000>. O login fica em `/login.html` e o cadastro de clientes em `/cadastro.html`.

Na primeira execução o arquivo `data/db.json` é criado a partir de `data/seed.json`. Para voltar aos dados de exemplo a qualquer momento:

```bash
npm run db:reset
```

Outros scripts:

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia o servidor e reinicia automaticamente ao salvar arquivos. |
| `npm test` | Executa os testes automatizados. |

## Usuários de demonstração

Todos usam a senha **`barber123`**.

| Perfil | E-mail |
| --- | --- |
| Administrador | `adm@adm.com.br` |
| Barbeiro | `barbeiro@barbeiro.com.br` |
| Cliente | `cliente@cliente.com.br` |

> Troque as senhas antes de usar o sistema com dados reais.

## Estrutura do projeto

```text
.
├── data/
│   ├── seed.json             # Dados de exemplo (db.json é gerado e não é versionado)
│   └── uploads/              # Fotos dos barbeiros (geradas em uso, não versionadas)
├── public/                   # Front-end servido estaticamente
│   ├── css/
│   │   ├── base.css          # Tokens de cor, cabeçalho, rodapé, modais, botões
│   │   ├── app.css           # Área logada (painéis, filtros, tabelas, status)
│   │   ├── auth.css          # Login e cadastro
│   │   └── landing.css       # Página inicial
│   ├── img/
│   ├── js/
│   │   ├── core/             # API, sessão, DOM, formulários, formatação, notificações
│   │   ├── components/       # app-shell, crud-page, history-page, auth-form, status-badge
│   │   └── pages/            # Um módulo por página
│   └── *.html
├── scripts/
│   └── reset-db.js
├── server/
│   ├── auth/                 # Hash de senha, sessões, limite de tentativas
│   ├── db/store.js           # Persistência em JSON com escrita atômica
│   ├── domain/               # Regras puras: horários, agenda, perfis
│   ├── http/                 # Roteador, corpo JSON, respostas, arquivos estáticos
│   ├── services/             # Casos de uso por recurso
│   ├── app.js                # Composição da aplicação
│   ├── config.js
│   ├── index.js              # Ponto de entrada
│   ├── routes.js             # Rotas e regras de acesso
│   └── validation.js
└── test/                     # Testes com node:test
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
Navegador ──fetch──▶ server/http ──▶ routes (autenticação/perfil) ──▶ services ──▶ domain
                                                                          │
                                                                          ▼
                                                                  db/store (data/db.json)
```

- **Front-end**: cada página carrega um módulo de `js/pages`. O `app-shell` protege a página pelo perfil, monta o cabeçalho, o rodapé e os modais da conta. Páginas semelhantes reutilizam `crud-page` (cadastros) e `history-page` (históricos). Nenhum dado da API é inserido como HTML.
- **Back-end**: os `services` concentram as regras de negócio e validam toda entrada; o `domain` contém funções puras e testáveis (geração de horários, dias da semana, status). O `store` serializa as escritas, o que impede que duas reservas simultâneas ocupem o mesmo horário.
- **Dados**: datas em ISO (`AAAA-MM-DD`), horários `HH:MM`, valores numéricos e IDs únicos.

## API

Todas as rotas ficam sob `/api`, recebem e devolvem JSON e, exceto login e cadastro, exigem o cabeçalho `Authorization: Bearer <token>`. Erros retornam `{ "erro": "mensagem" }` com o status HTTP adequado (400, 401, 403, 404, 409, 422, 429).

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| POST | `/auth/login` | público | Autentica e devolve `{ token, usuario }`. |
| POST | `/auth/logout` | autenticado | Encerra a sessão. |
| GET | `/auth/me` | autenticado | Dados do usuário logado. |
| PUT | `/auth/me` | autenticado | Edita nome, e-mail, celular e nascimento (trocar o e-mail exige `senhaAtual`). |
| PUT | `/auth/senha` | autenticado | Altera a senha (`senhaAtual`, `novaSenha`). |
| POST | `/clientes` | público | Cadastro de cliente. |
| GET | `/barbeiros` | autenticado | Lista completa (admin) ou barbeiros ativos com seus serviços. |
| GET / POST / PUT | `/barbeiros[/:id]` | administrador | Consulta, cadastro e edição. |
| PUT / DELETE | `/barbeiros/:id/foto` | administrador | Envia (corpo binário JPG/PNG/WEBP, até 2 MB) ou remove a foto. |
| GET | `/barbeiros/:id/foto` | público | Imagem da foto (usada nas telas de agendamento). |
| GET | `/servicos` | autenticado | Todos (admin) ou somente ativos. |
| POST / PUT | `/servicos[/:id]` | administrador | Cadastro e edição. |
| GET | `/agenda?barbeiroId=&data=` | barbeiro, administrador | Agenda completa do dia (barbeiro vê sempre a própria). |
| GET | `/disponibilidade?servicoId=&data=&barbeiroId=` | autenticado | Horários livres e futuros por barbeiro, sem dados de outros clientes. |
| GET | `/agendamentos?inicio=&fim=&situacao=&barbeiroId=` | autenticado | Histórico (`situacao`: `pendentes` ou `concluidos`). |
| POST | `/agendamentos` | cliente, barbeiro | Reserva (cliente); atendimento manual com cliente e serviço, ou bloqueio (barbeiro). |
| PATCH | `/agendamentos/:id/concluir` | barbeiro | Conclui um atendimento. |
| PATCH | `/agendamentos/:id/cancelar` | cliente, barbeiro | Cancela (o registro é mantido com status `Cancelado`). |

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

- Senhas armazenadas com **scrypt** e salt aleatório; o hash nunca sai do servidor.
- Sessões com token aleatório de 256 bits, expiração configurável, logout no servidor e encerramento das demais sessões ao trocar a senha.
- Autorização por perfil em todas as rotas, além de verificação de propriedade dos agendamentos.
- Limite de tentativas de login por IP + e-mail e resposta com tempo constante para e-mails inexistentes.
- Validação e normalização de toda entrada no servidor; limite de tamanho do corpo das requisições.
- Cabeçalhos de segurança (`Content-Security-Policy` sem scripts inline, `X-Frame-Options`, `nosniff`, `Referrer-Policy`), Bootstrap carregado com SRI.
- Apenas a pasta `public/` é servida, com proteção contra *path traversal*; o banco não é acessível pelo navegador.
- Fotos: o navegador recorta e redesenha a imagem antes do envio (descartando metadados como GPS); o servidor valida o tipo pela assinatura do arquivo, limita o tamanho e salva com nome aleatório.
- Front-end sem `innerHTML` com dados dinâmicos, eliminando XSS.

> As sessões ficam em memória: reiniciar o servidor exige novo login. Para produção, use HTTPS (por exemplo, atrás de um proxy reverso) e um banco de dados gerenciado.

## Testes

```bash
npm test
```

A suíte usa o executor nativo `node:test` e cobre:

- funções de domínio (geração de horários, datas, fuso, status);
- hash de senha, sessões e limite de tentativas;
- a API ponta a ponta: autenticação, autorização por perfil, reservas, conflitos e reservas simultâneas, cancelamento, conclusão, histórico, cabeçalhos de segurança e bloqueio de *path traversal*.

## Configuração

Variáveis de ambiente opcionais (veja `.env.example`):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Endereço de escuta. |
| `PORT` | `3000` | Porta HTTP. |
| `APP_TIMEZONE` | `America/Sao_Paulo` | Fuso usado para decidir se um horário já passou. |
| `SESSION_TTL_MINUTES` | `480` | Duração da sessão. |
| `LOGIN_MAX_ATTEMPTS` | `5` | Tentativas de login antes do bloqueio temporário. |
| `LOGIN_WINDOW_MINUTES` | `15` | Janela do bloqueio de login. |
| `DATA_FILE` | `data/db.json` | Caminho do arquivo de dados. |
| `UPLOADS_DIR` | `data/uploads` | Pasta das fotos dos barbeiros. |
