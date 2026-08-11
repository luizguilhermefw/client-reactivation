<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## AylaFlow: fila persistente e provider de mensagens

Este marco estabelece a base de mensageria outbound do AylaFlow com fila
persistente no PostgreSQL e uma porta desacoplada para providers externos. O
Redis e o BullMQ não fazem parte desta versão.

### Fluxo

Fluxo implementado atualmente:

```text
EngineService
  → QueueService
  → OutboundMessage
  → MessageWorkerService
  → MessageProvider
  → Evolution API
```

A abstração `MessageProvider`, o adapter `EvolutionMessageProvider` e o
`EvolutionConfigResolver` estão integrados ao worker. Seus comportamentos
também permanecem testados de forma isolada.

### Responsabilidades

- `OutboundMessage` é a fila persistente para mensagens `TEXT` e para a
  modelagem preparada de mensagens `IMAGE`. Ela concentra o estado operacional:
  agendamento, prioridade, tentativas, disponibilidade, processamento, locks,
  identificação do worker e erros da última tentativa.
- `MessageLog` é reservado ao histórico terminal. Ele pode se vincular a um
  `OutboundMessage`, e as constraints garantem no máximo um log por mensagem.
- `QueueService` cria mensagens de forma idempotente por tenant usando
  `companyId` e `idempotencyKey`.
- `MessageWorkerService` seleciona lotes elegíveis, realiza aquisição
  condicional, impede sobreposição local, controla locks e tentativas, aplica
  retry/backoff, recupera locks expirados, chama o provider e persiste o
  resultado terminal de forma transacional.
- `MessageProvider` é a porta neutra do domínio para envio de mensagens. Seu
  contrato não expõe tipos ou detalhes da Evolution API.
- `EvolutionMessageProvider` é o adapter HTTP externo para mensagens de texto e
  imagem por URL da Evolution API. Ele normaliza e valida entradas, aplica
  timeout completo e converte falhas externas em erros seguros do domínio.
- `EvolutionConfigResolver` resolve configuração a partir de `companyId`,
  mantendo o provider preparado para credenciais específicas por tenant.
- `EnvEvolutionConfigResolver` é a implementação inicial do MVP. Por enquanto,
  retorna uma configuração global lida das variáveis de ambiente da Evolution.

### Estados e processamento

Os estados operacionais relevantes de `OutboundMessage` são:

- `PENDING`: aguardando disponibilidade para processamento.
- `PROCESSING`: adquirido por um worker e protegido por lock.
- `SENT`: envio confirmado pelo provider e registrado no histórico terminal.
- `FAILED`: falha definitiva não retryable ou após atingir o limite
  `maxAttempts`.

Na aquisição, o worker usa atualização condicional para impedir que duas
instâncias processem a mesma mensagem. Erros temporários devolvem a mensagem
para `PENDING`. O backoff atual é de 1 minuto na primeira tentativa, 5 minutos
na segunda e 15 minutos a partir da terceira. Ao atingir `maxAttempts`, a
mensagem passa para `FAILED`.

Locks com 5 minutos ou mais são considerados expirados. Antes de buscar novas
mensagens pendentes, o worker tenta liberar esses locks e devolver as mensagens
para `PENDING`, sem incrementar novamente o número de tentativas.

### Tipos de mensagem

O campo obrigatório `OutboundMessage.type` diferencia `TEXT` e `IMAGE` e usa
`TEXT` como padrão para preservar registros e chamadas existentes. Mensagens de
texto continuam usando `content` e o fluxo já validado ponta a ponta.

Uma `OutboundMessage` pode referenciar opcionalmente um `MediaAsset` por uma
relação composta com `companyId`, impedindo vínculos de mídia entre tenants. O
campo nullable preserva mensagens `TEXT` e imagens antigas que ainda usam
`mediaUrl` no payload, sem backfill. Quando `mediaAssetId` está presente, o
worker exige um asset `READY` do mesmo tenant, gera uma URL temporária apenas em
memória e prioriza esse vínculo sem fallback para `mediaUrl`. Imagens legadas
sem vínculo continuam usando a URL validada do payload. A URL temporária não é
persistida.

