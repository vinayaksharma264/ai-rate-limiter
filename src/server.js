'use strict';

const express = require('express');
const config = require('./config');
const generalRoutes = require('./routes/general');
const aiRoutes = require('./routes/ai');

const app = express();

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/general', generalRoutes);
app.use('/api/ai', aiRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`ai-rate-limiter listening on :${config.port}`);
  });
}

module.exports = app;
