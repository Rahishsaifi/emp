// Shared helpers
function el(tag, props = {}, ...children) {
	const node = document.createElement(tag);
	Object.entries(props).forEach(([k, v]) => {
		if (k === 'class') node.className = v;
		else if (k === 'dataset') Object.assign(node.dataset, v);
		else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
		else if (v !== undefined && v !== null) node.setAttribute(k, v);
	});
	children.flat().forEach((c) => {
		if (c == null) return;
		if (typeof c === 'string') node.appendChild(document.createTextNode(c));
		else node.appendChild(c);
	});
	return node;
}

// HOME PAGE LOGIC
window.appHome = (function () {
	let selectedFilePath = null;

	async function loadMonths() {
		const grid = document.getElementById('monthsGrid');
		grid.innerHTML = '';
		const months = await window.api.getSavedMonths();
		if (!months || months.length === 0) {
			grid.appendChild(el('div', { class: 'muted' }, 'No months yet. Import an Excel file.'));
			return;
		}
		months.forEach((m) => {
			const header = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' },
				el('div', { class: 'title', style: 'font-size:16px;' }, m),
				el('button', { class: 'btn btn-secondary', style: 'padding:6px 10px;', onclick: async () => openDeleteModal(m) }, 'Delete')
			);
			const card = el('div', { class: 'card month-card' },
				header,
				el('div', { class: 'muted', style: 'margin-top:6px;' }, 'Click to open')
			);
			card.addEventListener('click', () => {
				localStorage.setItem('selectedMonth', m);
				window.location.href = 'month.html';
			});
			// Prevent card click when clicking Delete
			card.querySelector('button').addEventListener('click', (e) => e.stopPropagation());
			grid.appendChild(card);
		});
	}

	let pendingDeleteMonth = null;
	function showDeleteModal() {
		document.getElementById('deleteModalBackdrop').classList.add('show');
		document.getElementById('deletePinInput').value = '';
		document.getElementById('deletePinInput').focus();
	}
	function hideDeleteModal() {
		document.getElementById('deleteModalBackdrop').classList.remove('show');
	}
	function openDeleteModal(monthKey) { pendingDeleteMonth = monthKey; showDeleteModal(); }

	async function confirmDelete() {
		const pin = document.getElementById('deletePinInput').value.trim();
		if (pin !== '123456') { alert('Invalid PIN'); return; }
		if (!pendingDeleteMonth) return;
		const res = await window.api.deleteMonthJson(pendingDeleteMonth);
		if (!res.ok) { alert('Failed to delete: ' + (res.error || 'Unknown')); return; }
		pendingDeleteMonth = null;
		hideDeleteModal();
		await loadMonths();
	}

	function showModal() {
		document.getElementById('modalBackdrop').classList.add('show');
		document.getElementById('monthInput').focus();
	}
	function hideModal() {
		document.getElementById('modalBackdrop').classList.remove('show');
	}

	async function onImportClick() {
		const filePath = await window.api.openExcelDialog();
		if (!filePath) return;
		selectedFilePath = filePath;
		showModal();
	}

	async function onSaveMonth() {
		const monthKey = document.getElementById('monthInput').value.trim();
		if (!monthKey) return;
		if (!selectedFilePath) return;
		const parsed = await window.api.parseExcelToJson(selectedFilePath);
		if (!parsed.ok) {
			alert('Failed to parse Excel: ' + parsed.error);
			return;
		}
		const saved = await window.api.saveMonthJson(monthKey, parsed.rows);
		if (!saved.ok) {
			alert('Failed to save JSON: ' + saved.error);
			return;
		}
		hideModal();
		selectedFilePath = null;
		document.getElementById('monthInput').value = '';
		await loadMonths();
	}

	function bindEvents() {
		// import button removed; menu handles import
		const logoutBtn = document.getElementById('logoutBtn');
		if (logoutBtn) {
			logoutBtn.addEventListener('click', () => {
				localStorage.clear();
				window.location.href = 'login.html';
			});
		}
		document.getElementById('cancelModal').addEventListener('click', hideModal);
		document.getElementById('saveMonthBtn').addEventListener('click', onSaveMonth);
		document.getElementById('cancelDelete').addEventListener('click', hideDeleteModal);
		document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);
	}

	return {
		init: async function () {
			bindEvents();
			await loadMonths();
			window.api && window.api.setLoggedIn(true);
			window.addEventListener('app-logout', () => {
				localStorage.clear();
				window.api && window.api.setLoggedIn(false);
				window.location.href = 'login.html';
			});
			window.addEventListener('app-import', async () => {
				// Always open import flow from menu
				await onImportClick();
			});
		},
	};
})();

