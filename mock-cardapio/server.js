// Mock do Cardápio, SOMENTE para teste local. No cluster, use o ms-cardapio real.
// Segue o contrato combinado: GET /cardapio/{id} -> 200 {id, nome, preco} ou 404.
const http = require('http');
const os = require('os');

const PRODUTOS = [
  { id: 1, nome: 'X-Burger', preco: 22.0 },
  { id: 2, nome: 'Batata Frita', preco: 14.5 },
  { id: 3, nome: 'Refrigerante', preco: 13.0 },
];

const porta = Number(process.env.PORT || 80);

function responder(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

http
  .createServer((req, res) => {
    const caminho = new URL(req.url, 'http://localhost').pathname;
    if (req.method !== 'GET') {
      return responder(res, 405, { erro: 'método não permitido' });
    }
    if (caminho === '/cardapio') {
      return responder(res, 200, PRODUTOS.map((p) => ({ ...p, pod: os.hostname() })));
    }
    const m = caminho.match(/^\/cardapio\/(\d+)$/);
    if (m) {
      const produto = PRODUTOS.find((p) => p.id === Number(m[1]));
      return produto
        ? responder(res, 200, { ...produto, pod: os.hostname() })
        : responder(res, 404, { erro: 'produto não encontrado' });
    }
    return responder(res, 404, { erro: 'rota não encontrada' });
  })
  .listen(porta, () => console.log(`mock do cardápio ouvindo na porta ${porta}`));
