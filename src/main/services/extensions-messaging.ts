import { ipcMain, BrowserWindow, webContents } from 'electron';
import { windowsManager } from '..';
import { promises } from 'fs';
import { resolve } from 'path';
import { getPath } from '~/utils/paths';

declare global {
  namespace Electron {
    interface Session {
      cookiesChangedTargets: Map<number, WebContents>;
      lastFocusedWindow: BrowserWindow;
      activeTab: number;
    }
  }
}

export const webContentsToTab = (wc: Electron.WebContents): chrome.tabs.Tab => {
  if (!wc.session) return null;
  return {
    id: wc.id,
    index: wc.id,
    windowId: wc.hostWebContents ? wc.hostWebContents.id : wc.id,
    highlighted: wc.id === wc.session.activeTab,
    active: wc.id === wc.session.activeTab,
    selected: wc.id === wc.session.activeTab,
    pinned: false,
    discarded: false,
    autoDiscardable: false,
    url: wc.getURL(),
    title: wc.getTitle(),
    incognito: false,
    audible: wc.isCurrentlyAudible(),
  };
};

export const getAllWebContentsInSession = (ses: Electron.Session) => {
  return webContents.getAllWebContents().filter(x => x.session === ses);
};

export const runExtensionsMessagingService = () => {
  const extensionsPath = getPath('extensions');

  ipcMain.on('get-extensions-paths', e => {
    e.returnValue = windowsManager.sessionsManager.extensionsPaths;
  });

  ipcMain.on('get-extension-path', (e, id) => {
    e.returnValue = windowsManager.sessionsManager.extensionsPaths.get(id);
  });

  ipcMain.handle(`api-tabs-query`, e => {
    const tabs = getAllWebContentsInSession(e.sender.session).map(x => ({
      ...webContentsToTab(x),
      lastFocusedWindow: true,
      currentWindow: true,
    }));

    return tabs.filter(Boolean);
  });

  ipcMain.handle(
    `api-tabs-create`,
    async (e, data: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> => {
      const type = e.sender.getType();

      let realWindowId = -1;
      let bw: BrowserWindow;

      if (data.windowId) {
        realWindowId = data.windowId;
      } else if (type === 'backgroundPage') {
        bw = e.sender.session.lastFocusedWindow;
      } else if (type === 'browserView' || type === 'webview') {
        bw = (e.sender as any).getOwnerBrowserWindow();
      }

      if (bw) {
        realWindowId = bw.id;
      }

      data.windowId = realWindowId;

      const tabId = await windowsManager.sessionsManager.onCreateTab(data);
      return webContentsToTab(webContents.fromId(tabId));
    },
  );

  ipcMain.handle(
    `api-tabs-insertCSS`,
    async (
      e,
      tabId: number,
      details: chrome.tabs.InjectDetails,
      extensionId: string,
    ) => {
      const contents = webContents.fromId(tabId);

      if (contents) {
        if (details.hasOwnProperty('file')) {
          details.code = await promises.readFile(
            resolve(extensionsPath, extensionId, details.file),
            'utf8',
          );
        }

        contents.insertCSS(details.code);
      }
    },
  );

  ipcMain.handle(
    `api-browserAction-setBadgeText`,
    (
      e,
      extensionId: string,
      details: chrome.browserAction.BadgeTextDetails,
    ) => {
      windowsManager.sessionsManager.onSetBadgeText(extensionId, details);
    },
  );

  ipcMain.on(`api-addListener`, (e, data) => {
    if (data.scope === 'cookies' && data.name === 'onChanged') {
      e.sender.session.cookiesChangedTargets.set(data.id, e.sender);
    }
  });

  ipcMain.on(`api-removeListener`, (e, data) => {
    if (data.scope === 'cookies' && data.name === 'onChanged') {
      e.sender.session.cookiesChangedTargets.delete(data.id);
    }
  });

  ipcMain.handle(`api-cookies-getAll`, async (e, details) => {
    return await e.sender.session.cookies.get(details);
  });

  ipcMain.handle(`api-cookies-remove`, async (e, details) => {
    const cookie = (await e.sender.session.cookies.get(details))[0];

    if (!cookie) {
      return null;
    }

    await e.sender.session.cookies.remove(details.url, details.name);

    return cookie;
  });

  ipcMain.handle(`api-cookies-set`, async (e, details) => {
    await e.sender.session.cookies.set(details);

    const cookie = (await e.sender.session.cookies.get(details))[0];

    if (!cookie) {
      return null;
    }

    return cookie;
  });
};
