/* ============================================================
   持久化层
   - 原生 App（Capacitor）：用 Filesystem 插件读写 Documents 目录下的真实 .sqlite 文件
   - 普通浏览器：退回 localStorage（存 base64）
   ============================================================ */

const DB_FILENAME = 'member-points.sqlite';
const LS_KEY = 'member-points:sqlite:b64';

export function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

/** 取原生插件（Capacitor 8 通过全局 Capacitor.Plugins 暴露） */
function plugins() {
  const P = (window.Capacitor && window.Capacitor.Plugins) || {};
  const fs = P.Filesystem;
  if (!fs) throw new Error('Filesystem 插件未就绪');
  return fs;
}

export async function createPersistence() {
  if (isNative()) {
    const Filesystem = plugins();
    const Directory = { Documents: 'DOCUMENTS', Data: 'DATA', Cache: 'CACHE' };
    try {
      await Filesystem.mkdir({ path: 'Database', directory: Directory.Documents, recursive: true });
    } catch { /* 已存在 */ }
    return {
      async load() {
        try {
          const res = await Filesystem.readFile({
            path: `Database/${DB_FILENAME}`,
            directory: Directory.Documents,
          });
          const bin = atob(res.data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return bytes;
        } catch {
          return null;
        }
      },
      async save(bytes) {
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        await Filesystem.writeFile({
          path: `Database/${DB_FILENAME}`,
          data: btoa(bin),
          directory: Directory.Documents,
        });
      },
    };
  }

  // 浏览器：localStorage
  return {
    async load() {
      try {
        const b64 = localStorage.getItem(LS_KEY);
        if (!b64) return null;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      } catch {
        return null;
      }
    },
    async save(bytes) {
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      localStorage.setItem(LS_KEY, btoa(bin));
    },
  };
}
