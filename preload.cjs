'use strict'

const { contextBridge } = require('electron')

// Minimal bridge so the web GUI can detect it is running inside the desktop
// shell (e.g. to surface a "desktop" affordance) without gaining Node access.
contextBridge.exposeInMainWorld('dshDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
})
