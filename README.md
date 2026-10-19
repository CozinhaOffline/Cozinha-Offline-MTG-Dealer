# Plataforma MTG Dealer (versão com servidor)

Esta versão salva o estoque em banco de dados e pode atualizar o ML consultando a Ligamagic.

## Como rodar localmente

1. Instale o Node.js (https://nodejs.org)
2. Abra o terminal nesta pasta e rode:
   ```
   npm install
   npm start
   ```
3. Acesse http://localhost:3000 no navegador.

## Como hospedar na nuvem (Railway — mais fácil)

1. Crie conta em https://railway.app
2. Clique em "New Project" → "Deploy from GitHub" (ou faça upload desta pasta).
3. Adicione um banco SQLite (ou Postgres se preferir depois).
4. O Railway detecta o `package.json` e sobe sozinho.
5. Ele te dá um endereço (ex.: `sua-plataforma.railway.app`).

## Atualizar preços da Ligamagic

Na plataforma, use o botão **"Atualizar ML (Ligamagic)"**.  
Ele consulta a Ligamagic carta por carta (com pausa para não sobrecarregar) e grava o menor preço encontrado.

**Atenção:** a Ligamagic não tem API oficial. O serviço lê o site. Se o layout mudar, o seletor de preço pode precisar de ajuste.

## Próximos passos

- Migrar completamente a interface para usar a API (hoje o HTML ainda funciona em modo local).
- Adicionar agendamento automático de atualização.
- Melhorar o parser de preços da Ligamagic conforme necessário.
