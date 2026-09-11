/**
 * @license Apache-2.0
 * Copyright (C) 2024-2026 luci-app-rathole contributors
 * 
 * Rathole Reverse Proxy Management Interface for OpenWrt LuCI
 * Features real-time status dashboard, service mapping, Noise protocol encryption,
 * multi-platform VPS export (TOML / Docker / Systemd), and live network diagnostics.
 */

'use strict';
'require view';
'require form';
'require rpc';
'require fs';
'require ui';
'require poll';
'require uci';

/**
 * Global Constants & Configurations
 */
const CONSTANTS = {
	PACKAGE: 'rathole',
	DEFAULT_BIN: '/usr/bin/rathole',
	CONFIG_FILE: '/var/etc/rathole/config.toml',
	LOG_FILE: '/var/log/rathole.log',
	DEFAULT_NOISE_PATTERN: 'Noise_NK_25519_ChaChaPoly_BLAKE2s',
	DEFAULT_HB_TIMEOUT: '40',
	DEFAULT_RETRY_INTERVAL: '1',
	SERVER_HEARTBEAT_INTERVAL: 30
};

/**
 * DOM & Form Helper utilities for resilient interaction with LuCI JS controls
 */
const LuCIDOMHelper = {
	/**
	 * Locate an input, select, or textarea widget element
	 * @param {string} config - UCI package name
	 * @param {string} section - UCI section name
	 * @param {string} option - UCI option name
	 * @returns {HTMLElement|null}
	 */
	getWidgetInput: function(config, section, option) {
		return document.getElementById('widget.cbid.' + config + '.' + section + '.' + option) ||
			document.querySelector('[data-widget-id="widget.cbid.' + config + '.' + section + '.' + option + '"]') ||
			(document.getElementById('cbid.' + config + '.' + section + '.' + option)
				? document.getElementById('cbid.' + config + '.' + section + '.' + option).querySelector('input, select, textarea')
				: null) ||
			document.querySelector('#cbi-' + config + '-' + section + '-' + option + ' input, #cbi-' + config + '-' + section + '-' + option + ' select') ||
			document.querySelector('input[id*="' + option + '"], select[id*="' + option + '"]');
	},

	/**
	 * Locate a checkbox widget element
	 * @param {string} config - UCI package name
	 * @param {string} section - UCI section name
	 * @param {string} option - UCI option name
	 * @returns {HTMLInputElement|null}
	 */
	getWidgetCheckbox: function(config, section, option) {
		return document.getElementById('widget.cbid.' + config + '.' + section + '.' + option) ||
			document.querySelector('[data-widget-id="widget.cbid.' + config + '.' + section + '.' + option + '"]') ||
			(document.getElementById('cbid.' + config + '.' + section + '.' + option)
				? document.getElementById('cbid.' + config + '.' + section + '.' + option).querySelector('input[type="checkbox"]')
				: null) ||
			document.querySelector('#cbi-' + config + '-' + section + '-' + option + ' input[type="checkbox"]') ||
			document.querySelector('input[type="checkbox"][id*="' + option + '"]');
	},

	/**
	 * Trigger standard DOM change events to notify LuCI framework
	 * @param {HTMLElement} el - Element to trigger events on
	 */
	triggerChange: function(el) {
		if (!el) return;
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
		el.dispatchEvent(new Event('blur', { bubbles: true }));
	}
};

/**
 * RPC Service Interface
 */
const callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: { '': {} }
});

const callInitAction = rpc.declare({
	object: 'luci',
	method: 'setInitAction',
	params: ['name', 'action'],
	expect: { result: false }
});

/**
 * Render visual status indicator badge
 * @param {boolean} isRunning - Whether the daemon is active
 * @returns {string} HTML markup
 */
function renderStatusDot(isRunning) {
	if (isRunning) {
		return '<span style="color: #2ecc71; font-weight: bold;">●</span> ' + _('Running');
	} else {
		return '<span style="color: #e74c3c; font-weight: bold;">●</span> ' + _('Stopped');
	}
}

/**
 * Query daemon running status, PID, and active service counts
 * @returns {Promise<Object>} Status metadata
 */
