const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inteiroPositivo(valor) {
  return Number.isInteger(valor) && valor > 0;
}

// Valida o corpo do POST /pedidos. Retorna { erros } ou { dados }.
function validarPedido(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { erros: ['o corpo deve ser um objeto JSON'] };
  }

  const erros = [];
  // cliente_nome e cliente_email são opcionais (o plano da equipe só exige os itens).
  let nome = null;
  if (corpo.cliente_nome !== undefined && corpo.cliente_nome !== null) {
    nome = typeof corpo.cliente_nome === 'string' ? corpo.cliente_nome.trim() : '';
    if (!nome || nome.length > 120) {
      erros.push('cliente_nome, se enviado, deve ser um texto de 1 a 120 caracteres');
    }
  }

  let email = null;
  if (corpo.cliente_email !== undefined && corpo.cliente_email !== null) {
    email = typeof corpo.cliente_email === 'string' ? corpo.cliente_email.trim() : '';
    if (!EMAIL.test(email) || email.length > 160) {
      erros.push('cliente_email, se enviado, deve ser um e-mail válido');
    }
  }

  const itens = [];
  if (!Array.isArray(corpo.itens) || corpo.itens.length === 0 || corpo.itens.length > 50) {
    erros.push('itens deve ser uma lista de 1 a 50 itens');
  } else {
    corpo.itens.forEach((item, i) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !inteiroPositivo(item.produto_id) ||
        !inteiroPositivo(item.quantidade) ||
        item.quantidade > 1000
      ) {
        erros.push(`itens[${i}] precisa de produto_id e quantidade inteiros positivos (quantidade até 1000)`);
      } else {
        itens.push({ produto_id: item.produto_id, quantidade: item.quantidade });
      }
    });
  }

  if (erros.length > 0) {
    return { erros };
  }

  // Soma as quantidades se o mesmo produto aparecer mais de uma vez.
  const somados = new Map();
  for (const item of itens) {
    somados.set(item.produto_id, (somados.get(item.produto_id) || 0) + item.quantidade);
  }

  return {
    dados: {
      cliente_nome: nome,
      cliente_email: email,
      itens: [...somados].map(([produto_id, quantidade]) => ({ produto_id, quantidade })),
    },
  };
}

// Soma em centavos para evitar erro de ponto flutuante.
function calcularTotal(itens) {
  const centavos = itens.reduce(
    (soma, item) => soma + Math.round(item.preco_unitario * 100) * item.quantidade,
    0
  );
  return centavos / 100;
}

module.exports = { validarPedido, calcularTotal };
