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
		const saved = await window.api.saveMonthJson(monthKey, parsed.sheets);
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
    let availableSheets = [];
    let selectedSheet = 'salary';

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
        const table = el('table', {});
        const thead = el('thead', {},
            el('tr', {}, ...headers.map(h => el('th', {}, h)))
        );
        const tbody = el('tbody');
        rows.forEach((r) => {
            const tr = el('tr', { style: 'cursor:pointer;' });
            tr.addEventListener('click', () => openDrawerWithRow(r));
            headers.forEach(h => {
                tr.appendChild(el('td', {}, String(r[h] ?? '')));
            });
            tbody.appendChild(tr);
        });
        table.appendChild(thead);
        table.appendChild(tbody);
        results.appendChild(table);
}

function renderSummary() { /* removed per design */ }

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
        const res = await window.api.readMonthJson(currentMonth, selectedSheet);
		if (!res.ok) return renderNoResults();
		const rows = res.rows || [];
	let filtered = rows;
	if (empId) {
		// Prefer matching by employee_id (or similar) exactly
		const headers = Object.keys(rows[0] || {});
		const lowerToActual = Object.fromEntries(headers.map(h => [h.toLowerCase(), h]));
		const candidateKeys = ['employee_id', 'emp_id', 'employeeid', 'employee id', 'id', 'code'];
		const matchKey = candidateKeys.map(k => lowerToActual[k]).find(Boolean);
		if (matchKey) {
			filtered = rows.filter(r => String(r[matchKey]).toLowerCase() === empId.toLowerCase());
		} else {
			// fallback: any-cell exact match
			filtered = rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase() === empId.toLowerCase()));
		}
		// Show only one record (first match)
		if (filtered.length > 1) filtered = [filtered[0]];
	}
    renderEmployeeDetails(filtered[0] || null);
    renderSalaryDetails(filtered[0] || null);
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

    async function loadSheets() {
        const res = await window.api.listMonthSheets(currentMonth);
        if (!res.ok) { availableSheets = []; return; }
        availableSheets = res.sheets || [];
        // Default to salary if available else first
        selectedSheet = availableSheets.includes('salary') ? 'salary' : (availableSheets[0] || 'salary');
    }


    function normalizeLabel(s) {
        return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function mapAllowanceLabelToSheet(label) {
        const n = normalizeLabel(label);
        const prefer = [
            ['night-shift-allowance', ['night-shift-allowance', 'nightshift-allowance', 'night-shift', 'nsa']],
            ['stand-by-allowance', ['standby', 'stand-by-allowance', 'stand-by', 'standby-allowance']],
            ['meal-allowance', ['meal-allowance', 'meal']],
            ['salary', ['salary', 'salary-sheet']]
        ];
        for (const [sheet, aliases] of prefer) {
            if (aliases.includes(n)) return sheet;
        }
        let best = null, bestScore = 0;
        (availableSheets || []).forEach(s => {
            const ns = normalizeLabel(s);
            let score = 0;
            if (ns === n) score += 3;
            if (ns.includes(n) || n.includes(ns)) score += 2;
            if (ns.split('-').some(k => n.includes(k))) score += 1;
            if (score > bestScore) { best = s; bestScore = score; }
        });
        return best || null;
    }

    function getField(obj, names) {
        if (!obj) return '';
        const lowerMap = Object.fromEntries(Object.keys(obj).map(k => [k.toLowerCase(), k]));
        for (const n of names) {
            const key = lowerMap[String(n).toLowerCase()];
            if (key) return obj[key];
        }
        return '';
    }

    function renderEmployeeDetails(row) {
        const elWrap = document.getElementById('employeeDetails');
        if (!elWrap) return;
        elWrap.innerHTML = '';
        if (!row) { elWrap.appendChild(el('div', { class: 'muted' }, 'No employee selected')); return; }

        const monthDisp = currentMonth || '-';
        const wrap = el('div', { class: 'pslip-wrap' });
        const title = el('div', { class: 'pslip-title' }, 'SALARY PAYOUT DETAILS FOR - ', el('span', {}, monthDisp));

        const top = el('table', { class: 'pslip-table' });
        const tb = el('tbody');
        const row1 = el('tr', {},
            el('td', {}, 'Name'),
            el('td', {}, String(getField(row, ['name', 'employee name', 'emp_name']) || '-')),
            el('td', {}, 'Code'),
            el('td', { class: 'pslip-hl' }, String(getField(row, ['code', 'employee_id', 'emp_id', 'id']) || '-'))
        );
        const row2 = el('tr', {},
            el('td', {}, 'Department'),
            el('td', {}, String(getField(row, ['department', 'dept']) || '-')),
            el('td', {}, 'Band'),
            el('td', {}, String(getField(row, ['band', 'grade']) || '-'))
        );
        const row3 = el('tr', {},
            el('td', {}, 'Month'),
            el('td', {}, monthDisp.replace(/\s+/, ' / ')),
            el('td', {}, 'Paid days - current month'),
            el('td', {}, String(getField(row, ['paid days - current month', 'paid_days', 'paid days']) || '-'))
        );
        const row4 = el('tr', {},
            el('td', {}, 'Arrear days - previous months'),
            el('td', {}, String(getField(row, ['arrear days - previous months', 'arrear_days']) || '-')),
            el('td', {}, ''),
            el('td', {}, '')
        );
        tb.appendChild(row1);
        tb.appendChild(row2);
        tb.appendChild(row3);
        tb.appendChild(row4);
        top.appendChild(tb);

        wrap.appendChild(title);
        wrap.appendChild(top);
        elWrap.appendChild(wrap);
    }

    async function showAllowanceFor(label, empId) {
        const sheet = mapAllowanceLabelToSheet(label);
        if (!sheet) return;
        const res = await window.api.readMonthJson(currentMonth, sheet);
        if (!res.ok) return;
        const rows = res.rows || [];
        const headers = Object.keys(rows[0] || {});
        const lowerToActual = Object.fromEntries(headers.map(h => [h.toLowerCase(), h]));
        const candidateKeys = ['employee_id', 'emp_id', 'employeeid', 'employee id', 'id', 'code'];
        const matchKey = candidateKeys.map(k => lowerToActual[k]).find(Boolean);
        let match = null;
        if (matchKey) match = rows.find(r => String(r[matchKey]).toLowerCase() === String(empId || '').toLowerCase());
        if (!match) match = rows.find(r => Object.values(r).some(v => String(v).toLowerCase() === String(empId || '').toLowerCase()));
        if (match) openDrawerWithRow(match);
    }

    function renderSalaryDetails(row) {
        const results = document.getElementById('results');
        if (!results) return;
        results.innerHTML = '';
        if (!row) { results.appendChild(el('div', { class: 'muted' }, 'No data')); return; }
        const empId = getField(row, ['employee_id', 'emp_id', 'employeeid', 'employee id', 'id', 'code']);

        const rowsDef = [
            ['Standard Payout', ['standard payout', 'standard_payout'], null],
            ['Input Based Payout', ['input based payout'], null],
            ['Transport Allowance', ['transport allowance', 'transport_allowance'], null],
            ['Efficiency Bonus', ['efficiency bonus', 'efficiency_bonus'], 'Its Quarterly Payout, click here for details'],
            ['Crew Scheduling Allowance', ['crew scheduling allowance'], null],
            ['Operational OT', ['operational ot'], 'Click here for OT dates and details'],
            ['CH OT', ['ch ot', 'chot'], 'Click here for OT dates and details'],
            ['NH OT', ['nh ot', 'nhot'], 'Click here for OT dates and details'],
            ['Break Shift', ['break shift'], 'Click here for Breakshift dates and details'],
            ['Night Shift Allowance', ['night shift allowance', 'nightshift allowance'], 'Click here for NightShift dates and details'],
            ['Sector Pay', ['sector pay', 'sector'], 'Click here for Sector hrs details'],
            ['FLIGHTAL', ['flightal'], null],
            ['Longevity Bonus', ['longevity bonus'], null],
            ['Pilot Benevolent', ['pilot benevolent'], null],
            ['Taxiing Allowance', ['taxiing allowance'], null],
            ['Dead Head Allow', ['dead head allow'], 'Click here for Deadhead details'],
            ['Meal Allowance', ['meal allowance'], 'Click here for Meal Allow details'],
            ['Standby', ['standby', 'stand by allowance', 'stand-by allowance'], 'Click here for Standby details'],
            ['Relocation Allowance', ['relocation allowance'], null],
            ['Trainer Allowance', ['trainer allowance'], null],
            ['Ex-Gratia', ['ex-gratia', 'ex gratia'], null],
            ['Deputation allowance', ['deputation allowance'], null],
            ['TLPD', ['tlpd'], 'Click here for TLPD details'],
            ['TDY', ['tdy'], 'Click here for TDY details'],
            ['TOTAL GROSS PAYABLE', ['total gross payable', 'total'], null],
            ['PF / VPF', ['pf / vpf', 'pf', 'vpf'], null],
            ['ESI', ['esi'], null]
        ];

        const table = el('table', { class: 'pslip-table', style: 'margin-top:10px;' });
        const thead = el('thead', {}, el('tr', { class: 'pslip-header' },
            el('th', {}, 'Description'),
            el('th', {}, ''),
            el('th', {}, ''),
            el('th', {}, '')
        ));
        const tbody = el('tbody');
        rowsDef.forEach(([label, keys, defaultDetail]) => {
            const amount = getField(row, keys) || '-';
            const labelNorm = normalizeLabel(label);
            const clickableLabels = ['night shift allowance', 'standby', 'stand-by allowance', 'meal allowance', 'operational ot', 'ch ot', 'nh ot', 'break shift', 'sector pay', 'tlpd', 'tdy'];
            const isClickable = clickableLabels.includes(labelNorm);
            const detailText = defaultDetail || '-';
            const detailsEl = isClickable && empId
                ? el('a', { href: '#', onclick: (e) => { e.preventDefault(); showAllowanceFor(label, empId); } }, detailText)
                : el('span', {}, detailText);
            const tr = el('tr', {},
                el('td', {}, label),
                el('td', {}, 'INR'),
                el('td', {}, String(amount)),
                el('td', {}, detailsEl)
            );
            tbody.appendChild(tr);
        });
        table.appendChild(thead);
        table.appendChild(tbody);
        results.appendChild(table);
    }

    return {
        init: async function () {
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
            await loadSheets();
        },
    };
})();


