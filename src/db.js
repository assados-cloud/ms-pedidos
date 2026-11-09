const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.mysql,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  timezone: 'Z',
});

const TABELA_PEDIDOS = `
  CREATE TABLE IF NOT EXISTS pedidos (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    cliente_nome VARCHAR(120) NOT NULL,
    cliente_email VARCHAR(160) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB`;

const TABELA_ITENS = `
  CREATE TABLE IF NOT EXISTS pedido_itens (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    pedido_id BIGINT NOT NULL,
    produto_id INT NOT NULL,
    nome VARCHAR(120) NOT NULL,
    preco_unitario DECIMAL(10,2) NOT NULL,
    quantidade INT NOT NULL,
    CONSTRAINT fk_itens_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos (id)
  ) ENGINE=InnoDB`;

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tenta conectar enquanto o MySQL sobe e cria as tabelas.
async function iniciar(tentativas = 40) {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (erro) {
      if (i >= tentativas) throw erro;
      console.log(`aguardando mysql tentativa=${i} erro=${erro.code || erro.name}`);
      await espera(3000);
    }
  }
  await pool.query(TABELA_PEDIDOS);
  await pool.query(TABELA_ITENS);
  console.log('mysql pronto tabelas=pedidos,pedido_itens');
}

async function ping() {
  await pool.query('SELECT 1');
}

// Grava o pedido e os itens na mesma transação, com status PENDENTE.
async function criarPedido({ cliente_nome, cliente_email, total, criadoEm, itens }) {
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    const [resultado] = await conexao.query(
      'INSERT INTO pedidos (cliente_nome, cliente_email, total, status, criado_em) VALUES (?, ?, ?, ?, ?)',
      [cliente_nome, cliente_email, total, 'PENDENTE', criadoEm]
    );
    const pedidoId = resultado.insertId;
    const linhas = itens.map((i) => [pedidoId, i.produto_id, i.nome, i.preco_unitario, i.quantidade]);
    await conexao.query(
      'INSERT INTO pedido_itens (pedido_id, produto_id, nome, preco_unitario, quantidade) VALUES ?',
      [linhas]
    );
    await conexao.commit();
    return pedidoId;
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

async function marcarPublicado(pedidoId) {
  await pool.query("UPDATE pedidos SET status = 'PUBLICADO' WHERE id = ?", [pedidoId]);
}

async function listar() {
  const [linhas] = await pool.query(
    'SELECT id, cliente_nome, cliente_email, total, status, criado_em FROM pedidos ORDER BY id DESC LIMIT 100'
  );
  return linhas;
}

async function buscar(pedidoId) {
  const [pedidos] = await pool.query(
    'SELECT id, cliente_nome, cliente_email, total, status, criado_em FROM pedidos WHERE id = ?',
    [pedidoId]
  );
  if (pedidos.length === 0) return null;
  const [itens] = await pool.query(
    'SELECT produto_id, nome, preco_unitario, quantidade FROM pedido_itens WHERE pedido_id = ? ORDER BY id',
    [pedidoId]
  );
  return { ...pedidos[0], itens };
}

async function fechar() {
  await pool.end();
}

module.exports = { iniciar, ping, criarPedido, marcarPublicado, listar, buscar, fechar };
