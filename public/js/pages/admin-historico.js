import { initAppShell } from '../components/app-shell.js';
import { initHistoryPage } from '../components/history-page.js';

if (await initAppShell('administrador')) {
  await initHistoryPage({
    columns: ['data', 'horario', 'barbeiro', 'cliente', 'servico', 'valor', 'status'],
    barberFilter: true,
  });
}
