import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('brtlb', {
  platform: process.platform,
  versions: process.versions,
});