function getServiceData() {
	return L.resolveDefault(callServiceList('rathole'), {}).then(function(res) {
		var isRunning = false;
		var pid = null;
		try {
			var inst = res['rathole']['instances']['rathole'];
			isRunning = inst['running'] === true;
			pid = inst['pid'] || null;
		} catch (e) {}

		var mode = uci.get('rathole', 'global', 'mode') || 'client';
		var target = (mode === 'client') ? (uci.get('rathole', 'client', 'remote_addr') || '-') : _('Raw TOML Mode');

		var services = uci.sections('rathole', 'service') || [];
		var activeCount = 0;
		for (var i = 0; i < services.length; i++) {
			if (services[i].enabled !== '0') activeCount++;
		}

		return {
			running: isRunning,
			pid: pid,
			mode: mode,
			target: target,
			activeServices: activeCount,
			totalServices: services.length
		};
	});
}

/**
 * Handle procd service lifecycle actions (start/stop/restart)
 * @param {string} action - Action name
 * @param {Event} ev - DOM Click event
 * @returns {Promise<void>}
 */
function handleServiceAction(action, ev) {
	var btn = ev ? ev.target : null;
	if (btn) btn.disabled = true;

	var actMap = {
		'start': _('Starting'),
		'stop': _('Stopping'),
		'restart': _('Restarting')
	};

	ui.showIndicator('rathole-action', (actMap[action] || _('Operating')) + ' ' + _('Rathole Proxy') + '...');

	return callInitAction('rathole', action).then(function() {
		ui.addNotification(null, E('p', {}, _('Service %s command issued successfully.').format(action)), 'info');
		return new Promise(function(resolve) { setTimeout(resolve, 1500); });
	}).then(function() {
		return getServiceData();
	}).then(function(st) {
		updateStatusDOM(st);
	}).catch(function(err) {
		ui.addNotification(null, E('p', {}, _('Failed to execute command: ') + (err.message || err)), 'error');
	}).finally(function() {
		ui.hideIndicator('rathole-action');
		if (btn) btn.disabled = false;
	});
}

/**
 * Update the DOM elements in the top Status Card
 * @param {Object} st - Service state object
 */
function updateStatusDOM(st) {
	var badge = document.getElementById('rh_status_badge');
	var pidEl = document.getElementById('rh_pid_text');
	var targetAddr = document.getElementById('rh_target_addr');
	var svcEl = document.getElementById('rh_services_text');

	if (badge) badge.innerHTML = renderStatusDot(st.running);
	if (pidEl) pidEl.textContent = st.running ? (st.pid ? String(st.pid) : '-') : '-';
	if (targetAddr) targetAddr.textContent = st.running ? st.target : '-';
	if (svcEl) {
		if (st.mode === 'client') {
			svcEl.textContent = String(st.activeServices) + ' ' + _('active') + ' / ' + String(st.totalServices) + ' ' + _('configured');
		} else {
			svcEl.textContent = _('Managed by Raw TOML');
		}
	}
}

/**
 * Dynamically switch visibility between Client sections and Raw TOML section
 * @param {string} mode - 'client' or 'raw'
 */
function updateModeVisibility(mode) {
	var isClient = (mode === 'client');
	var clientSec = document.getElementById('cbi-rathole-client');
	var servicesSec = document.getElementById('cbi-rathole-service');
	var rawSec = document.getElementById('cbi-rathole-raw');

	if (clientSec) clientSec.style.display = isClient ? '' : 'none';
	if (servicesSec) servicesSec.style.display = isClient ? '' : 'none';
	if (rawSec) rawSec.style.display = isClient ? 'none' : '';
}

/**
 * Test network reachability and ping latency to the configured VPS
 */
