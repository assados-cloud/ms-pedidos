const config = require('./config');

class ProdutoNaoEncontrado extends Error {
  constructor(produtoId) {
    super(`produto ${produtoId} não existe no cardápio`);
    this.produtoId = produtoId;
  }
}

class CardapioIndisponivel extends Error {}

// Service Discovery: o host é o nome do Service do Kubernetes (http://ms-cardapio).
async function buscarProduto(produtoId) {
  let resposta;
  let url;
  try {
    url = `${config.cardapioUrl}/cardapio/produtos/${produtoId}`;
    resposta = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
  } catch (erro) {
    throw new CardapioIndisponivel(`falha ao chamar o cardápio: ${erro.name}`);
  }

  if (resposta.status === 404) {
    throw new ProdutoNaoEncontrado(produtoId);
  }
  if (!resposta.ok) {
    throw new CardapioIndisponivel(`cardápio respondeu status ${resposta.status}`);
  }

  let dados;
  try {
    dados = await resposta.json();
  } catch {
    throw new CardapioIndisponivel('cardápio devolveu uma resposta que não é JSON');
  }

  const preco = dados && dados.preco !== null && dados.preco !== '' ? Number(dados.preco) : NaN;
  if (!dados || typeof dados.nome !== 'string' || !Number.isFinite(preco) || preco < 0) {
    throw new CardapioIndisponivel('cardápio devolveu uma resposta fora do contrato');
  }

  // "pod" é opcional: o Cardápio devolve o nome do Pod para mostrar o balanceamento.
  return { produto_id: produtoId, nome: dados.nome, preco, pod: dados.pod, url };
}

module.exports = { buscarProduto, ProdutoNaoEncontrado, CardapioIndisponivel };
