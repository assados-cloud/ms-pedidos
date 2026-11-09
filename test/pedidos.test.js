process.env.MYSQL_PASSWORD = 'x';
process.env.RABBITMQ_URL = 'amqp://x';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
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

test('rejeita itens vazios, e-mail ruim e corpo inválido', () => {
  assert.ok(validarPedido({ ...base, itens: [] }).erros);
  assert.ok(validarPedido({ ...base, cliente_email: 'maria', itens: [{ produto_id: 1, quantidade: 1 }] }).erros);
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

test('cliente do cardápio conversa com o mock', async () => {
  const porta = 18099;
  process.env.CARDAPIO_URL = `http://127.0.0.1:${porta}`;
  const mock = spawn('node', [path.join(__dirname, '../mock-cardapio/server.js')], {
    env: { ...process.env, PORT: String(porta) },
    stdio: 'ignore',
  });
  try {
    await new Promise((r) => setTimeout(r, 600));
    const { buscarProduto, ProdutoNaoEncontrado } = require('../src/cardapio');
    const produto = await buscarProduto(1);
    assert.equal(produto.nome, 'X-Burger');
    assert.equal(produto.preco, 22);
    await assert.rejects(() => buscarProduto(99), ProdutoNaoEncontrado);
  } finally {
    mock.kill();
  }
});