function testVPSConnectivity() {
	var remoteAddr = uci.get('rathole', 'client', 'remote_addr') || '';
	if (!remoteAddr) {
		ui.addNotification(null, E('p', {}, _('Please configure Remote Server Address first.')), 'warning');
		return;
	}

	var parts = remoteAddr.split(':');
	var host = parts[0];
	var port = parts[1] || '2333';

	ui.showIndicator('rathole-ping', _('Testing connectivity to VPS (%s)...').format(remoteAddr));

	fs.exec('/bin/ping', ['-c', '1', '-W', '2', host]).then(function(pingRes) {
		ui.hideIndicator('rathole-ping');
		var pingOutput = (pingRes.stdout || '') + (pingRes.stderr || '');
		var timeMatch = pingOutput.match(/time=([0-9.]+\s*ms)/i) || pingOutput.match(/avg\/max\s*=\s*[^/]+\/([0-9.]+)/i);
		var latency = timeMatch ? (timeMatch[1].endsWith('ms') ? timeMatch[1] : timeMatch[1] + ' ms') : null;
		var isPingOk = (pingRes.code === 0);

		var modalContent = E('div', {}, [
			E('p', { 'style': 'margin-bottom: 14px;' },
				_('Network connectivity diagnostic results for target server %s:').format('<strong>' + remoteAddr + '</strong>')
			),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Ping Latency:')),
				E('div', { 'class': 'cbi-value-field' }, [
					isPingOk
						? E('span', { 'style': 'color: #2ecc71; font-weight: bold;' }, '✓ ' + (latency || _('Reachable')))
						: E('span', { 'style': 'color: #e74c3c; font-weight: bold;' }, '✗ ' + _('Unreachable (ICMP Timeout / Blocked)'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Target Port:')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('span', { 'style': 'font-family: monospace; font-weight: bold;' }, port)
				])
			]),
			E('div', { 'style': 'background: #f8f9fa; border-left: 4px solid #3498db; padding: 12px; margin-top: 14px; font-size: 12px; line-height: 1.6;' }, [
				E('strong', {}, _('Diagnostic Tips:')),
				E('ul', { 'style': 'margin: 6px 0 0 16px; padding: 0;' }, [
					E('li', {}, _('If Ping succeeds but the client fails to connect, please verify whether port %s is permitted in your cloud VPS Security Group / Firewall.').format(port)),
					E('li', {}, _('If using Noise encryption, make sure the matching Private Key is configured on the VPS server.toml.')),
					E('li', {}, _('Ensure the Rathole server process is actively running on your VPS.'))
				])
			]),
			E('div', { 'class': 'right', 'style': 'margin-top: 18px;' }, [
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close'))
			])
		]);

		ui.showModal(_('VPS Connectivity Diagnostics'), [ modalContent ]);
	}).catch(function(err) {
		ui.hideIndicator('rathole-ping');
		ui.addNotification(null, E('p', {}, _('Diagnostic failed: ') + (err.message || err)), 'error');
	});
}

/**
 * Open modal to generate X25519 Noise keypairs and apply public key
 * @param {string} binPath - Path to rathole binary
 */
