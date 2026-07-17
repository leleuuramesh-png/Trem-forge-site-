# Trem Forge — Site

Site estático da Trem Forge, plataforma de agentes de IA que constrói software
do zero ao deploy. Publicado no Netlify, com uma Netlify Function integrando
a API da Anthropic para o widget de chat.

## Estrutura

```
index-2.html          Home
templates.html         Galeria de projetos/exemplos (array PROJECTS editável no <script> final)
docs.html               Documentação técnica
privacidade.html        Política de Privacidade
termos.html              Termos de Uso
images/                  Imagens estáticas (og-image, ilustrações)
images/projetos/        Screenshots reais de projetos (ver README.md dentro da pasta)
netlify/functions/chat.js  Backend do widget "Testar IA" (chama a API da Anthropic)
netlify/functions/track.js Tracking mínimo de cliques (filtros e "Ver exemplo") em templates.html — sem banco de dados, só log
netlify/functions/portfolio-submit.js  Recebe as autorizações de portfólio do formulário "Enviar Projeto" (index-2.html) e salva no Netlify Blobs
netlify/functions/portfolio-list.js    Lista as autorizações salvas (protegida por ADMIN_PASSWORD) — usada pelo admin-portfolio.html
netlify/functions/portfolio-revoke.js  Marca uma autorização como revogada (protegida por ADMIN_PASSWORD)
admin-portfolio.html     Painel para conferir e revogar autorizações de portfólio (acesso por senha)
netlify.toml             Config de build, redirects e headers do Netlify
package.json              Metadados do projeto (sem dependências de build)
.env.example              Modelo das variáveis de ambiente necessárias
robots.txt / sitemap.xml  Arquivos de SEO
```

## Rodando localmente

Não há build step — é HTML/CSS/JS puro. Para testar com a Netlify Function
funcionando (o chat de IA), use a Netlify CLI:

```bash
npm install -g netlify-cli
netlify dev
```

Sem a CLI, você ainda pode abrir `index-2.html` direto no navegador, mas o
widget de chat vai falhar (a function só roda via Netlify).

## Variáveis de ambiente

Configure em **Netlify > Site settings > Environment variables**
(veja `.env.example`):

- `ANTHROPIC_API_KEY` (obrigatória) — chave da API da Anthropic.
- `ANTHROPIC_MODEL` (opcional) — padrão `claude-sonnet-4-6`.
- `ADMIN_PASSWORD` (obrigatória para o painel de portfólio) — senha de acesso a `admin-portfolio.html`.
- `MP_ACCESS_TOKEN` (obrigatória para assinaturas) — Access Token do Mercado Pago.
- `MP_WEBHOOK_SECRET` (obrigatória para assinaturas) — assinatura secreta do webhook do Mercado Pago.
- `SITE_URL` (opcional) — URL pública do site, usada no `back_url` do checkout. Se ausente, é inferida pelo header `Host`.

## Autorizações de Portfólio

O formulário "Enviar Projeto" (`index-2.html`) inclui uma seção opcional em
que o cliente autoriza (ou não) o uso do projeto no portfólio da Trem Forge.
Cada envio é salvo no **Netlify Blobs** via `portfolio-submit.js`. Para
conferir as autorizações e revogar quando necessário, acesse
`/admin-portfolio.html` e entre com a senha configurada em `ADMIN_PASSWORD`.

Requer `npm install` (dependência `@netlify/blobs`) antes do deploy.

## Login (email + senha)

Sistema de conta simples, sem serviço externo — usa **Netlify Blobs** pra
guardar usuários e sessões:

- `login.html` — página com abas Entrar / Criar conta.
- `netlify/functions/_lib/auth.js` — lib compartilhada (hash de senha com
  scrypt, criação/leitura de sessão, cookies).
