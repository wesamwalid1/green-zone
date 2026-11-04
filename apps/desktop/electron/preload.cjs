const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('m5azenDesktop', {
  isDesktop: true,
  platform: process.platform,
});