function openNoiseKeygenModal(binPath) {
	ui.showIndicator('rathole-genkey', _('Generating Noise Keypair...'));
	fs.exec(binPath || CONSTANTS.DEFAULT_BIN, ['--genkey']).then(function(res) {
		ui.hideIndicator('rathole-genkey');
		if (res.code === 0 && res.stdout) {
			var out = res.stdout;
			var privMatch = out.match(/Private Key:\s*([^\s]+)/i);
			var pubMatch = out.match(/Public Key:\s*([^\s]+)/i);
			var privKey = privMatch ? privMatch[1] : '';
			var pubKey = pubMatch ? pubMatch[1] : '';

			var modalBody = E('div', {}, [
				E('p', { 'style': 'margin-bottom: 12px; color: #555;' },
					_('Generated a new X25519 keypair for Noise protocol encryption. The Private Key is for your VPS server.toml, and the Public Key is used on this OpenWrt client:')
				),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'style': 'font-weight: bold;' }, _('Server Private Key:')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'text',
							'class': 'cbi-input-text',
							'style': 'width: 320px; font-family: monospace; font-size: 11px;',
							'readonly': 'readonly',
							'value': privKey
						}),
						' ',
						E('button', {
							'class': 'btn cbi-button',
							'click': function() {
								navigator.clipboard.writeText(privKey);
								ui.addNotification(null, E('p', {}, _('Private Key copied to clipboard!')), 'info');
							}
						}, _('Copy'))
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'style': 'font-weight: bold;' }, _('Server Public Key:')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'text',
							'class': 'cbi-input-text',
							'style': 'width: 320px; font-family: monospace; font-size: 11px;',
							'readonly': 'readonly',
							'value': pubKey
						}),
						' ',
						E('button', {
							'class': 'btn cbi-button',
							'click': function() {
								navigator.clipboard.writeText(pubKey);
								ui.addNotification(null, E('p', {}, _('Public Key copied to clipboard!')), 'info');
							}
						}, _('Copy'))
					])
				]),
				E('div', { 'class': 'right', 'style': 'margin-top: 18px;' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': function() {
							// 1. Enable noise_enable checkbox
							var enableCheckbox = LuCIDOMHelper.getWidgetCheckbox('rathole', 'client', 'noise_enable');
							if (enableCheckbox && !enableCheckbox.checked) {
								enableCheckbox.checked = true;
								LuCIDOMHelper.triggerChange(enableCheckbox);
							}

							// 2. Unhide dependent row
							var pubRow = document.getElementById('cbi-rathole-client-noise_remote_public_key');
							if (pubRow) pubRow.classList.remove('hidden');

							// 3. Populate public key input
							var pubInput = LuCIDOMHelper.getWidgetInput('rathole', 'client', 'noise_remote_public_key');
							if (pubInput) {
								pubInput.value = pubKey;
								LuCIDOMHelper.triggerChange(pubInput);
							}

							// 4. Save to in-memory UCI state
							uci.set('rathole', 'client', 'noise_enable', '1');
							uci.set('rathole', 'client', 'noise_remote_public_key', pubKey);

							ui.hideModal();
							ui.addNotification(null, E('p', {}, _('Public Key applied to Client Settings! Remember to configure the Private Key on your server.')), 'info');
						}
					}, _('Apply Public Key to Client')),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-reset',
						'click': ui.hideModal
					}, _('Close'))
				])
			]);

			ui.showModal(_('Noise Keypair Generator'), [ modalBody ]);
		} else {
			ui.addNotification(null, E('p', {}, _('Failed to generate key: ') + (res.stderr || 'Unknown error')), 'error');
		}
	}).catch(function(err) {
		ui.hideIndicator('rathole-genkey');
		ui.addNotification(null, E('p', {}, _('Failed to execute command: ') + (err.message || err)), 'error');
	});
}

/**
 * Open modal to export matching VPS configurations in multiple formats
 * (server.toml, Docker Run, Docker Compose, Systemd Service)
 */