- `netlify/functions/auth-signup.js` — `POST` cria conta e já loga.
- `netlify/functions/auth-login.js` — `POST` autentica e cria sessão.
- `netlify/functions/auth-logout.js` — `POST` encerra a sessão atual.
- `netlify/functions/auth-me.js` — `GET` devolve o usuário logado (ou `null`),
  a partir do cookie `tf_session` (HttpOnly, Secure, SameSite=Lax, 30 dias).

O registro do usuário já guarda os campos que as próximas etapas (assinatura
recorrente e coins) vão usar: `plan`, `planStatus`, `planProvider`,
`planCurrency`, `coinsBalance`. Nenhuma senha é salva em texto puro — só o
hash (`scrypt`, salt aleatório por usuário).

Pra proteger uma página ou function que exige login, chame
`GET /.netlify/functions/auth-me` a partir do front (ou `getSessionUser(event)`
dentro de outra function) e redirecione pra `login.html?next=/pagina.html`
se `user` vier `null`.

## Assinatura recorrente — Mercado Pago (planos Pro/Business em R$)

Usa a API de **Preapproval** do Mercado Pago (assinatura sem plano
associado, com pagamento pendente até o assinante autorizar o cartão).
Preços espelham a seção `#planos` do `index-2.html` (Pro R$ 49/mês,
Business R$ 199/mês) — se mudar lá, mude também em `PLAN_CONFIG`
(`netlify/functions/_lib/auth.js`).

- `netlify/functions/mp-subscribe.js` — `POST` (usuário logado). Cria o
  preapproval no Mercado Pago e devolve `checkoutUrl` (`init_point`) pra
  o front redirecionar o usuário completar o pagamento.
- `netlify/functions/mp-webhook.js` — `POST` público, cadastrado no
  painel do Mercado Pago (Suas integrações > Webhooks, evento
  "Assinaturas"). Valida a assinatura HMAC do header `x-signature`,
  busca o preapproval atualizado na API do Mercado Pago e atualiza
  `plan` / `planStatus` do usuário dono da assinatura.
- `painel.html` ganhou o card "Assinatura": mostra o plano atual e, se
  não houver assinatura ativa/pendente, os botões "Assinar Pro" /
  "Assinar Business" (chamam `mp-subscribe` e redirecionam pro
  checkout do Mercado Pago).

Variáveis necessárias (veja `.env.example`): `MP_ACCESS_TOKEN` (Suas
integrações > Credenciais) e `MP_WEBHOOK_SECRET` (Suas integrações >
Webhooks — só aparece depois de cadastrar a URL do webhook). A URL a
cadastrar no painel do Mercado Pago é
`https://tremforge.com/.netlify/functions/mp-webhook`.

Ainda faltam (próximas etapas, nesta ordem): assinatura recorrente em
US$ via Stripe (`stripe-subscribe.js` + `stripe-webhook.js`) e
`checkout.html` com compra avulsa de pacotes que credita/desconta
`coinsBalance`.

## Deploy

O `netlify.toml` já publica a raiz do repositório (`publish = "."`) e reescreve
`/` para `index-2.html`, já que a home não se chama `index.html`. Basta
conectar o repositório ao Netlify e configurar a variável de ambiente acima.

## Consultando os cliques da galeria (track.js)

A página `templates.html` envia um evento para `/.netlify/functions/track`
sempre que alguém clica num filtro (Sites/Apps/Sistemas) ou num link "Ver
exemplo". Não há banco de dados — os eventos só aparecem no log da function:

1. Netlify > seu site > **Functions** > `track` > **Function log**
2. Cada linha começa com `TRACK ` seguido de um JSON (`type`, `value`, `page`, `ts`)

É propositalmente simples (zero custo, zero dependências). Se algum dia isso
virar algo que você consulta com frequência, vale migrar para uma tabela
(Supabase/Postgres) ou uma ferramenta de analytics dedicada.

## Editando a galeria de templates

Os cards de `templates.html` são gerados a partir do array `PROJECTS`,
definido dentro do `<script>` no final do arquivo. Edite os objetos ali para
trocar os exemplos placeholder por projetos reais — os campos estão
comentados no próprio array.
