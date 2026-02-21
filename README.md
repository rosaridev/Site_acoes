# Alerta de Ações/FIIs da B3

Aplicação web para monitorar ativos da B3 (ex: `MXRF11`) e avisar quando o preço ficar abaixo de um valor alvo.

## Recursos

- Salvar alertas por ticker + preço-alvo
- Consulta automática de preço
- Persistência local em JSON
- Notificação interna no site
- Notificação do navegador (com a aba aberta)
- Integração opcional com webhook (Discord/Slack/Make/Zapier etc.)

## Como rodar

```bash
cp .env.example .env
node server.js
```

Acesse: `http://localhost:3000`

## Exemplo

- Ticker: `MXRF11`
- Preço alvo: `9.80`

Quando o preço for menor ou igual ao alvo, o alerta dispara.

## Observações

- Os preços são consultados via endpoint público do Yahoo Finance para símbolos `.SA`.
- Não é integração oficial com a B3.