Automações `CAMPAIGN` podem enfileirar `TEXT` ou referenciar um `MediaAsset`
para criar `OutboundMessage IMAGE`. A fila aceita o vínculo somente quando o
asset pertence ao mesmo `companyId`, está `READY`, não expirou e possui MIME de
imagem permitido; os metadados persistidos vêm do próprio asset. O payload não
recebe bucket, object key nem URL temporária — essa URL nasce somente no worker.
A operação de campanha usa a elegibilidade atual
`isActiveForAutomation` e idempotência persistente por campanha e cliente.

Campanhas são registros `Automation` próprios e podem ser criadas pelo endpoint
autenticado `POST /automation/campaign`:

```json
{
  "name": "Promoção de Inverno"
}
```

Elas nascem ativas, com `daysAfter` e `message` nulos, pois não possuem ciclo
recorrente nem conteúdo persistido. O conteúdo é obrigatório em cada dispatch.
O banco exige esses dois campos para toda automação que não seja `CAMPAIGN`.
O `companyId` vem exclusivamente do JWT, e a unicidade de nome permanece
isolada por tenant. Campanhas não consomem o limite de cinco automações
recorrentes personalizadas.

O endpoint autenticado `POST /automation/:id/campaign/dispatch` dispara essa
operação de forma assíncrona e aceita campanha de texto:

```json
{
  "type": "TEXT",
  "content": "Promoção especial",
  "audience": { "type": "ALL_ELIGIBLE" }
}
```

Ou campanha de imagem vinculada ao storage privado:

```json
{
  "type": "IMAGE",
  "mediaAssetId": "media-asset-id",
  "caption": "Legenda opcional",
  "audience": {
    "type": "CUSTOMER_IDS",
    "customerIds": ["customer-id-1", "customer-id-2"]
  }
}
```

`ALL_ELIGIBLE` seleciona todos os clientes elegíveis do tenant;
`CUSTOMER_IDS` aceita até 500 IDs por requisição, remove duplicados e ignora
clientes inativos ou de outro tenant. O `companyId` vem exclusivamente do JWT.
Chamadas repetidas reutilizam a idempotência persistente da fila. Para `IMAGE`,
a API não aceita URL ou detalhes físicos do storage: a URL temporária nasce
somente no worker e nunca integra a resposta do dispatch. Os contadores da
resposta representam clientes elegíveis e processados, não garantem que todos
tenham originado uma nova `OutboundMessage` em chamadas repetidas.

O cron não dispara campanhas promocionais automaticamente. O endpoint ainda
processa o público em um loop adequado ao piloto; batching e processamento
massivo ficam para uma evolução futura.

### Consentimento de contato

O `Customer.contactConsentStatus` registra `UNKNOWN`, `GRANTED` ou `OPTED_OUT`.
Durante esta fase de migração, `UNKNOWN` continua temporariamente permitido para
preservar a compatibilidade do MVP; uma política opt-in estrita poderá ser
adotada no futuro. `OPTED_OUT` bloqueia a comunicação, enquanto
`isActiveForAutomation` permanece um bloqueio operacional separado.

O `EngineService` já respeita o `CustomerEligibilityService`: clientes
`OPTED_OUT` são excluídos de automações recorrentes e campanhas, enquanto
`UNKNOWN` continua temporariamente permitido por compatibilidade. O worker
revalida o consentimento imediatamente antes de resolver mídia ou chamar o
provider; assim, um opt-out posterior ao enqueue ainda impede o envio e marca a
mensagem como `CANCELLED`. Esse cancelamento ainda não cria `MessageLog`, pois
`LogStatus` não possui `CANCELLED`; o próprio `OutboundMessage` é a fonte de
auditoria nesta etapa.

O consentimento pode ser alterado pelo endpoint autenticado
`PATCH /customer/:id/contact-consent`, que aceita somente `GRANTED` ou
`OPTED_OUT`. `GRANTED` registra uma nova data de concessão e limpa a data de
opt-out; `OPTED_OUT` registra a saída sem apagar uma concessão anterior.
`UNKNOWN` é reservado ao estado inicial ou importado e não pode ser definido
manualmente. O `companyId` vem exclusivamente do JWT e protege a operação por
tenant. O opt-out não remove mensagens já enfileiradas: o worker revalida o
consentimento imediatamente antes da entrega e as cancela com segurança.

O TTL é configurado por `MEDIA_READ_URL_TTL_SECONDS`, com padrão de 900 segundos
(15 minutos), mínimo de 60 e máximo de 3.600. Valores presentes, mas vazios,
não numéricos ou fora desse intervalo impedem a inicialização com erro claro.

