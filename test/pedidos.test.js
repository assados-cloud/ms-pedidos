process.env.MYSQL_PASSWORD = 'x';
process.env.RABBITMQ_URL = 'amqp://x';

const test = require('node:test');
const assert = require('node:assert');
const { validarPedido, calcularTotal } = require('../src/validacao');

const base = { cliente_nome: 'Maria', cliente_email: 'maria@exemplo.com' };

test('aceita pedido válido e soma itens repetidos', () => {
  const { dados, erros } = validarPedido({
    ...base,
    itens: [
      { produto_id: 1, quantidade: 2 },
      { produto_id: 1, quantidade: 1 },
      { produto_id: 3, quantidade: 1 },
    ],
  });
  assert.equal(erros, undefined);
  assert.deepEqual(dados.itens, [
    { produto_id: 1, quantidade: 3 },
    { produto_id: 3, quantidade: 1 },
  ]);
});

test('cliente é opcional, mas validado se enviado', () => {
  const sem = validarPedido({ itens: [{ produto_id: 1, quantidade: 1 }] });
  assert.equal(sem.erros, undefined);
  assert.equal(sem.dados.cliente_nome, null);
  assert.ok(validarPedido({ cliente_email: 'ruim', itens: [{ produto_id: 1, quantidade: 1 }] }).erros);
});

test('rejeita strings e valores não inteiros nos itens', () => {
  for (const item of [
    { produto_id: '1', quantidade: 2 },
    { produto_id: 1, quantidade: 1.5 },
    { produto_id: 1, quantidade: 0 },
    { produto_id: -1, quantidade: 1 },
  ]) {
    assert.ok(validarPedido({ ...base, itens: [item] }).erros, JSON.stringify(item));
  }
});

test('rejeita itens vazios e corpo inválido', () => {
  assert.ok(validarPedido({ ...base, itens: [] }).erros);
  assert.ok(validarPedido(null).erros);
});

test('calcula o total sem erro de ponto flutuante', () => {
  assert.equal(
    calcularTotal([
      { preco_unitario: 22, quantidade: 2 },
      { preco_unitario: 13, quantidade: 1 },
    ]),
    57
  );
  assert.equal(calcularTotal([{ preco_unitario: 0.1, quantidade: 3 }]), 0.3);
});

test('cliente do cardápio lê produto, trata 404 e indisponibilidade', async () => {
  const http = require('node:http');
  const servidor = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/cardapio/produtos/1') {
      res.end(JSON.stringify({ id: 1, nome: 'X-Burger', preco: 25.0, pod: 'pod-a' }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  process.env.CARDAPIO_URL = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const { buscarProduto, ProdutoNaoEncontrado, CardapioIndisponivel } = require('../src/cardapio');
    const produto = await buscarProduto(1);
    assert.equal(produto.nome, 'X-Burger');
    assert.equal(produto.preco, 25);
    assert.ok(produto.url.endsWith('/cardapio/produtos/1'));
    await assert.rejects(() => buscarProduto(99), ProdutoNaoEncontrado);
    await new Promise((r) => servidor.close(r));
    await assert.rejects(() => buscarProduto(1), CardapioIndisponivel);
  } finally {
    servidor.close();
  }
});
