const amqp = require('amqplib');
const config = require('./config');

const EXCHANGE = 'pedido.criado';
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let canal = null;
let encerrando = false;

// Conecta em segundo plano e reconecta se a conexão cair.
async function manterConexao() {
  while (!encerrando) {
    let conexao = null;
    try {
      conexao = await amqp.connect(config.rabbitmqUrl);
      const novoCanal = await conexao.createConfirmChannel();
      // Mesmos parâmetros do Estoque (fanout, durável), senão o broker recusa.
      await novoCanal.assertExchange(EXCHANGE, 'fanout', { durable: true });

      novoCanal.on('return', (msg) => {
        console.warn(`evento sem fila destinatária pedido_id=${msg.properties.messageId}`);
      });

      await new Promise((resolve) => {
        conexao.on('error', (erro) => console.error(`rabbitmq erro=${erro.message}`));
        novoCanal.on('error', (erro) => console.error(`rabbitmq canal erro=${erro.message}`));
        conexao.on('close', resolve);
        novoCanal.on('close', resolve);
        canal = novoCanal;
        console.log(`rabbitmq pronto exchange=${EXCHANGE}`);
      });
    } catch (erro) {
      console.error(`rabbitmq indisponível erro=${erro.message}`);
    }

    canal = null;
    if (conexao) {
      conexao.close().catch(() => {});
    }
    if (!encerrando) {
      console.log('rabbitmq reconectando em 5s');
      await espera(5000);
    }
  }
}

function iniciar() {
  manterConexao();
}

function conectado() {
  return canal !== null;
}

// Publica com confirmação do broker. Rejeita se não houver confirmação em 5s.
function publicar(evento) {
  return new Promise((resolve, reject) => {
    if (!canal) {
      reject(new Error('rabbitmq indisponível'));
      return;
    }
    const temporizador = setTimeout(() => reject(new Error('sem confirmação do broker')), 5000);
    try {
      canal.publish(
        EXCHANGE,
        '',
        Buffer.from(JSON.stringify(evento)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: String(evento.pedido_id),
          mandatory: true,
        },
        (erro) => {
          clearTimeout(temporizador);
          if (erro) reject(erro);
          else resolve();
        }
      );
    } catch (erro) {
      clearTimeout(temporizador);
      reject(erro);
    }
  });
}

function fechar() {
  encerrando = true;
}

module.exports = { iniciar, conectado, publicar, fechar };
