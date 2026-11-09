// Consumidor de teste: cria a fila temporária "teste-local" ligada ao exchange
// pedido.criado e imprime os eventos. Serve para ver o que o Pedidos publica.
// Rode ANTES de criar o pedido (a fila só recebe o que chega depois de criada).
const amqp = require('amqplib');

async function main() {
  const conexao = await amqp.connect(process.env.RABBITMQ_URL);
  const canal = await conexao.createChannel();
  await canal.assertExchange('pedido.criado', 'fanout', { durable: true });
  const { queue } = await canal.assertQueue('teste-local', { autoDelete: true });
  await canal.bindQueue(queue, 'pedido.criado', '');
  console.log(`consumidor de teste pronto fila=${queue} (Ctrl+C para sair)`);
  canal.consume(queue, (msg) => {
    console.log(msg.content.toString());
    canal.ack(msg);
  });
}

main().catch((erro) => {
  console.error(erro.message);
  process.exit(1);
});