function openVPSExportModal() {
	var remoteAddr = uci.get('rathole', 'client', 'remote_addr') || '';
	var portMatch = remoteAddr.match(/:(\d+)$/);
	var bindPort = portMatch ? portMatch[1] : '2333';
	var bindAddr = '0.0.0.0:' + bindPort;
	var defaultToken = uci.get('rathole', 'client', 'default_token') || 'YOUR_SECRET_TOKEN';
	var noiseEnable = uci.get('rathole', 'client', 'noise_enable') === '1';
	var noisePattern = uci.get('rathole', 'client', 'noise_pattern') || CONSTANTS.DEFAULT_NOISE_PATTERN;

	var lines = [
		'# =========================================================',
		'# Rathole Server Configuration (server.toml)',
		'# Auto-generated based on your OpenWrt client service rules',
		'# Place this file on your public VPS and run:',
		'# rathole --server /etc/rathole/server.toml',
		'# =========================================================',
		'',
		'[server]',
		'bind_addr = "' + bindAddr + '"',
		'default_token = "' + defaultToken + '"',
		'heartbeat_interval = ' + CONSTANTS.SERVER_HEARTBEAT_INTERVAL
	];

	if (noiseEnable) {
		lines.push('');
		lines.push('[server.transport]');
		lines.push('type = "noise"');
		lines.push('');
		lines.push('[server.transport.noise]');
		lines.push('pattern = "' + noisePattern + '"');
		lines.push('local_private_key = "PASTE_YOUR_SERVER_PRIVATE_KEY_HERE"');
	}

	var services = uci.sections('rathole', 'service') || [];
	var basePort = 8080;

	if (services.length > 0) {
		services.forEach(function(s) {
			if (s.enabled !== '0') {
				var name = s['.name'];
				var serviceBindPort = s.remote_port || basePort;
				lines.push('');
				lines.push('[server.services.' + name + ']');
				lines.push('type = "' + (s.type || 'tcp') + '"');
				lines.push('bind_addr = "0.0.0.0:' + serviceBindPort + '"');
				if (s.token) {
					lines.push('token = "' + s.token + '"');
				}
				if (!s.remote_port) {
					basePort++;
				}
			}
		});
	} else {
		lines.push('');
		lines.push('# [server.services.sample_service]');
		lines.push('# type = "tcp"');
		lines.push('# bind_addr = "0.0.0.0:8080"');
	}

	var tomlContent = lines.join('\n');

	// Docker Run command
	var dockerContent = [
		'# 1. Create config directory on your VPS',
		'mkdir -p /etc/rathole',
		'',
		'# 2. Save your server.toml into /etc/rathole/server.toml',
		'',
		'# 3. Run Rathole container using host network mode:',
		'docker run -d \\',
		'  --name rathole \\',
		'  --restart always \\',
		'  --net=host \\',
		'  -v /etc/rathole/server.toml:/app/config.toml \\',
		'  rapiz1/rathole:latest --server /app/config.toml'
	].join('\n');

	// Docker Compose
	var composeContent = [
		'version: "3.8"',
		'services:',
		'  rathole:',
		'    image: rapiz1/rathole:latest',
		'    container_name: rathole',
		'    restart: always',
		'    network_mode: host',
		'    volumes:',
		'      - ./server.toml:/app/config.toml',
		'    command: ["--server", "/app/config.toml"]'
	].join('\n');

	// Systemd unit
	var systemdContent = [
		'# Save as /etc/systemd/system/rathole.service',
		'[Unit]',
		'Description=Rathole Reverse Proxy Server',
		'After=network.target',
		'',
		'[Service]',
		'Type=simple',
		'User=root',
		'Restart=always',
		'RestartSec=5s',
		'ExecStart=/usr/local/bin/rathole --server /etc/rathole/server.toml',
		'LimitNOFILE=1048576',
		'',
		'[Install]',
		'WantedBy=multi-user.target',
		'',
		'# Enable and start commands:',
		'# systemctl daemon-reload',
		'# systemctl enable --now rathole'
	].join('\n');

	var exportFormats = {
		'toml': { title: 'server.toml (' + _('Configuration File') + ')', content: tomlContent },
		'docker': { title: 'Docker Run (' + _('Container CLI') + ')', content: dockerContent },
		'compose': { title: 'docker-compose.yml (' + _('Container Orchestration') + ')', content: composeContent },
		'systemd': { title: 'rathole.service (' + _('Systemd Daemon') + ')', content: systemdContent }
	};

	var formatSelect = E('select', { 'class': 'cbi-input-select', 'style': 'margin-bottom: 12px; width: 300px;' });
	for (var key in exportFormats) {
		formatSelect.appendChild(E('option', { 'value': key }, exportFormats[key].title));
	}

	var exportTextArea = E('textarea', {
		'class': 'cbi-input-textarea',
		'style': 'width: 100%; height: 300px; font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.4;',
		'readonly': 'readonly'
	}, [ tomlContent ]);

	formatSelect.addEventListener('change', function(e) {
		var selected = exportFormats[e.target.value];
		if (selected) exportTextArea.value = selected.content;
	});

	var modalBody = E('div', {}, [
		E('p', { 'style': 'margin-bottom: 8px; color: #555;' },
			_('Select target deployment format to export matching VPS configurations:')
		),
		E('div', { 'style': 'margin-bottom: 10px;' }, [
			formatSelect
		]),
		exportTextArea,
		E('div', { 'class': 'right', 'style': 'margin-top: 15px;' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-apply',
				'click': function() {
					navigator.clipboard.writeText(exportTextArea.value);
					ui.addNotification(null, E('p', {}, _('Configuration copied to clipboard!')), 'info');
				}
			}, _('Copy to Clipboard')),
			' ',
			E('button', {
				'class': 'btn cbi-button cbi-button-reset',
				'click': ui.hideModal
			}, _('Close'))
		])
	]);

	ui.showModal(_('VPS server.toml Preview & Export'), [ modalBody ]);
}

