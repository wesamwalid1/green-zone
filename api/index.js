// Vercel serverless entry: boots the Nest app once per instance and reuses it across requests.
const { createApp } = require('../apps/api/dist/app.factory');

let handler;

function getHandler() {
  handler ??= createApp().then(async (app) => {
    await app.init();
    return app.getHttpAdapter().getInstance();
  }).catch((error) => {
    handler = undefined;
    throw error;
  });
  return handler;
}

module.exports = async (req, res) => {
  const server = await getHandler();
  return server(req, res);
};
