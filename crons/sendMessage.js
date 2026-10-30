

const task = cron.schedule('0 3 * * *', doWork, {
  name: 'nightly-backup',
  timezone: 'America/Sao_Paulo',
});