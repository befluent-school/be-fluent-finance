// PM2 — mantém o Be Fluent Finance no ar e reinicia sozinho se cair ou se a VPS reiniciar.
// Uso (como usuário deploy, na pasta /var/www/financeiro):
//   pm2 start deploy/ecosystem.config.cjs && pm2 save
// Escuta só em 127.0.0.1:3300 — quem fala com a internet é o Nginx.
// As variáveis vêm de frontend/.env (lido pelo próprio Next no start e no build).
module.exports = {
  apps: [
    {
      name: "financeiro-web",
      cwd: "./frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3300",
      // Uma instância: rate limit e sessões ficam no Postgres, mas não há
      // necessidade de cluster para poucos usuários internos.
      instances: 1,
      max_memory_restart: "600M",
      env: { NODE_ENV: "production" },
    },
  ],
};
