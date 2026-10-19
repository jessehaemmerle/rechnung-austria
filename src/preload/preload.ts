import { contextBridge, ipcRenderer } from 'electron';
import { channels, type Api } from './api';

const api = Object.fromEntries(
  Object.entries(channels).map(([name, channel]) => [
    name,
    async (...args: unknown[]) => {
      const res = await ipcRenderer.invoke(channel, ...args);
      if (!res.ok) throw new Error(res.error);
      return res.value;
    },
  ]),
) as unknown as Api;

contextBridge.exposeInMainWorld('api', api);
