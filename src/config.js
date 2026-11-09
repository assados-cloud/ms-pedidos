function obrigatoria(nome) {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`variável obrigatória ausente: ${nome}`);
    process.exit(1);
  }
  return valor;
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
  rabbitmqUrl: obrigatoria('RABBITMQ_URL'),
  cardapioUrl: (process.env.CARDAPIO_URL || 'http://ms-cardapio').replace(/\/+$/, ''),
};
