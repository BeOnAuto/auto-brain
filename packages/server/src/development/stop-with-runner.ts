process.stdin.once('end', () => {
  process.emit('SIGTERM', 'SIGTERM');
});
process.stdin.resume().unref();
