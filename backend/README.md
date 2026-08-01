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

- `OutboundMessage` é a fila persistente e concentra o estado operacional:
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
- `EvolutionMessageProvider` é o adapter HTTP externo para mensagens de texto
  da Evolution API. Ele normaliza e valida entradas, aplica timeout completo e
  converte falhas externas em erros seguros do domínio.
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
ao contrato `MessageProvider`. O adapter `EvolutionMessageProvider` atual não a
inclui na requisição HTTP: o body enviado à Evolution API contém apenas
`number` e `textMessage.text`. Portanto, não existe garantia idempotente
externa. A entrega mantém semântica at-least-once e pode ser duplicada se o
provider aceitar o envio, mas a persistência local do resultado falhar antes da
confirmação terminal.

### Habilitação segura do worker

```env
MESSAGE_WORKER_ENABLED=false
```

O worker permanece desabilitado por padrão e deve continuar com `false` em
ambientes que não podem realizar envios. Use `true` somente no processo
responsável pelo consumo da fila. Em múltiplas réplicas, os locks continuam
protegendo a aquisição concorrente, mas a recomendação inicial do MVP é
habilitar apenas uma instância worker.

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