A fila aceita a modelagem de `IMAGE` com uma URL HTTP/HTTPS e metadados no
`payload` JSON:

```json
{
  "mediaUrl": "https://media.example.com/campanha.jpg",
  "mimeType": "image/jpeg",
  "fileName": "campanha.jpg",
  "fileSize": 123456,
  "caption": "Legenda opcional"
}
```

O banco não armazena binário nem base64. Nesta etapa, os limites conservadores
do MVP são 5 MiB por arquivo e 1.024 caracteres por legenda; esses valores
devem ser revisados antes do uso em produção. Somente JPEG e PNG são aceitos.
O `fileSize` é apenas um metadado declarado: essa validação não comprova o
tamanho do recurso remoto. O tamanho real deverá ser validado no futuro fluxo
de upload/storage.

A allowlist de mídia é configurada como uma lista de hosts exatos separados por
vírgula:

```env
IMAGE_MEDIA_ALLOWED_HOSTS=firebasestorage.googleapis.com,storage.googleapis.com
```

Somente hosts controlados devem ser configurados. A comparação ignora
maiúsculas e minúsculas, não aceita curingas e permite query strings de URLs
assinadas. A política é fail-closed: configuração ausente, vazia ou inválida
faz a fila e o provider rejeitarem `IMAGE` com a mensagem genérica
`Media URL is not allowed`. A fila valida antes de persistir, e o provider
repete a validação antes de chamar a Evolution API.

URLs manuais antigas do Firebase podem usar
`firebasestorage.googleapis.com`, enquanto URLs assinadas V4 geradas pelo
adapter usam `storage.googleapis.com`. Quando os dois fluxos estiverem ativos,
ambos os hosts devem ser autorizados explicitamente na lista separada por
vírgulas. Não configure wildcard, domínio amplo ou correspondência por sufixo.
A URL temporária continua restrita à chamada do provider e não é persistida nem
registrada.

A allowlist exige HTTPS sem porta explícita e reduz o risco de requisições para
destinos não controlados, mas a checagem de hostname não constitui proteção
completa contra SSRF nem substitui controles de rede, DNS e storage. O backend
não baixa a imagem, não resolve DNS, não segue redirects e não converte o
recurso para base64: ele apenas repassa a URL à Evolution API.

O contrato neutro e o `EvolutionMessageProvider` implementam o envio de
`IMAGE`. O worker valida defensivamente o payload persistido e chama
exclusivamente `sendImage`; payload inválido termina em `FAILED` com
`INVALID_IMAGE_PAYLOAD`, sem chamada externa. Imagens válidas seguem as mesmas
regras de sucesso, retry, locks, `MessageLog` e semântica at-least-once de
`TEXT`.

### Armazenamento privado de mídia

O `FirebaseMediaStorageAdapter` implementa o contrato provider-agnostic de
storage usando Cloud Storage for Firebase. A autenticação usa Application
Default Credentials, fornecidas pela infraestrutura ou por
`GOOGLE_APPLICATION_CREDENTIALS`; nenhuma credencial Firebase é armazenada no
repositório. A configuração exige:

```env
FIREBASE_STORAGE_PROJECT_ID=your-firebase-project-id
FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
```

Os objetos permanecem privados, usam chaves isoladas pelo prefixo
`companies/{companyId}/` e são criados sem sobrescrita silenciosa. A leitura usa
URLs assinadas V4 temporárias, com validade entre 60 segundos e 1 hora, sem
criar token permanente de download.

O `MediaAssetService` valida JPEG/PNG, calcula SHA-256 para deduplicação por
tenant, cria o asset como `PENDING`, envia pelo adapter e conclui como `READY`.
Assets `READY` são reutilizados sem novo upload; falhas de envio terminam em
`FAILED`. Para evitar reativação ambígua ou upload duplicado, assets `PENDING`,
`FAILED`, `DELETE_PENDING` ou `DELETED` não são reutilizados nesta etapa.

As chaves seguem `companies/{companyId}/media/{mediaAssetId}/{safeFileName}`. Se
o upload concluir e a persistência de `READY` falhar, o service tenta excluir o
objeto como compensação.

