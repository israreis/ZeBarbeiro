import { initAppShell } from '../components/app-shell.js';
import { initHistoryPage } from '../components/history-page.js';

if (await initAppShell('cliente')) {
  await initHistoryPage({ columns: ['data', 'barbeiro', 'servico', 'valor', 'horario', 'status'] });
}
