const axios = require('axios');
const cheerio = require('cheerio');

async function buscarPrecoLigamagic(nomeCarta) {
  try {
    const url = `https://www.ligamagic.com.br/?view=cards/card&card=${encodeURIComponent(nomeCarta)}`;
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);
    // Tenta pegar o menor preço (ajuste o seletor se a Ligamagic mudar o layout)
    let menor = null;
    $('td, .preco, .menor-preco, [class*="preco"]').each((i, el) => {
      const texto = $(el).text().trim();
      const match = texto.match(/R\$\s*([\d.,]+)/);
      if (match) {
        const valor = parseFloat(match[1].replace('.', '').replace(',', '.'));
        if (!isNaN(valor) && (menor === null || valor < menor)) menor = valor;
      }
    });

    // Fallback: procura em qualquer texto da página
    if (menor === null) {
      const bodyText = $('body').text();
      const matches = bodyText.match(/R\$\s*([\d.,]+)/g) || [];
      const valores = matches.map(m => parseFloat(m.replace(/R\$\s*/, '').replace('.', '').replace(',', '.'))).filter(v => !isNaN(v) && v > 0);
      if (valores.length) menor = Math.min(...valores);
    }

    return menor;
  } catch (err) {
    console.error(`Erro ao buscar ${nomeCarta}:`, err.message);
    return null;
  }
}

module.exports = { buscarPrecoLigamagic };