O endpoint autenticado `POST /media-assets` recebe um único arquivo no campo
multipart `file`, mantido somente em memória, com limite absoluto de 5 MiB e
MIME `image/jpeg` ou `image/png`. O `companyId` vem exclusivamente do JWT; body,
query e rota não oferecem alternativa para escolher o tenant. A resposta omite
bucket, object key, provider e demais detalhes físicos do storage. Tanto assets
novos quanto um asset `READY` reutilizado retornam `201`, pois o endpoint mantém
um contrato único de criação idempotente sem expor a decisão interna de
deduplicação.

Ainda não existem upload no frontend, integração com campanhas, geração de URL
temporária para envio ou rotina automática de limpeza.

### Segurança e isolamento por tenant

- `companyId` é obrigatório nas operações e filtros operacionais da fila.
- Relações compostas no PostgreSQL protegem os vínculos multi-tenant de
  `MessageLog` com cliente, automação e `OutboundMessage`.
- `outboundMessageId` é único no `MessageLog`, garantindo no máximo um registro
  terminal por mensagem da fila.
- O provider recebe `companyId` e delega a seleção de configuração ao
  `EvolutionConfigResolver`; ele não acessa diretamente variáveis de ambiente
  nem escolhe credenciais de outro tenant.
- API keys, telefone completo, conteúdo integral e respostas completas do
  provider não são incluídos em logs ou erros públicos.
- No MVP, `EnvEvolutionConfigResolver` usa uma configuração global carregada do
  ambiente via `.env`: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`,
  `EVOLUTION_INSTANCE_NAME` e `EVOLUTION_REQUEST_TIMEOUT_MS`. Essa é uma
  implementação inicial da porta tenant-aware, não armazenamento definitivo de
  credenciais por empresa.

### Semântica operacional atual

O `MessageWorkerService` chama o `MessageProvider` fora da transação de banco.
Após o retorno, a transição para `SENT` ou `FAILED` e a criação do único
`MessageLog` terminal ocorrem na mesma transação, condicionadas à posse do lock
pelo worker atual. Falhas temporárias não criam histórico terminal e retornam a
mensagem para `PENDING` com backoff.

A `idempotencyKey` protege a criação interna da `OutboundMessage` e é repassada
ao contrato `MessageProvider`. O adapter `EvolutionMessageProvider` não a
inclui nas requisições HTTP. Para texto, o body contém somente `number` e
`text`; para imagem, contém `number`, `mediatype`, `mimetype`, `caption`,
`media` e `fileName`. Portanto, não existe garantia idempotente externa. A
entrega mantém semântica at-least-once e pode ser duplicada se o provider
aceitar o envio, mas a persistência local do resultado falhar antes da
confirmação terminal.

### Validação ponta a ponta

#### TEXT — 4 de agosto de 2026

Em 4 de agosto de 2026, o fluxo de envio foi validado ponta a ponta com a
Evolution API v2.3.7 executada localmente via Docker Compose e uma instância de
desenvolvimento conectada via Baileys. Antes da execução pelo AylaFlow, um envio
manual direto pela Evolution API confirmou a conectividade da instância.

O primeiro teste pelo AylaFlow foi rejeitado com
`lastErrorCode = INVALID_MESSAGE_REQUEST` porque o adapter ainda usava o
formato antigo do payload. Para o endpoint de envio de texto da Evolution API
v2.3.7, o formato compatível é:

```ts
{
  number,
  text,
}
```

Após a correção do `EvolutionMessageProvider`, uma nova `OutboundMessage` foi
criada e o fluxo real foi concluído:

```text
Automation
  → EngineService
  → QueueService
  → OutboundMessage PENDING
  → MessageWorkerService
  → EvolutionMessageProvider
  → Evolution API
  → WhatsApp
  → OutboundMessage SENT
  → MessageLog SENT
