function obrigatoria(nome) {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`variável obrigatória ausente: ${nome}`);
    process.exit(1);
  }
  return valor;
}

// Aceita RABBITMQ_URL pronta ou monta a URL com RABBITMQ_HOST/PORT/USER/PASSWORD/VHOST.
function urlDoRabbitmq() {
  if (process.env.RABBITMQ_URL) return process.env.RABBITMQ_URL;
  const host = obrigatoria('RABBITMQ_HOST');
  const usuario = encodeURIComponent(process.env.RABBITMQ_USER || 'guest');
  const senha = encodeURIComponent(process.env.RABBITMQ_PASSWORD || 'guest');
  const porta = process.env.RABBITMQ_PORT || '5672';
  const vhost = encodeURIComponent(process.env.RABBITMQ_VHOST || '/');
  return `amqp://${usuario}:${senha}@${host}:${porta}/${vhost}`;
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'pedidos',
    password: obrigatoria('MYSQL_PASSWORD'),
    database: process.env.MYSQL_DATABASE || 'pedidosdb',
  },
  rabbitmqUrl: urlDoRabbitmq(),
  cardapioUrl: (process.env.CARDAPIO_URL || 'http://ms-cardapio:8080').replace(/\/+$/, ''),
};
