const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
	getSavedMonths: () => ipcRenderer.invoke('get:saved-months'),
	openExcelDialog: () => ipcRenderer.invoke('open:excel-dialog'),
	parseExcelToJson: (filePath) => ipcRenderer.invoke('parse:excel-to-json', { filePath }),
	saveMonthJson: (monthKey, rows) => ipcRenderer.invoke('save:month-json', { monthKey, rows }),
	readMonthJson: (monthKey) => ipcRenderer.invoke('read:month-json', { monthKey }),
	deleteMonthJson: (monthKey) => ipcRenderer.invoke('delete:month-json', { monthKey }),
	setLoggedIn: (isLoggedIn) => ipcRenderer.send('session:set', !!isLoggedIn),
});

ipcRenderer.on('perform-logout', () => {
	window.dispatchEvent(new Event('app-logout'));
});

ipcRenderer.on('perform-import', () => {
	window.dispatchEvent(new Event('app-import'));
});


