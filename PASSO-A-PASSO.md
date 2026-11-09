# Passo a passo do ms-pedidos

Ordem pensada para a entrega de 10/11. Os itens 1 e 2 você faz sozinho; do 3 em diante depende da infra e dos colegas.

## 1. Testar local (30 min)

1. Instale Docker e Node 20 (só para `npm test`).
2. Na pasta do projeto: `docker compose up --build -d` e `docker compose logs -f ms-pedidos`.
3. Siga a seção "Criar um pedido e ver o evento" do README. Você deve ver `201`, o evento no consumidor de teste e o pedido em `GET /pedidos/1`.
4. Teste os erros (422, 400, 503). Eles aparecem na apresentação se perguntarem sobre tratamento de falhas.
5. Rode `npm install && npm test`. Se quiser, commite também o `package-lock.json` que o `npm install` gera, para builds reprodutíveis.

## 2. Combinar com a equipe (hoje, antes de subir)

- **Cardápio:** `GET /cardapio/produtos/{id}` (como no plano da equipe) devolve `200` com `nome` e `preco` (numérico) ou `404`. O Service se chama `ms-cardapio` e usa a porta **8080**. Não há mock no projeto: para testar local, o Pedidos precisa do ms-cardapio real (ou de qualquer servidor com esse contrato) na porta 8080.
- **Notificações (no lugar da Cozinha):** declara a própria fila durável `notificacoes`, ligada ao exchange `pedido.criado` (fanout, durável). O evento só traz `cliente_nome` e `cliente_email` se o pedido os enviar; sem eles, a notificação pode citar só o `pedido_id` e o `total`. Rota sugerida: `GET /notificacoes`.
- **Infra:** namespace comum, Service `rabbitmq` e usuário/senha do RabbitMQ (vão no Secret como `RABBITMQ_USER` e `RABBITMQ_PASSWORD`), registry das imagens (ECR ou Docker Hub público) e o hostname do Ingress.

## 3. Imagem no ECR

```bash
REGION=us-east-1            # use a região do cluster
ACCOUNT=123456789012        # id da conta AWS
aws ecr create-repository --repository-name ms-pedidos --region $REGION   # só se a infra ainda não criou
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
IMAGE=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/ms-pedidos:v1
docker buildx build --platform linux/amd64 --tag "$IMAGE" --push .
```

Use `--platform linux/amd64` principalmente se estiver num Mac com chip Apple, senão o Pod fica em `exec format error`.

## 4. Deploy no EKS

Siga a seção "Integrar ao EKS da equipe" do README. Resumo:

1. `kubectl config current-context` e `kubectl get storageclass` (precisa existir uma StorageClass padrão).
2. Criar `.env.eks` a partir de `.env.eks.exemplo` (senhas do MySQL e usuário/senha do RabbitMQ) e o Secret `ms-pedidos`.
3. `kubectl apply` do `mysql-pedidos.yaml` e esperar o rollout.
4. Aplicar o Service e o Deployment (com `kubectl set image --local`).
5. Pedir à pessoa da infra para incluir `/pedidos` no Ingress (ou incluir você mesmo, usando `k8s/ingress-trecho.yaml`).

Ordem entre serviços: Estoque primeiro (esperar `consumidor pronto fila=estoque`), depois Notificações, Cardápio e Pedidos.

## 5. Teste do fluxo completo

Siga "Testar antes da apresentação" no README. O fluxo que conta pontos: `POST /pedidos` → Pedidos chama o Cardápio por REST → grava no MySQL → publica no RabbitMQ → Estoque dá baixa (`baixa ok`) → `GET /estoque` mostra os saldos novos.

## 6. Roteiro da sua parte na apresentação

| Item cobrado | O que mostrar |
| --- | --- |
| Papel do serviço | Ele recebe o pedido, valida, consulta o Cardápio, grava e publica o evento. É a ponte entre REST e RabbitMQ. |
| Linguagem e banco | Node.js/Express e MySQL (o Estoque é Python/PostgreSQL). |
| Isolamento dos dados | Só o Pedidos acessa o `mysql-pedidos`. O item guarda nome e preço copiados, então não lê o banco do Cardápio. Mostre as tabelas: `kubectl -n $NS exec deploy/mysql-pedidos -- sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT id,total,status FROM pedidos"'` |
| Serviço no EKS | `kubectl -n $NS get pods,svc` |
| Ingress | `curl $BASE_URL/pedidos` sem rewrite, vindo de fora do cluster. |
| Service Discovery | `CARDAPIO_URL=http://ms-cardapio:8080` e `RABBITMQ_HOST=rabbitmq` no Deployment (`kubectl describe deploy/ms-pedidos`), nunca IP de Pod. O log do Pedidos mostra a URL chamada. |
| Balanceamento | Dispare vários pedidos e mostre `cardapio_pods=` mudando no log do Pedidos (e o campo `pod` do Cardápio). |
| REST + RabbitMQ | O fluxo completo do passo 5: log `GET http://ms-cardapio:8080/...` e `publicado pedido.criado pedido_id=...`. Se quiser mostrar a falha, derrube o Cardápio e mostre o `503`. |

Perguntas que costumam aparecer: por que não há outbox (prazo; o status `PENDENTE` mostra o evento que não saiu), por que o exchange é fanout (cada consumidor cria a sua fila), e por que `pedido_id` vai como inteiro (o Estoque valida tipos estritos).

## 7. Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `mysql-pedidos` com PVC em `Pending` | Falta o driver EBS CSI ou uma StorageClass padrão |
| Pod do MySQL reinicia com erro de diretório não vazio | O `subPath: mysql` do manifest foi removido (o volume EBS traz `lost+found`) |
| `exec format error` no Pod | Imagem compilada para ARM; refaça o build com `--platform linux/amd64` |
| `ImagePullBackOff` | Tag errada ou nós sem permissão de leitura no ECR |
| `ms-pedidos` não fica Ready | MySQL ainda subindo ou Secret `ms-pedidos` com chaves erradas; veja `kubectl logs` |
| `502` no POST e pedido `PENDENTE` | RabbitMQ fora do ar, URL/credenciais erradas ou vhost diferente |
| `201`, mas o Estoque não dá baixa | O Estoque ainda não tinha criado a fila quando o evento saiu (mensagem perdida), ou o log do Pedidos mostra `evento sem fila destinatária` |
| `503` no POST | O Service `ms-cardapio` não existe, está em outro namespace ou sem Pods prontos |
| `422` no POST | O produto não existe no Cardápio |
