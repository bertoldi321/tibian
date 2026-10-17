# Tibian — Rua das Bases

Jogo de bases para a comunidade jogar 1x por dia. Cada jogador tem um lote numa rua,
ganha 1 ataque e 1 upgrade por dia (guarda até 3), compra armas nas lojas parceiras
e derruba as bases dos vizinhos.

## Rodar local

    node server.js        # sem DATABASE_URL roda em memória
    npm test              # teste de ponta a ponta

## Variáveis de ambiente

| Nome | Para quê |
| --- | --- |
| `DATABASE_URL` | Postgres. Sem ela, tudo fica só em memória. |
| `ADMIN_KEY` | Libera `POST /api/admin/grant` (dar ações/moedas em teste). |
| `COUPONS` | Códigos de parceiro, ex.: `RUNICA:marreta,OUTRO:marreta` |
| `PARTNER_FORJA` / `PARTNER_ARSENAL` | Nome das marcas parceiras nas lojas. |

## Regras (resumo)

- Novo dia à meia-noite de Brasília: +1 ataque e +1 upgrade (máximo 3 guardados).
- Upgrades: Defesa (+vida das camadas), Ataque (+dano), Economia (+moedas/dia), com retorno decrescente.
- Camadas: cerca → muro ou portão → núcleo. Camadas recuperam 10% por dia.
- Derrubar o núcleo: quem atacou divide 25% das moedas do alvo; o golpe final ganha troféu; o alvo ganha 24h de escudo.
