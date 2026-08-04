# Evolution API para desenvolvimento

Ambiente Docker Compose isolado para validar a Evolution API com WhatsApp via
Baileys. A imagem `evoapicloud/evolution-api:v2.3.7` foi fixada
intencionalmente como baseline do primeiro laboratório; ela não é apresentada
como versão atual nem como `latest`.

A linha `2.4.0+` introduziu ativação/licenciamento e breaking changes. Uma
atualização para `2.4.x` deverá ser avaliada separadamente, incluindo requisitos
de ativação, migrations e compatibilidade, antes de qualquer alteração desta
baseline.

Referências oficiais:

- [Releases da Evolution API](https://github.com/evolution-foundation/evolution-api/releases)
- [Imagem oficial no Docker Hub](https://hub.docker.com/r/evoapicloud/evolution-api/tags)
- [Configuração de ambiente da versão 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/.env.example)

## Pré-requisitos

- Docker Engine ou Docker Desktop atualizado.
- Docker Compose v2 (`docker compose`).
- Porta local definida por `EVOLUTION_PORT` disponível.
- Um número de WhatsApp exclusivo para desenvolvimento.

O PostgreSQL e o Redis ficam acessíveis somente pela rede privada do Compose;
nenhum dos dois publica portas no host. A Evolution API publica apenas
`127.0.0.1:${EVOLUTION_PORT}` e, portanto, não fica acessível por outras
interfaces de rede por padrão.

## Configuração

Entre nesta pasta e crie o arquivo local de configuração:

```bash
cp .env.example .env
```

No PowerShell:

```powershell
Copy-Item .env.example .env
```

Edite `.env` e substitua todos os valores `CHANGE_ME_*`. Gere valores longos e
aleatórios; por exemplo, uma API key de 32 bytes:

```bash
openssl rand -hex 32
```

Use uma senha diferente para o PostgreSQL. Para evitar erros na URI, prefira
uma senha URL-safe ou aplique percent-encoding aos caracteres reservados.
`POSTGRES_PASSWORD` e a senha dentro de `DATABASE_CONNECTION_URI` precisam ser
iguais. Se alterar `EVOLUTION_PORT`, ajuste também a porta de `SERVER_URL`.

O arquivo `.env` contém segredos e nunca deve ser versionado. Antes de qualquer
commit, confirme no `git status` que `.env` não aparece entre os arquivos. O
`.gitignore` desta pasta protege esse nome localmente, enquanto `.env.example`
permanece versionável. Essa proteção não substitui a conferência manual. A API
key real nunca deve ser enviada ao Git, colada em issues ou incluída em
documentação.

`SERVER_URL=http://localhost:8080` é válido somente para execução local ou
acesso por túnel SSH. Em uma VPS com proxy reverso, configure uma URL pública
HTTPS, por exemplo:

```env
SERVER_URL=https://evolution-dev.example.com
```

O domínio acima é apenas ilustrativo.

## Iniciar e verificar

Suba os containers em segundo plano:

```bash
docker compose up -d
```

Verifique o estado e acompanhe os logs sem expor o conteúdo do `.env`:

```bash
docker compose ps
docker compose logs -f evolution-api
```

Com os valores padrão, o gerenciador fica em
`http://localhost:8080/manager`. Use a API key configurada somente no seu
arquivo `.env` local.

### Acesso quando o Docker está em uma VPS

O bind `127.0.0.1:${EVOLUTION_PORT:-8080}:8080` não expõe a Evolution API
publicamente. No Docker Desktop local, o gerenciador pode ser aberto diretamente
em `http://localhost:8080/manager`. Em uma VPS remota, porém, o `localhost` do
computador do usuário não é o `localhost` da VPS.

Para o laboratório inicial, mantenha o bind privado e abra um túnel SSH:

```bash
ssh -L 8080:127.0.0.1:8080 usuario@IP_DA_VPS
```

Enquanto o túnel estiver aberto, acesse:

```text
http://localhost:8080/manager
```

Para que um AylaFlow hospedado acesse a Evolution futuramente, será necessário
configurar um subdomínio, proxy reverso, HTTPS e controle de acesso, além de
ajustar `SERVER_URL` para a URL pública HTTPS. Este laboratório não inclui
configuração de Nginx, proxy reverso ou certificados SSL.

## Conectar o WhatsApp por QR Code

1. Abra o gerenciador da Evolution API.
2. Crie uma instância usando o canal WhatsApp/Baileys.
3. Solicite a conexão da instância para exibir o QR Code.
4. No telefone de desenvolvimento, abra **WhatsApp > Aparelhos conectados >
   Conectar um aparelho** e leia o QR Code.
5. Confirme no gerenciador que a instância ficou conectada antes de testar
   qualquer envio.

Use exclusivamente um número destinado a desenvolvimento. Baileys utiliza a
sessão do WhatsApp Web; evite contas pessoais ou números reais de atendimento
durante validações.

No backend AylaFlow, mantenha:

```env
MESSAGE_WORKER_ENABLED=false
```

Só habilite o worker depois de validar manualmente a instância, a URL e a API
key em um ambiente seguro. Isso evita que mensagens já presentes na fila sejam
enviadas acidentalmente.

## Parar o ambiente

Pare e remova os containers, preservando os volumes:

```bash
docker compose down
```

Não use `docker compose down -v` sem intenção explícita: a opção `-v` remove os
volumes nomeados e apaga os dados locais do PostgreSQL, Redis e das instâncias.

## Atualizar com cautela

Não troque a imagem para `latest`. Antes de atualizar:

1. Leia as notas do novo release e identifique breaking changes e migrations.
2. Faça backup dos dados importantes e confirme que o ambiente é apenas de
   desenvolvimento.
3. Altere a tag fixa em `docker-compose.yml`.
4. Baixe e suba a nova versão de forma explícita:

```bash
docker compose pull evolution-api
docker compose up -d evolution-api
docker compose logs -f evolution-api
```

Valide criação de instância, QR Code, conexão e envio controlado antes de usar
a versão atualizada com o AylaFlow. A migração específica para a linha `2.4.x`
deve permanecer uma decisão separada por causa das mudanças de licenciamento e
ativação.
