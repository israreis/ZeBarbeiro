import { initAppShell } from '../components/app-shell.js';
import { initHistoryPage } from '../components/history-page.js';

if (await initAppShell('barbeiro')) {
  await initHistoryPage({ columns: ['data', 'cliente', 'servico', 'valor', 'horario', 'status'] });
}
