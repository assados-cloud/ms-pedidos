const express = require('express');
const config = require('./config');
const db = require('./db');
const rabbit = require('./rabbit');
const { buscarProduto, ProdutoNaoEncontrado, CardapioIndisponivel } = require('./cardapio');
const { validarPedido, calcularTotal } = require('./validacao');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Probe de readiness. Fica sob /pedidos para o Ingress não precisar de outra regra.
// Precisa vir antes de /pedidos/:id.
app.get('/pedidos/health', async (req, res) => {
  try {
    await db.ping();
    res.json({ status: 'ok', mysql: 'ok', rabbitmq: rabbit.conectado() ? 'ok' : 'indisponivel' });
  } catch {
    res.status(503).json({ status: 'erro', mysql: 'indisponivel' });
  }
});

app.post('/pedidos', async (req, res, next) => {
  try {
    const { erros, dados } = validarPedido(req.body);
    if (erros) {
      return res.status(400).json({ erro: 'corpo inválido', detalhes: erros });
    }

    // REST síncrono: consulta o Cardápio (uma vez por produto).
    let produtos;
    try {
      produtos = await Promise.all(dados.itens.map((item) => buscarProduto(item.produto_id)));
    } catch (erro) {
      if (erro instanceof ProdutoNaoEncontrado) {
        return res.status(422).json({ erro: erro.message });
      }
      if (erro instanceof CardapioIndisponivel) {
        console.error(`cardapio indisponivel erro="${erro.message}"`);
        return res.status(503).json({ erro: 'serviço de cardápio indisponível' });
      }
      throw erro;
    }

    const itens = dados.itens.map((item, i) => ({
      produto_id: item.produto_id,
      nome: produtos[i].nome,
      preco_unitario: produtos[i].preco,
      quantidade: item.quantidade,
    }));
    const pods = [...new Set(produtos.map((p) => p.pod).filter(Boolean))];
    const total = calcularTotal(itens);
    const criadoEm = new Date();

    const pedidoId = await db.criarPedido({
      cliente_nome: dados.cliente_nome,
      cliente_email: dados.cliente_email,
      total,
      criadoEm,
      itens,
    });
    console.log(`pedido gravado pedido_id=${pedidoId} total=${total} cardapio_pods=${pods.join(',') || '-'}`);

    // Contrato do Estoque: pedido_id, produto_id e quantidade precisam ser números inteiros.
    const evento = {
      pedido_id: pedidoId,
      itens: itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade })),
      total,
      criado_em: criadoEm.toISOString(),
      cliente_nome: dados.cliente_nome,
      cliente_email: dados.cliente_email,
    };

    try {
      await rabbit.publicar(evento);
    } catch (erro) {
      console.error(`falha ao publicar pedido_id=${pedidoId} erro="${erro.message}"`);
      return res.status(502).json({
        erro: 'pedido gravado, mas o evento não foi publicado',
        pedido_id: pedidoId,
        status: 'PENDENTE',
      });
    }

    let status = 'PUBLICADO';
    try {
      await db.marcarPublicado(pedidoId);
    } catch (erro) {
      status = 'PENDENTE';
      console.error(`evento publicado, mas falhou ao marcar status pedido_id=${pedidoId} erro="${erro.message}"`);
    }
    console.log(`evento publicado pedido_id=${pedidoId} status=${status}`);
    return res.status(201).json({ pedido_id: pedidoId, total, status });
  } catch (erro) {
    return next(erro);
  }
});

app.get('/pedidos', async (req, res, next) => {
  try {
    res.json(await db.listar());
  } catch (erro) {
    next(erro);
  }
});

app.get('/pedidos/:id', async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ erro: 'id inválido' });
    }
    const pedido = await db.buscar(Number(req.params.id));
    if (!pedido) {
      return res.status(404).json({ erro: 'pedido não encontrado' });
    }
    return res.json(pedido);
  } catch (erro) {
    return next(erro);
  }
});

// eslint-disable-next-line no-unused-vars
app.use((erro, req, res, next) => {
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON malformado' });
  }
  console.error(`erro inesperado ${erro.stack || erro}`);
  return res.status(500).json({ erro: 'erro interno' });
});

async function main() {
  rabbit.iniciar();
  await db.iniciar();
  const servidor = app.listen(config.port, () => {
    console.log(`ms-pedidos ouvindo na porta ${config.port}`);
  });

  const encerrar = () => {
    console.log('encerrando ms-pedidos');
    rabbit.fechar();
    servidor.close(async () => {
      await db.fechar().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);
}

main().catch((erro) => {
  console.error(`falha ao iniciar erro=${erro.message}`);
  process.exit(1);
});