// MONTH PAGE LOGIC
window.appMonth = (function () {
	let currentMonth = null;

	function renderNoResults() {
		const results = document.getElementById('results');
		results.innerHTML = '';
		results.appendChild(el('div', { class: 'muted' }, 'No records found'));
	}

function renderTable(rows) {
		const results = document.getElementById('results');
		results.innerHTML = '';
		if (!rows || rows.length === 0) return renderNoResults();

	const headers = Object.keys(rows[0] || {});
	const grid = el('div', { class: 'grid-cards' });
	rows.forEach((r) => {
		const allowanceKey = headers.find(h => h.toLowerCase().includes('allow')) || 'Allowance';
		const headerRow = el('div', { class: 'kv' },
			el('span', { class: 'badge' }, 'Employee'),
			el('span', { class: 'v' }, String(r[headers[0]] ?? ''))
		);
		const fields = el('div', { class: 'kv-grid' },
			...headers.map((h) => el('div', { class: 'kv' }, el('span', { class: 'k' }, h), el('span', { class: 'v' }, String(r[h] ?? ''))))
		);
		const actions = el('div', { style: 'margin-top:8px; display:flex; justify-content:flex-end;' },
			el('button', { class: 'btn btn-secondary', onclick: () => openDrawerWithRow({ [allowanceKey]: r[allowanceKey] }) }, 'View Allowance')
		);
		const card = el('div', { class: 'card' }, headerRow, fields, actions);
		grid.appendChild(card);
	});
	results.appendChild(grid);
	}

function renderSummary(rows) {
	const summaryEl = document.getElementById('summary');
	if (!summaryEl) return;
	summaryEl.innerHTML = '';
	if (!rows || rows.length === 0) return;
	// Attempt to infer fields case-insensitively
	const getField = (obj, names) => {
		const lowerMap = Object.fromEntries(Object.keys(obj).map(k => [k.toLowerCase(), k]));
		for (const n of names) {
			const key = lowerMap[n.toLowerCase()];
			if (key) return obj[key];
		}
		return 0;
	};
	const first = rows[0];
	const allowances = Number(getField(first, ['allowance', 'allowances', 'hra', 'da'])) || 0;
	const leaves = Number(getField(first, ['leaves', 'leave_days', 'absent'])) || 0;
	const total = Number(getField(first, ['total', 'netpay', 'net'])) || 0;

	const card = (label, value) => el('div', { class: 'card', style: 'padding:16px' },
		el('div', { class: 'muted', style: 'margin-bottom:6px' }, label),
		el('div', { class: 'title', style: 'font-size:22px;' }, String(value))
	);
	summaryEl.appendChild(card('Allowances', allowances));
	summaryEl.appendChild(card('Leaves', leaves));
	summaryEl.appendChild(card('Total', total));
}

function openDrawerWithRow(row) {
	const backdrop = document.getElementById('drawerBackdrop');
	const body = document.getElementById('drawerBody');
	if (!backdrop || !body) return;
	body.innerHTML = '';
	const entries = Object.entries(row);
	entries.forEach(([k, v]) => {
		body.appendChild(el('div', { style: 'margin-bottom:10px;' },
			el('div', { class: 'muted' }, k),
			el('div', {}, String(v))
		));
	});
	backdrop.classList.add('show');
}

function closeDrawer() {
	document.getElementById('drawerBackdrop')?.classList.remove('show');
}

	async function search() {
		const empId = document.getElementById('empId').value.trim();
		const res = await window.api.readMonthJson(currentMonth);
		if (!res.ok) return renderNoResults();
		const rows = res.rows || [];
		const filtered = empId
			? rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase() === empId.toLowerCase()))
			: rows;
	renderTable(filtered);
	renderSummary(filtered);
	}

	function bindEvents() {
		document.getElementById('searchBtn').addEventListener('click', search);
		const logoutBtn = document.getElementById('logoutBtn');
		if (logoutBtn) {
			logoutBtn.addEventListener('click', () => {
				localStorage.clear();
				window.location.href = 'login.html';
			});
		}
		document.getElementById('empId').addEventListener('keyup', (e) => { if (e.key === 'Enter') search(); });
		document.getElementById('drawerClose').addEventListener('click', closeDrawer);
		document.getElementById('drawerBackdrop').addEventListener('click', (e) => { if (e.target.id === 'drawerBackdrop') closeDrawer(); });
	}

	return {
		init: function () {
			currentMonth = localStorage.getItem('selectedMonth');
			document.getElementById('monthTitle').textContent = currentMonth || 'Month';
			bindEvents();
			window.api && window.api.setLoggedIn(true);
			window.addEventListener('app-logout', () => {
				localStorage.clear();
				window.api && window.api.setLoggedIn(false);
				window.location.href = 'login.html';
			});
			window.addEventListener('app-import', () => {
				// From month page, go to home then import
				window.location.href = 'home.html';
			});
		},
	};
})();


