import { createApp } from "vue";
import { initializeLocalData } from './lib/local-data.js';
import { isTauri, invokeTauri } from './lib/platform.js';
import "virtual:uno.css";
import "./styles.css";
import "./expense-ui.css";
// Load store singletons only after migration/the disk snapshot is ready.
async function start() {
  const root = document.querySelector('#app');
  const message = document.createElement('p');
  message.className = 'startup-message';
  message.textContent = '正在打开本地数据…'; root.append(message);
  try {
    await initializeLocalData(text => { message.textContent = text; });
    const { default: App } = await import('./App.vue');
    createApp(App).mount(root);
    if (import.meta.env.DEV) {
      import('./invoiceStore.js').then(m => { window.__inv = m; });
      import('./store').then(m => { window.__del = m; });
    }
  } catch (error) {
    message.textContent = '无法打开或迁移本地数据：' + String(error?.message || error) + '。原数据已保留，请勿删除旧存储。';
    const retry = document.createElement('button'); retry.className = 'btn'; retry.textContent = '重试打开';
    retry.onclick = () => location.reload(); root.append(retry);
    if (isTauri()) {
      const recover = document.createElement('button'); recover.className = 'btn'; recover.textContent = '从完整备份恢复';
      recover.onclick = async () => {
        recover.disabled = true;
        try { if (await invokeTauri('local_data_recover')) location.reload(); }
        catch (cause) { message.textContent = '恢复未完成，原数据已保留：' + String(cause?.message || cause); }
        finally { recover.disabled = false; }
      };
      root.append(recover);
    }
  }
}
start();
