const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const DATA_DIR = path.join(__dirname, 'data');

function monthKeyToDir(monthKey) {
	const safe = monthKey.toLowerCase().replace(/\s+/g, '-');
	return path.join(DATA_DIR, safe);
}

function normalizeSheetName(name) {
	return String(name || '')
		.trim()
		.replace(/[\\/]+/g, '-')
		.replace(/\s+/g, '-')
		.toLowerCase();
}

function ensureDataDir() {
	if (!fs.existsSync(DATA_DIR)) {
		fs.mkdirSync(DATA_DIR, { recursive: true });
	}
}

function createWindow() {
	const win = new BrowserWindow({
		width: 1100,
		height: 720,
		minWidth: 900,
		minHeight: 600,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	win.loadFile('login.html');
	return win;
}

app.whenReady().then(() => {
	ensureDataDir();
	const win = createWindow();
	Menu.setApplicationMenu(buildMenu());
	updateMenuForLogin(false);

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

function monthKeyToFilename(monthKey) {
	// Example: "Jan 2025" -> jan-2025.json
	const safe = monthKey.toLowerCase().replace(/\s+/g, '-');
	return `${safe}.json`;
}

function readJsonForMonth(monthKey) {
	ensureDataDir();
	const filePath = path.join(DATA_DIR, monthKeyToFilename(monthKey));
	if (!fs.existsSync(filePath)) return null;
	try {
		const raw = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(raw);
	} catch (e) {
		return null;
	}
}

function listSavedMonths() {
    ensureDataDir();
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
    const monthKeys = new Set();
    for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.json')) {
            const base = e.name.replace(/\.json$/, '');
            const parts = base.split('-');
            const mon = parts[0] || '';
            const year = parts[1] || '';
            const dispMon = mon.charAt(0).toUpperCase() + mon.slice(1, 3);
            monthKeys.add(`${dispMon} ${year}`);
        } else if (e.isDirectory()) {
            const base = e.name;
            const parts = base.split('-');
            const mon = parts[0] || '';
            const year = parts[1] || '';
            const dispMon = mon.charAt(0).toUpperCase() + mon.slice(1, 3);
            monthKeys.add(`${dispMon} ${year}`);
        }
    }
    return Array.from(monthKeys);
}

ipcMain.handle('get:saved-months', () => {
	return listSavedMonths();
});

ipcMain.handle('open:excel-dialog', async () => {
	const result = await dialog.showOpenDialog({
		title: 'Select Excel file',
		filters: [{ name: 'Excel', extensions: ['xlsx'] }],
		properties: ['openFile'],
	});
	if (result.canceled || result.filePaths.length === 0) return null;
	return result.filePaths[0];
});

ipcMain.handle('parse:excel-to-json', async (_evt, { filePath }) => {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheets = {};
        for (const sheetName of workbook.SheetNames) {
            const ws = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
            sheets[sheetName] = json;
        }
        return { ok: true, sheets };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('save:month-json', async (_evt, { monthKey, sheets }) => {
    try {
        ensureDataDir();
        const dir = monthKeyToDir(monthKey);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        for (const [sheetName, rows] of Object.entries(sheets || {})) {
            const normalized = normalizeSheetName(sheetName);
            const target = path.join(dir, `${normalized}.json`);
            fs.writeFileSync(target, JSON.stringify(rows, null, 2), 'utf-8');
        }
        const firstSheetName = Object.keys(sheets || {})[0];
        if (firstSheetName) {
            const legacyPath = path.join(DATA_DIR, monthKeyToFilename(monthKey));
            fs.writeFileSync(legacyPath, JSON.stringify(sheets[firstSheetName] || [], null, 2), 'utf-8');
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('read:month-json', async (_evt, { monthKey, sheet }) => {
    ensureDataDir();
    const dir = monthKeyToDir(monthKey);
    if (sheet) {
        const file = path.join(dir, `${normalizeSheetName(sheet)}.json`);
        if (!fs.existsSync(file)) return { ok: false, error: 'Not found' };
        try {
            const raw = fs.readFileSync(file, 'utf-8');
            return { ok: true, rows: JSON.parse(raw) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    const data = readJsonForMonth(monthKey);
    if (!data) return { ok: false, error: 'Not found' };
    return { ok: true, rows: data };
});

ipcMain.handle('list:month-sheets', async (_evt, { monthKey }) => {
    try {
        const dir = monthKeyToDir(monthKey);
        if (!fs.existsSync(dir)) return { ok: true, sheets: [] };
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        const sheets = files.map(f => f.replace(/\.json$/, ''));
        return { ok: true, sheets };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('delete:month-json', async (_evt, { monthKey }) => {
    try {
        ensureDataDir();
        const legacyFile = path.join(DATA_DIR, monthKeyToFilename(monthKey));
        const dir = monthKeyToDir(monthKey);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        if (fs.existsSync(legacyFile)) {
            fs.unlinkSync(legacyFile);
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

function sendLogoutToFocusedWindow() {
	const focused = BrowserWindow.getFocusedWindow();
	if (focused) {
		focused.webContents.send('perform-logout');
	}
}

function sendImportToFocusedWindow() {
	const focused = BrowserWindow.getFocusedWindow();
	if (focused) {
		focused.webContents.send('perform-import');
	}
}

function buildMenu() {
	const template = [
		{
			label: 'File',
			submenu: [
				{ id: 'menu-import', label: 'Import Excel', accelerator: 'CmdOrCtrl+I', click: () => sendImportToFocusedWindow(), visible: false },
				{ type: 'separator' },
				{ id: 'menu-logout', label: 'Logout', click: () => sendLogoutToFocusedWindow(), visible: false },
				{ type: 'separator' },
				{ label: 'Close Window', role: 'close' },
			],
		},
		{
			label: 'View',
			submenu: [
				{ role: 'reload' },
				{ role: 'toggledevtools' },
				{ type: 'separator' },
				{ role: 'resetzoom' },
				{ role: 'zoomin' },
				{ role: 'zoomout' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
			],
		},
	];
	return Menu.buildFromTemplate(template);
}

function updateMenuForLogin(isLoggedIn) {
	const menu = Menu.getApplicationMenu();
	if (!menu) return;
	const importItem = menu.getMenuItemById('menu-import');
	const logoutItem = menu.getMenuItemById('menu-logout');
	if (importItem) importItem.visible = !!isLoggedIn;
	if (logoutItem) logoutItem.visible = !!isLoggedIn;
}

ipcMain.on('session:set', (_evt, isLoggedIn) => {
	updateMenuForLogin(!!isLoggedIn);
});


