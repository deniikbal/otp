(() => {
	const listEl = document.getElementById('list');
	const tpl = document.getElementById('accountTpl');
	const fileInput = document.getElementById('fileInput');
	const uploadBtn = document.getElementById('uploadQR');
	const scanBtn = document.getElementById('scanTab');
	const addManualBtn = document.getElementById('addManual');
	const searchInput = document.getElementById('searchInput');
	const loadingSpinner = document.getElementById('loadingSpinner');
	const emptyState = document.getElementById('emptyState');
	const emptyAddManual = document.getElementById('emptyAddManual');
	const emptyUploadQR = document.getElementById('emptyUploadQR');

	let accounts = [];
	let filteredAccounts = [];

	// mapping issuer ke input ID target di halaman
	const targetIssuer = {
		"Dapodik": "kode2fa",
		"SDM": "totp_code",
		"SIASN": "otp",
		"InfoGTK": "otpForm"
	};

	// Toast notification function
	function showToast(message, type = 'info') {
		const toastContainer = document.getElementById('toastContainer');
		const toast = document.createElement('div');
		toast.className = `toast ${type}`;
		toast.textContent = message;

		toastContainer.appendChild(toast);

		// Auto remove after 3 seconds
		setTimeout(() => {
			toast.style.animation = 'slideOutRight 0.3s ease-out';
			setTimeout(() => {
				if (toast.parentNode) {
					toast.parentNode.removeChild(toast);
				}
			}, 300);
		}, 3000);
	}

	// Loading spinner functions
	function showLoading() {
		loadingSpinner.style.display = 'flex';
	}

	function hideLoading() {
		loadingSpinner.style.display = 'none';
	}

	// Search function
	function filterAccounts(searchTerm) {
		if (!searchTerm.trim()) {
			filteredAccounts = [...accounts];
		} else {
			const term = searchTerm.toLowerCase().trim();
			filteredAccounts = accounts.filter(account =>
				account.label.toLowerCase().includes(term) ||
				account.issuer.toLowerCase().includes(term)
			);
		}
		render();
	}

	function save() {
		chrome.storage.local.set({
			accounts
		});
		// Reset filtered accounts when saving
		filteredAccounts = [...accounts];
	}

	function load() {
		chrome.storage.local.get(['accounts'], res => {
			accounts = res.accounts || [];
			filteredAccounts = [...accounts];
			render();
		});
	}

	function parseOtpauth(uri) {
		try {
			if (!uri.startsWith('otpauth://')) return null;
			const u = new URL(uri);
			const label = decodeURIComponent(u.pathname.slice(1));
			const params = Object.fromEntries(u.searchParams.entries());
			const [issuerFromLabel, account] = label.includes(':') ? label.split(':') : [null, label];
			return {
				type: u.hostname,
				label: account || label,
				issuer: params.issuer || issuerFromLabel || '',
				secret: params.secret,
				algorithm: (params.algorithm || 'SHA1').toUpperCase(),
				digits: Number(params.digits || 6),
				period: Number(params.period || 30)
			};
		} catch (e) {
			return null;
		}
	}

	function render() {
		listEl.innerHTML = '';
		const tabsEl = document.getElementById('tabs');
		tabsEl.innerHTML = '';

		// Show/hide empty state - only when no accounts at all
		if (accounts.length === 0) {
			emptyState.classList.add('show');
			listEl.style.display = 'none';
			tabsEl.style.display = 'none';
			return;
		} else {
			emptyState.classList.remove('show');
			listEl.style.display = 'block';
			tabsEl.style.display = 'flex';
		}

		// Use filtered accounts for rendering
		const accountsToRender = filteredAccounts.length > 0 ? filteredAccounts : accounts;

		// If search yields no results, show message but keep tabs visible
		if (accountsToRender.length === 0) {
			listEl.innerHTML = '<div style="text-align: center; padding: 40px; color: #7f8c8d;">No accounts found matching your search.</div>';
			return;
		}

		// group by issuer
		const grouped = {};
		accountsToRender.forEach(a => {
			const group = a.issuer || 'Other';
			if (!grouped[group]) grouped[group] = [];
			grouped[group].push(a);
		});

		const issuers = Object.keys(grouped);
		if (issuers.length === 0) return;

		// tambah tab "All"
		issuers.unshift("All");

		let activeIssuer = issuers[0];

		function showAccounts(issuer) {
			listEl.innerHTML = '';

			const list = issuer === "All" ?
				accountsToRender :
				grouped[issuer];

			list.forEach(a => {
				const node = tpl.content.cloneNode(true);
				node.querySelector('.label').textContent = a.label || 'Account';
				node.querySelector('.issuer').textContent = a.issuer || '';
				const codeEl = node.querySelector('.code');
				const timeEl = node.querySelector('.time');

				// delete
				node.querySelector('.del').addEventListener('click', () => {
					if (confirm(`Hapus akun "${a.label}" (${a.issuer})?`)) {
						const index = accounts.indexOf(a);
						if (index >= 0) {
							accounts.splice(index, 1);
							save();
							render();
							showToast('Account deleted successfully', 'success');
						}
					}
				});

				// edit
				node.querySelector('.edit').addEventListener('click', () => {
					const newLabel = prompt('Edit Label:', a.label);
					if (newLabel === null) return;
					const newIssuer = prompt('Edit Issuer:', a.issuer || '');
					if (newIssuer === null) return;

					a.label = newLabel.trim();
					a.issuer = newIssuer.trim();
					save();
					render();
				});


				// copy atau fill OTP
				codeEl.addEventListener('click', () => {
					const otp = codeEl.textContent;
					const inputId = targetIssuer[a.issuer] || null; // jangan undefined

					chrome.tabs.query({
						active: true,
						currentWindow: true
					}, tabs => {
						if (chrome.runtime.lastError) {
							console.error('Error querying tabs:', chrome.runtime.lastError);
							// Fallback: copy to clipboard
							navigator.clipboard.writeText(otp).then(() => {
								codeEl.style.color = "#c8f7c5";
								setTimeout(() => (codeEl.style.color = ""), 400);
							});
							return;
						}

						const currentTab = tabs[0];
						if (!currentTab || !currentTab.url) {
							// Fallback: copy to clipboard
							navigator.clipboard.writeText(otp).then(() => {
								codeEl.style.color = "#c8f7c5";
								setTimeout(() => (codeEl.style.color = ""), 400);
							});
							return;
						}

						// Check if URL is chrome:// or other restricted URLs
						if (currentTab.url.startsWith('chrome://') || 
							currentTab.url.startsWith('chrome-extension://') ||
							currentTab.url.startsWith('moz-extension://') ||
							currentTab.url.startsWith('edge://') ||
							currentTab.url.startsWith('about:')) {
							// Fallback: copy to clipboard for restricted URLs
							navigator.clipboard.writeText(otp).then(() => {
								codeEl.style.color = "#c8f7c5";
								setTimeout(() => (codeEl.style.color = ""), 400);
							});
							return;
						}

						chrome.scripting.executeScript({
								target: {
									tabId: currentTab.id
								},
								func: (issuer, otp, inputId) => {
									// kasus khusus InfoGTK → pisah OTP ke tiap input
									if (issuer === "InfoGTK") {
										const inputs = document.querySelectorAll("#otpForm .otp-input");
										if (inputs && inputs.length === otp.length) {
											otp.split("").forEach((digit, i) => {
												inputs[i].value = digit;
												inputs[i].dispatchEvent(new Event("input", {
													bubbles: true
												}));
											});
											return true;
										}
										return false;
									}

									// default: isi input berdasarkan id
									if (inputId) {
										const input = document.getElementById(inputId);
										if (input) {
											input.value = otp;
											input.dispatchEvent(new Event("input", {
												bubbles: true
											}));
											return true;
										}
									}

									return false; // fallback copy
								},
								args: [a.issuer, otp, inputId]
							},
							results => {
								if (chrome.runtime.lastError) {
									console.error('Error executing script:', chrome.runtime.lastError);
								}
								// fallback copy ke clipboard
								if (!results || !results[0] || !results[0].result) {
									navigator.clipboard.writeText(otp).then(() => {
										codeEl.style.color = "#c8f7c5";
										setTimeout(() => (codeEl.style.color = ""), 400);
									});
								}
							}
						);
					});
				});


				listEl.appendChild(node);

				// update OTP
				function tick() {
					const now = Date.now();
					const res = TOTP.generateCodeForAccount(a, now);
					codeEl.textContent = res.code;
					
					// Update progress circle
					const remainingSeconds = res.until;
					const totalSeconds = a.period || 30;
					const progress = (remainingSeconds / totalSeconds) * 360; // Convert to degrees
					
					// Remove existing classes
					timeEl.classList.remove('warning', 'critical');
					
					// Add appropriate class based on remaining time
					if (remainingSeconds <= 5) {
						timeEl.classList.add('critical');
					} else if (remainingSeconds <= 10) {
						timeEl.classList.add('warning');
					}
					
					// Update the conic gradient
					const color = remainingSeconds <= 5 ? '#e74c3c' :
								 remainingSeconds <= 10 ? '#ff6b6b' : '#00b894';
					
					timeEl.style.setProperty('--progress', `${progress}deg`);
					timeEl.style.setProperty('--color', color);
				}
				tick();
				setInterval(tick, 1000);
			});
		}

		// buat tab issuer + All
		issuers.forEach(issuer => {
			const tab = document.createElement('div');
			tab.className = 'tab' + (issuer === activeIssuer ? ' active' : '');
			tab.textContent = issuer;
			tab.addEventListener('click', () => {
				activeIssuer = issuer;
				document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
				tab.classList.add('active');
				showAccounts(issuer);
			});
			tabsEl.appendChild(tab);
		});

		// tampilkan default tab
		showAccounts(activeIssuer);
	}

	// Upload QR
	uploadBtn.addEventListener('click', () => fileInput.click());
	fileInput.addEventListener('change', ev => {
		const f = ev.target.files[0];
		if (!f) return;
		showLoading();
		const reader = new FileReader();
		reader.onload = e => {
			const img = new Image();
			img.onload = () => {
				try {
					const cvs = document.createElement('canvas');
					cvs.width = img.width;
					cvs.height = img.height;
					const ctx = cvs.getContext('2d');
					ctx.drawImage(img, 0, 0);
					const imgd = ctx.getImageData(0, 0, cvs.width, cvs.height);
					const code = jsQR(imgd.data, cvs.width, cvs.height);
					if (code && code.data) {
						const parsed = parseOtpauth(code.data) || parseOtpauth(code.data.trim());
						if (parsed && parsed.secret) {
							accounts.push(parsed);
							save();
							render();
							showToast('Account added successfully', 'success');
						} else {
							showToast('QR code decoded but not a valid OTP URI', 'error');
						}
					} else {
						showToast('QR code not found in image', 'error');
					}
				} catch (error) {
					showToast('Error processing QR code', 'error');
				} finally {
					hideLoading();
				}
			};
			img.src = e.target.result;
		};
		reader.readAsDataURL(f);
	});

	// Scan tab
	scanBtn.addEventListener('click', () => {
		chrome.tabs.query({
			active: true,
			currentWindow: true
		}, tabs => {
			if (chrome.runtime.lastError) {
				showToast('Error accessing tab: ' + chrome.runtime.lastError.message, 'error');
				return;
			}

			const currentTab = tabs[0];
			if (!currentTab || !currentTab.url) {
				showToast('Cannot access current tab', 'error');
				return;
			}

			// Check if URL is chrome:// or other restricted URLs
			if (currentTab.url.startsWith('chrome://') ||
				currentTab.url.startsWith('chrome-extension://') ||
				currentTab.url.startsWith('moz-extension://') ||
				currentTab.url.startsWith('edge://') ||
				currentTab.url.startsWith('about:')) {
				showToast('Cannot scan browser internal pages. Please open a regular web page.', 'warning');
				return;
			}

			showLoading();
			chrome.tabs.captureVisibleTab(null, {
				format: 'png'
			}, dataUrl => {
				if (chrome.runtime.lastError) {
					showToast('Capture failed: ' + chrome.runtime.lastError.message, 'error');
					hideLoading();
					return;
				}
				const img = new Image();
				img.onload = () => {
					try {
						const cvs = document.createElement('canvas');
						cvs.width = img.width;
						cvs.height = img.height;
						const ctx = cvs.getContext('2d');
						ctx.drawImage(img, 0, 0);
						const imgd = ctx.getImageData(0, 0, cvs.width, cvs.height);
						const code = jsQR(imgd.data, cvs.width, cvs.height);
						if (code && code.data) {
							const parsed = parseOtpauth(code.data) || parseOtpauth(code.data.trim());
							if (parsed && parsed.secret) {
								accounts.push(parsed);
								save();
								render();
								showToast('Account added successfully', 'success');
							} else {
								showToast('QR code decoded but not a valid OTP URI', 'error');
							}
						} else {
							showToast('QR code not found in tab. Try zooming in.', 'warning');
						}
					} catch (error) {
						showToast('Error processing QR code', 'error');
					} finally {
						hideLoading();
					}
				};
				img.src = dataUrl;
			});
		});
	});

	// Add manual
	addManualBtn.addEventListener('click', () => {
		const label = prompt('Label:');
		if (!label) return;
		const secret = prompt('Secret:');
		if (!secret) return;
		const issuer = prompt('Issuer (optional):') || '';
		accounts.push({
			label,
			secret,
			issuer,
			algorithm: 'SHA1',
			digits: 6,
			period: 30
		});
		save();
		render();
		showToast('Account added successfully', 'success');
	});

	// Export data
	document.getElementById('exportBtn').addEventListener('click', () => {
		const dataStr = JSON.stringify(accounts, null, 2);
		const blob = new Blob([dataStr], {
			type: 'application/json'
		});
		const url = URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.href = url;
		a.download = 'otp-backup.json';
		a.click();

		URL.revokeObjectURL(url);
	});

	// Import data
	const importFile = document.getElementById('importFile');
	document.getElementById('importBtn').addEventListener('click', () => {
		importFile.click();
	});

	importFile.addEventListener('change', (e) => {
		const file = e.target.files[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (event) => {
			try {
				const imported = JSON.parse(event.target.result);
				if (Array.isArray(imported)) {
					// gabungkan dengan akun lama
					accounts = accounts.concat(imported);
					save();
					render();
					showToast('Data imported successfully!', 'success');
				} else {
					showToast('Invalid file format.', 'error');
				}
			} catch (err) {
				showToast('Failed to read file: ' + err.message, 'error');
			}
		};
		reader.readAsText(file);
	});

	document.getElementById('clearBtn').addEventListener('click', () => {
		if (confirm('Are you sure you want to delete all OTP accounts?')) {
			accounts = [];
			save();
			render();
			showToast('All accounts deleted successfully.', 'success');
		}
	});

	// Search functionality
	searchInput.addEventListener('input', (e) => {
		filterAccounts(e.target.value);
	});

	// Empty state buttons
	emptyAddManual.addEventListener('click', () => {
		addManualBtn.click();
	});

	emptyUploadQR.addEventListener('click', () => {
		uploadBtn.click();
	});

	// Initialize filtered accounts
	filteredAccounts = [...accounts];

	load();
})();