return view.extend({
	load: function() {
		return uci.load('rathole').then(function() {
			var binPath = uci.get('rathole', 'global', 'binary_path') || CONSTANTS.DEFAULT_BIN;
			return Promise.all([
				getServiceData(),
				fs.exec(binPath, ['--version']).then(function(res) {
					if (res.code === 0 && res.stdout) {
						var match = res.stdout.match(/rathole\s+([^\s]+)/i) || res.stdout.match(/version\s+([^\s]+)/i);
						return match ? match[1] : res.stdout.trim();
					}
					return _('Not Installed');
				}).catch(function() {
					return _('Not Installed');
				})
			]);
		});
	},

	render: function(data) {
		var serviceData = data[0] || { running: false, pid: null, mode: 'client', target: '-', activeServices: 0, totalServices: 0 };
		var ratholeVersion = data[1] || _('Not Installed');
		var binPath = uci.get('rathole', 'global', 'binary_path') || CONSTANTS.DEFAULT_BIN;

		var statusHtml = renderStatusDot(serviceData.running);
		var ratholeIconSvg = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#e67e22" style="vertical-align: middle; margin-right: 8px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';

		/* Status Card */
		var statusCard = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [
				E('span', { 'raw-html': true }, ratholeIconSvg),
				_('Rathole Status')
			]),
			E('div', { 'class': 'cbi-section-node' }, [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Status')),
					E('div', { 'class': 'cbi-value-field', 'id': 'rh_status_badge' }, [
						E('span', { 'raw-html': true }, statusHtml)
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('PID')),
					E('div', { 'class': 'cbi-value-field', 'id': 'rh_pid_text' }, serviceData.running ? (serviceData.pid ? String(serviceData.pid) : '-') : '-')
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Target Server')),
					E('div', { 'class': 'cbi-value-field', 'id': 'rh_target_text' }, [
						E('span', { 'id': 'rh_target_addr' }, serviceData.running ? serviceData.target : '-'),
						serviceData.mode === 'client' ? E('button', {
							'class': 'btn cbi-button',
							'style': 'margin-left: 10px; font-size: 11px; padding: 2px 8px;',
							'click': function() { testVPSConnectivity(); }
						}, _('Test Connectivity')) : ''
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Active Services')),
					E('div', { 'class': 'cbi-value-field', 'id': 'rh_services_text' },
						serviceData.mode === 'client'
							? (String(serviceData.activeServices) + ' ' + _('active') + ' / ' + String(serviceData.totalServices) + ' ' + _('configured'))
							: _('Managed by Raw TOML')
					)
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Core Version')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('span', {}, ratholeVersion),
						ratholeVersion === _('Not Installed') ? E('span', { 'style': 'margin-left: 10px; color: #e74c3c;' }, _('(Please install rathole to /usr/bin/rathole)')) : ''
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Actions')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('button', {
							'class': 'btn cbi-button cbi-button-apply',
							'click': ui.createHandlerFn(this, function(ev) { return handleServiceAction('start', ev); })
						}, _('Start')),
						' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-reset',
							'click': ui.createHandlerFn(this, function(ev) { return handleServiceAction('stop', ev); })
						}, _('Stop')),
						' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-action',
							'click': ui.createHandlerFn(this, function(ev) { return handleServiceAction('restart', ev); })
						}, _('Restart')),
						' ',
						E('button', {
							'class': 'btn cbi-button',
							'style': 'margin-left: 8px; border-color: #3498db; color: #3498db;',
							'click': function() { openVPSExportModal(); }
						}, _('Export VPS Config'))
					])
				])
			])
		]);

		poll.add(function() {
			return getServiceData().then(function(st) {
				updateStatusDOM(st);
			});
		}, 4);

		var m, s, o;

		m = new form.Map('rathole', _('Rathole Reverse Proxy'),
			_('A lightweight and high-performance reverse proxy for NAT traversal written in Rust.')
		);

		/* -------------------------------------------------------------
		 * Section 1: General Settings
		 * ------------------------------------------------------------- */
		s = m.section(form.NamedSection, 'global', 'rathole', _('General Settings'));

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;
		o.default = '0';

		o = s.option(form.ListValue, 'mode', _('Operation Mode'),
			_('Choose Client mode for exposing local services to a remote VPS, or Raw mode for custom TOML.')
		);
		o.value('client', _('Client Mode (Recommended)'));
		o.value('raw', _('Raw TOML Configuration (Advanced)'));
		o.default = 'client';
		o.rmempty = false;
		o.onchange = function(ev, section_id, value) {
			updateModeVisibility(value);
		};

		o = s.option(form.Value, 'binary_path', _('Binary Path'),
			_('Custom path to the rathole executable.')
		);
		o.default = CONSTANTS.DEFAULT_BIN;
		o.placeholder = CONSTANTS.DEFAULT_BIN;
		o.rmempty = false;

		o = s.option(form.ListValue, 'loglevel', _('Log Level'));
		o.value('error', 'Error');
		o.value('warn', 'Warning');
		o.value('info', 'Info');
		o.value('debug', 'Debug');
		o.value('trace', 'Trace');
		o.default = 'info';

		o = s.option(form.Value, 'logfile', _('Log File Path'));
		o.default = CONSTANTS.LOG_FILE;
		o.placeholder = CONSTANTS.LOG_FILE;

		/* -------------------------------------------------------------
		 * Section 2: Client Settings
		 * ------------------------------------------------------------- */
		s = m.section(form.NamedSection, 'client', 'client', _('Client Connection'));

		o = s.option(form.Value, 'remote_addr', _('Remote Server Address'),
			_('Public address and port of your Rathole server (e.g. vps.example.com:2333). Must include the port number.')
		);
		o.placeholder = 'vps.example.com:2333';
		o.validate = function(section_id, value) {
			var enabled = uci.get('rathole', 'global', 'enabled');
			var mode = uci.get('rathole', 'global', 'mode') || 'client';
			if (enabled === '1' && mode === 'client') {
				if (!value || value.trim() === '') {
					return _('Remote Server Address is required when service is enabled.');
				}
				if (!value.match(/^.+:[0-9]+$/)) {
					return _('Address must include a port number, e.g. vps.example.com:2333');
				}
			}
			return true;
		};

		o = s.option(form.Value, 'default_token', _('Default Token'),
			_('Global fallback token for authenticating with the server.')
		);
		o.password = true;
		o.placeholder = 'SecretToken';

		o = s.option(form.Value, 'heartbeat_timeout', _('Heartbeat Timeout (s)'));
		o.datatype = 'uinteger';
		o.default = CONSTANTS.DEFAULT_HB_TIMEOUT;
		o.placeholder = CONSTANTS.DEFAULT_HB_TIMEOUT;

		o = s.option(form.Value, 'retry_interval', _('Retry Interval (s)'));
		o.datatype = 'uinteger';
		o.default = CONSTANTS.DEFAULT_RETRY_INTERVAL;
		o.placeholder = CONSTANTS.DEFAULT_RETRY_INTERVAL;

		/* Noise Encryption */
		o = s.option(form.Flag, 'noise_enable', _('Enable Noise Encryption'),
			_('Encrypt tunnel communication using Noise Protocol without TLS certificates.')
		);
		o.default = '0';

		o = s.option(form.Value, 'noise_pattern', _('Noise Handshake Pattern'));
		o.depends('noise_enable', '1');
		o.default = CONSTANTS.DEFAULT_NOISE_PATTERN;
		o.placeholder = CONSTANTS.DEFAULT_NOISE_PATTERN;

		o = s.option(form.Value, 'noise_remote_public_key', _('Server Public Key'),
			_('Base64-encoded Noise public key of the server. You can generate a keypair using the tool below.')
		);
		o.depends('noise_enable', '1');
		o.placeholder = 'Base64PubKey...';

		o = s.option(form.Button, '_genkey_btn', _('Noise Keypair Generator'),
			_('Quickly generate an X25519 keypair for Noise encryption. Automatically fills in the public key and provides the server private key.')
		);
		o.depends('noise_enable', '1');
		o.inputtitle = _('Generate Keypair');
		o.inputstyle = 'action';
		o.onclick = function() {
			openNoiseKeygenModal(binPath);
		};

		/* -------------------------------------------------------------
		 * Section 3: Services Mapping (TableSection)
		 * ------------------------------------------------------------- */
		s = m.section(form.TableSection, 'service', _('Services Mapping'),
			_('Define local services to expose through Rathole. The entry name must only contain English letters, numbers, hyphens, and underscores.')
		);
		s.anonymous = false;
		s.addremove = true;
		s.addbtntitle = _('Add Service');

		// Name validation hook
		s.validate = function(section_id) {
			if (!section_id.match(/^[a-zA-Z0-9_-]+$/)) {
				return _('Service name can only contain letters, numbers, hyphens, and underscores.');
			}
			return true;
		};

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;
		o.default = '1';

		o = s.option(form.ListValue, 'type', _('Type'));
		o.value('tcp', 'TCP');
		o.value('udp', 'UDP');
		o.default = 'tcp';

		o = s.option(form.Value, 'local_addr', _('Local Address'),
			_('Address and port of the service in LAN (e.g. 127.0.0.1:80 for Web UI, 127.0.0.1:22 for SSH).')
		);
		o.placeholder = '127.0.0.1:80';
		o.rmempty = false;

		o = s.option(form.Value, 'remote_port', _('VPS Port (Optional)'),
			_('Target port on VPS for export / reminder. Does not affect client routing directly.')
		);
		o.datatype = 'port';
		o.placeholder = 'e.g. 8443';
		o.rmempty = true;
		o.validate = function(section_id, value) {
			if (!value) return true;
			var allServices = uci.sections('rathole', 'service') || [];
			var curType = uci.get('rathole', section_id, 'type') || 'tcp';
			for (var i = 0; i < allServices.length; i++) {
				var other = allServices[i];
				if (other['.name'] !== section_id && other.enabled !== '0') {
					if (other.remote_port === value && (other.type || 'tcp') === curType) {
						return _('Remote port %s is already assigned to service "%s" with same protocol!').format(value, other['.name']);
					}
				}
			}
			return true;
		};

		o = s.option(form.Value, 'token', _('Specific Token'));
		o.password = true;
		o.placeholder = _('Optional (Inherits default)');

		o = s.option(form.Flag, 'nodelay', _('No Delay'));
		o.default = '1';

		/* -------------------------------------------------------------
		 * Section 4: Raw TOML Mode
		 * ------------------------------------------------------------- */
		s = m.section(form.NamedSection, 'raw', 'raw', _('Raw TOML Configuration'));

		var templateBtn = s.option(form.Button, '_template_client_btn', _('Config Templates'),
			_('Quickly populate the editor with standard configuration templates.')
		);
		templateBtn.inputtitle = _('Insert Client Template');
		templateBtn.inputstyle = 'action';
		templateBtn.onclick = function() {
			var area = LuCIDOMHelper.getWidgetInput('rathole', 'raw', 'content');
			if (area) {
				if (area.value && !confirm(_('Overwrite current content with Client Template?'))) return;
				area.value = '# Rathole Client Mode Template\n[client]\nremote_addr = "vps.example.com:2333"\ndefault_token = "SecretToken"\nheartbeat_timeout = 40\nretry_interval = 1\n\n[client.services.router_web]\ntype = "tcp"\nlocal_addr = "10.0.0.1:443"\nnodelay = true\n';
				LuCIDOMHelper.triggerChange(area);
			}
		};

		o = s.option(form.TextValue, 'content', _('TOML Content'),
			_('When Operation Mode is set to Raw, this full TOML configuration will be passed directly to Rathole.')
		);
		o.rows = 15;
		o.monospace = true;
		o.placeholder = '# [client]\n# remote_addr = "vps.example.com:2333"\n# ...';

		return m.render().then(function(mapNode) {
			var curMode = uci.get('rathole', 'global', 'mode') || 'client';
			window.requestAnimationFrame(function() {
				updateModeVisibility(curMode);
				var modeSelect = LuCIDOMHelper.getWidgetInput('rathole', 'global', 'mode') ||
					mapNode.querySelector('select[name="cbid.rathole.global.mode"]') ||
					mapNode.querySelector('[data-widget-id="widget.cbid.rathole.global.mode"]') ||
					mapNode.querySelector('select[id*="mode"]');
				if (modeSelect) {
					modeSelect.addEventListener('change', function(e) {
						updateModeVisibility(e.target.value);
					});
				}
			});

			return E('div', { 'class': 'cbi-map' }, [
				statusCard,
				mapNode
			]);
		});
	}
});
