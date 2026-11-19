import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('myWebCamDesktop', {
  startVirtualCam: (wsUrl: string, password?: string) =>
    ipcRenderer.invoke('virtual-cam:start', { wsUrl, password }),
  stopVirtualCam: () => ipcRenderer.invoke('virtual-cam:stop'),
  onVirtualCamLog: (cb: (msg: string) => void) =>
    ipcRenderer.on('virtual-cam:log', (_e, msg) => cb(msg)),
  onVirtualCamError: (cb: (msg: string) => void) =>
    ipcRenderer.on('virtual-cam:error', (_e, msg) => cb(msg)),
  onVirtualCamStopped: (cb: (code: number) => void) =>
    ipcRenderer.on('virtual-cam:stopped', (_e, code) => cb(code)),
});
