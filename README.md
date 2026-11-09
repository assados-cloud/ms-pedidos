# Pedidos da Lanchonete

Microsserviço da Equipe 15 para criar e consultar pedidos. Usa Node.js (Express), MySQL e RabbitMQ. Ele liga a parte síncrona à assíncrona: consulta o Cardápio por REST, grava o pedido no próprio banco e publica o evento `pedido.criado`, que o Estoque (e depois o Notificações) consome.

## Rotas

| Rota | O que faz |
| --- | --- |
| `POST /pedidos` | Cria o pedido (fluxo abaixo) |
| `GET /pedidos` | Lista os últimos 100 pedidos |
| `GET /pedidos/{id}` | Detalha um pedido, com itens |
| `GET /pedidos/health` | Readiness (testa o MySQL) |

Corpo do `POST /pedidos` (o preço nunca vem do cliente, é buscado no Cardápio):

```json
{
  "itens": [
    {"produto_id": 1, "quantidade": 2},
    {"produto_id": 3, "quantidade": 1}
  ]
}
```

`cliente_nome` e `cliente_email` são opcionais. Se enviados, são validados, gravados e repassados no evento para o Notificações.

Fluxo:

1. Valida o corpo (`400` se inválido). `produto_id` e `quantidade` precisam ser inteiros positivos.
2. Para cada produto, chama `GET http://ms-cardapio:8080/cardapio/produtos/{produto_id}` (Service Discovery pelo nome do Service). Produto inexistente devolve `422`. Cardápio fora do ar ou com resposta fora do contrato devolve `503`.
3. Calcula o total com os preços recebidos.
4. Grava `pedidos` e `pedido_itens` numa transação, com status `PENDENTE`.
5. Publica o evento no RabbitMQ, esperando a confirmação do broker.
6. Marca o pedido como `PUBLICADO` e responde `201` com `{pedido_id, itens, total, status}`. Cada item traz `produto_id`, `nome`, `preco_unitario` e `quantidade`.

Se a publicação falhar, o pedido fica `PENDENTE` e a API responde `502`. Não há outbox: o status deixa claro que o evento não saiu.

## Banco (MySQL, só deste serviço)

- `pedidos`: `id`, `cliente_nome`, `cliente_email`, `total`, `status`, `criado_em`.
- `pedido_itens`: `id`, `pedido_id` (FK), `produto_id`, `nome`, `preco_unitario`, `quantidade`.

O nome e o preço ficam copiados no item. O Pedidos nunca lê o banco do Cardápio. As tabelas são criadas na subida, com nova tentativa enquanto o MySQL sobe.

## Evento publicado

Exchange `pedido.criado`, tipo fanout, durável. Mensagem persistente, JSON:

```json
{
  "pedido_id": 1,
  "itens": [{"produto_id": 1, "quantidade": 2}, {"produto_id": 3, "quantidade": 1}],
  "total": 57,
  "criado_em": "2026-11-10T23:30:00.000Z"
}
```

`pedido_id`, `produto_id` e `quantidade` vão como números inteiros, porque o Estoque descarta strings sem aviso. `total` e `criado_em` são extras que o Estoque ignora. `cliente_nome` e `cliente_email` só entram no evento se vierem no pedido. O Pedidos só declara o exchange e não cria filas: cada consumidor cria a sua. A conexão com o RabbitMQ tenta de novo na subida e reconecta se cair.

## Variáveis de ambiente

| Variável | Padrão | Observação |
| --- | --- | --- |
| `MYSQL_PASSWORD` | (obrigatória) | Senha do usuário do MySQL |
| `RABBITMQ_URL` | | URL pronta, ex.: `amqp://USUARIO:SENHA@rabbitmq:5672/%2F`. Se ausente, usa as variáveis abaixo |
| `RABBITMQ_HOST` | (obrigatória sem `RABBITMQ_URL`) | No cluster: `rabbitmq` |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | `guest` / `guest` | Credenciais do broker |
| `RABBITMQ_PORT` / `RABBITMQ_VHOST` | `5672` / `/` | |
| `MYSQL_HOST` | `localhost` | No cluster: `mysql-pedidos` |
| `MYSQL_PORT` | `3306` | |
| `MYSQL_USER` | `pedidos` | |
| `MYSQL_DATABASE` | `pedidosdb` | |
| `CARDAPIO_URL` | `http://ms-cardapio:8080` | Nome e porta do Service do Cardápio |
| `PORT` | `3000` | |

## Executar localmente

O Compose sobe MySQL, RabbitMQ e o Pedidos. O Cardápio não faz parte do Compose: rode o `ms-cardapio` real na sua máquina (porta 8080) ou aponte para onde ele estiver com `CARDAPIO_URL`. Por padrão o Pedidos usa `http://host.docker.internal:8080`.

```bash
docker compose up --build -d   # ou: CARDAPIO_URL=http://OUTRO_HOST:8080 docker compose up --build -d
docker compose logs -f ms-pedidos
```

Aguarde os logs `mysql pronto`, `rabbitmq pronto exchange=pedido.criado` e `ms-pedidos ouvindo na porta 3000`.

```bash
curl -fsS http://localhost:3000/pedidos/health
curl -fsS http://localhost:8080/cardapio/produtos   # o Cardápio, rodando fora do Compose
```

Use os produtos do seed do Cardápio (no plano: 1 X-Burger 25,00, 2 Batata 12,00 e 3 Refri 7,00; dois do produto 1 mais um do produto 3 dão total 57).

### Criar um pedido e ver o evento