```

A validação foi controlada e limitada a uma empresa, uma automação, um contato
e uma única mensagem em estado `PENDING`. O worker foi habilitado somente
durante o teste e, após a validação, `MESSAGE_WORKER_ENABLED` voltou para
`false`.

Os resultados confirmados no banco foram:

- `OutboundMessage.status = SENT`;
- `attempts = 1`;
- `provider = EVOLUTION`;
- `providerMessageId` preenchido;
- `sentAt` preenchido;
- `lastErrorCode` vazio;
- `MessageLog.status = SENT`;
- `MessageLog` vinculado ao `outboundMessageId`, ao `customerId` e ao
  `automationId` correspondentes.

Essa validação confirmou o primeiro envio real de `TEXT` ponta a ponta pelo
fluxo atual.

#### IMAGE — 6 de agosto de 2026

Em 6 de agosto de 2026, o primeiro envio real de `IMAGE` foi concluído ponta a
ponta. Uma imagem JPEG foi adicionada manualmente ao Cloud Storage for Firebase,
e sua URL HTTPS usou um host configurado em `IMAGE_MEDIA_ALLOWED_HOSTS`. A
Evolution API enviou a imagem com legenda, e o WhatsApp controlado usado na
validação recebeu a mídia com sucesso.

O fluxo confirmado foi:

```text
OutboundMessage IMAGE
  → MessageWorkerService
  → MediaUrlPolicy
  → EvolutionMessageProvider
  → Evolution API
  → WhatsApp
  → OutboundMessage SENT
  → MessageLog SENT
```

O teste foi controlado e limitado a uma empresa, um cliente, uma automação, uma
imagem e uma única mensagem em estado `PENDING`. O worker foi habilitado apenas
durante a execução e, ao final, `MESSAGE_WORKER_ENABLED` voltou para `false`.

Os resultados confirmados no banco foram:

- `OutboundMessage.type = IMAGE`;
- `OutboundMessage.status = SENT`;
- `attempts = 1`;
- `provider = EVOLUTION`;
- `providerMessageId` preenchido;
- `sentAt` preenchido;
- `lastError` vazio;
- `lastErrorCode` vazio;
- `MessageLog.status = SENT`;
- `MessageLog` vinculado corretamente ao `outboundMessageId`, ao `customerId` e
  ao `automationId` correspondentes.

O upload dessa validação ainda foi manual e ocorreu antes da implementação do
`FirebaseMediaStorageAdapter`, do `MediaAssetService` e do endpoint de upload.

#### Upload seguro e deduplicação — 6 de agosto de 2026

Em uma validação controlada, o backend iniciou com Application Default
Credentials e recebeu pelo endpoint autenticado `POST /media-assets` uma imagem
JPEG de 103092 bytes em `multipart/form-data`. O `companyId` veio exclusivamente
do JWT e a operação retornou HTTP 201 com asset `READY`, MIME e tamanho corretos
e `checksumSha256` preenchido, sem expor bucket, object key, provider, URL ou
token.

O fluxo confirmado foi:

```text
JWT
  → POST /media-assets
  → multipart em memória
  → MediaAssetService
  → SHA-256
  → deduplicação por tenant
  → Firebase Storage privado
  → MediaAsset READY
```

O banco confirmou o provider Firebase, o bucket configurado, o status `READY` e
o object key isolado no padrão
`companies/{companyId}/media/{mediaAssetId}/...`; o objeto também foi confirmado
no storage privado. Ao reenviar a mesma imagem, a deduplicação reutilizou o
mesmo `MediaAsset`: o total permaneceu em um registro e nenhuma cópia adicional
foi necessária.

Essa validação comprova somente esse fluxo controlado e não significa que o MVP
inteiro esteja concluído. Ainda faltam a integração com campanhas, o upload pelo
frontend e a limpeza automática de assets. A geração de URL temporária pelo
worker está implementada, mas não fez parte daquela validação ponta a ponta.

### Habilitação segura do worker

```env
MESSAGE_WORKER_ENABLED=false
```

O worker permanece desabilitado por padrão e deve continuar com `false` em
ambientes que não podem realizar envios. Use `true` somente no processo
responsável pelo consumo da fila. Em múltiplas réplicas, os locks continuam
protegendo a aquisição concorrente, mas a recomendação inicial do MVP é
habilitar apenas uma instância worker.

### Próximos passos

- Integrar automações e campanhas ao fluxo de produto.
- Persistir a configuração da Evolution API por tenant.
- Processar webhooks de entrega e atualizar o acompanhamento de status.
- Integrar o upload de imagem ao frontend.
- Implementar a rotina de limpeza de assets expirados.
- Implementar proteções operacionais necessárias para produção.
- Conduzir um piloto controlado antes de ampliar o uso.

### Runtime

O backend do AylaFlow utiliza Node.js 22 e npm 10 ou superior.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
