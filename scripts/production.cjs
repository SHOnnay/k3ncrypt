// Cross-platform production entry point; no development runtime is required.
process.env.NODE_ENV = 'production';
const action = process.argv[2];
if (!['serve', 'migrate'].includes(action)) throw new Error('Choose serve or migrate.');
require(action === 'serve' ? '../dist/index.js' : '../dist/scripts/migrate.js');