Em um terminal, inicie o consumidor de teste. Ele cria a fila temporária `teste-local` ligada ao exchange e imprime os eventos. Faça isso antes de criar o pedido, porque a fila só recebe o que chega depois dela.

```bash
docker compose exec ms-pedidos node tools/consumir-teste.js
```

Em outro terminal, crie o pedido.

```bash
curl -sS -X POST http://localhost:3000/pedidos \
  -H 'Content-Type: application/json' \
  -d '{"itens":[{"produto_id":1,"quantidade":2},{"produto_id":3,"quantidade":1}]}'
```

A resposta esperada é `201` com `pedido_id`, os `itens` com `preco_unitario`, `"total":57` e `"status":"PUBLICADO"`. Os logs do `ms-pedidos` mostram `GET http://ms-cardapio:8080/cardapio/produtos/1 ...` e `publicado pedido.criado pedido_id=1`. O consumidor de teste imprime o evento, e o painel do RabbitMQ em http://localhost:15672 (usuário `pedidos`, senha `rabbitmq-local`) mostra o exchange `pedido.criado`.

```bash
curl -fsS http://localhost:3000/pedidos/1
curl -fsS http://localhost:3000/pedidos
```

### Casos de erro

```bash
# produto inexistente: 422
curl -i -X POST http://localhost:3000/pedidos -H 'Content-Type: application/json' \
  -d '{"itens":[{"produto_id":99,"quantidade":1}]}'

# quantidade como string: 400
curl -i -X POST http://localhost:3000/pedidos -H 'Content-Type: application/json' \
  -d '{"itens":[{"produto_id":1,"quantidade":"2"}]}'

# cardápio fora do ar: 503
# pare o Cardápio que você subiu fora do Compose
curl -i -X POST http://localhost:3000/pedidos -H 'Content-Type: application/json' \
  -d '{"itens":[{"produto_id":1,"quantidade":1}]}'
# e suba-o de novo
```

Testes unitários (validação, total e cliente do Cardápio contra um servidor falso criado no próprio teste), sem precisar de Docker:

```bash
npm install
npm test
```

Para encerrar: `docker compose down -v`. Se você rodou uma versão anterior deste projeto, use `down -v` antes de subir de novo, para recriar as tabelas.

## Integrar ao EKS da equipe

Use o mesmo namespace dos outros serviços. O MySQL precisa de uma StorageClass padrão capaz de provisionar o PVC, o que no EKS exige o driver EBS CSI. Confira o contexto e o storage antes de aplicar.

```bash
kubectl config current-context
kubectl get storageclass
```

Publique a imagem com uma tag fixa no registry da equipe (ECR). O exemplo assume nós AMD64.

```bash
IMAGE='REGISTRY/ms-pedidos:TAG'
docker buildx build --platform linux/amd64 --tag "$IMAGE" --push .
```

Copie `.env.eks.exemplo` para `.env.eks` e troque os valores. `RABBITMQ_USER` e `RABBITMQ_PASSWORD` são as credenciais do RabbitMQ da infra da equipe. O host (`RABBITMQ_HOST=rabbitmq`) e o Cardápio (`CARDAPIO_URL=http://ms-cardapio:8080`) já estão no Deployment como variáveis de ambiente, o que serve de evidência de Service Discovery: `kubectl -n "$NS" describe deploy/ms-pedidos`.

```bash
NS='NAMESPACE_DA_EQUIPE'
kubectl -n "$NS" create secret generic ms-pedidos --from-env-file=.env.eks
kubectl -n "$NS" apply -f k8s/mysql-pedidos.yaml
kubectl -n "$NS" rollout status deploy/mysql-pedidos --timeout=180s

kubectl -n "$NS" apply -f k8s/ms-pedidos-service.yaml
kubectl set image --local -f k8s/ms-pedidos.yaml ms-pedidos="$IMAGE" -o yaml |
  kubectl -n "$NS" apply -f -
kubectl -n "$NS" rollout status deploy/ms-pedidos --timeout=180s
```

Inclua o conteúdo de `k8s/ingress-trecho.yaml` na lista `spec.rules[].http.paths` do Ingress compartilhado:

```yaml
- path: /pedidos
  pathType: Prefix
  backend:
    service:
      name: ms-pedidos
      port:
        number: 80
```

### Testar antes da apresentação

1. Confirme que o Estoque já está de pé: `kubectl -n "$NS" logs deploy/ms-estoque --tail=5` precisa mostrar `consumidor pronto fila=estoque`. Se o Pedidos publicar antes, a mensagem se perde.
2. Confirme que o Pedidos está pronto: `kubectl -n "$NS" logs deploy/ms-pedidos --tail=10` deve mostrar `mysql pronto`, `rabbitmq pronto exchange=pedido.criado` e `ms-pedidos ouvindo na porta 3000`.
3. Com o hostname do Ingress em `BASE_URL`, anote o saldo: `curl -fsS "$BASE_URL/estoque"`.
4. Crie o pedido (2 unidades do produto 1 e 1 do produto 3) e anote o `pedido_id`.

   ```bash
   curl -sS -X POST "$BASE_URL/pedidos" -H 'Content-Type: application/json' \
     -d '{"itens":[{"produto_id":1,"quantidade":2},{"produto_id":3,"quantidade":1}]}'
   ```

5. Veja `baixa ok pedido_id=...` em `kubectl -n "$NS" logs deploy/ms-estoque --tail=20` e consulte `/estoque` de novo. O produto 1 cai 2, o produto 3 cai 1 e o produto 2 mantém o saldo.
6. Com o Cardápio em várias réplicas, o log do Pedidos mostra `cardapio_pods=...` com nomes de Pods diferentes ao longo de vários pedidos.
