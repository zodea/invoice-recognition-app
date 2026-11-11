// 大型表格仅用于分供方和单价对比；进入这些页面时再加载并注册。
import VxeUI from 'vxe-pc-ui';
import VxeUITable from 'vxe-table';
import 'vxe-pc-ui/lib/style.css';
import 'vxe-table/lib/style.css';

const installedApps = new WeakSet();

export function installTableUi(app) {
  if (installedApps.has(app)) return;
  app.use(VxeUI).use(VxeUITable);
  installedApps.add(app);
}
