/**
 * @license Apache-2.0
 * Copyright (C) 2024-2026 luci-app-rathole contributors
 * 
 * Rathole Runtime Log Viewer
 * Provides live log polling, keyword filtering, auto-scroll control,
 * error/warning counters, and log export/clearing capabilities.
 */

'use strict';
'require fs';
'require ui';
'require view';
'require poll';

/**
 * Fetch the latest N lines from the Rathole daemon log file
 * @param {number} maxLines - Maximum number of tail lines to retrieve
 * @returns {Promise<string>} Log text content
 */
function fetchLogs(maxLines) {
	var limit = maxLines || 200;
	return fs.read('/var/log/rathole.log').catch(function() {
		return fs.read('/tmp/log/rathole.log');
	}).then(function(res) {
		if (!res || !res.trim()) return _('No log data available.');
		var rawLines = res.trim().split('\n');
		var recent = rawLines.slice(-limit);
		return recent.join('\n');
	}).catch(function(err) {
		return _('Unable to read log file: ') + (err.message || err);
	});
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function() {
		return fetchLogs(200);
	},

	render: function(initialLogs) {
		var isAutoScroll = true;
		var isPaused = false;
		var rawLogContent = initialLogs || '';

		/**
		 * Filter log text based on search term
		 * @param {string} content - Full log text
		 * @returns {string} Filtered log lines
		 */
		function filterLogContent(content) {
			var query = (filterInput && filterInput.value) ? filterInput.value.trim().toLowerCase() : '';
			if (!query) return content;
			var lines = content.split('\n');
			var matched = lines.filter(function(line) {
				return line.toLowerCase().indexOf(query) !== -1;
			});
			return matched.length > 0 ? matched.join('\n') : _('No matching log entries found.');
		}

		/**
		 * Update error/warning badges in the toolbar
		 * @param {string} content - Log text
		 */
		function updateLogStats(content) {
			if (!statsBadge) return;
			var errCount = (content.match(/\bERROR\b/g) || []).length;
			var warnCount = (content.match(/\bWARN\b/g) || []).length;
			var html = '';
			if (errCount > 0) {
				html += '<span style="display: inline-block; background: #e74c3c; color: white; border-radius: 3px; padding: 1px 6px; font-size: 11px; margin-right: 6px;">' + errCount + ' ' + _('Errors') + '</span>';
			}
			if (warnCount > 0) {
				html += '<span style="display: inline-block; background: #f39c12; color: white; border-radius: 3px; padding: 1px 6px; font-size: 11px; margin-right: 6px;">' + warnCount + ' ' + _('Warnings') + '</span>';
			}
			statsBadge.innerHTML = html;
		}

		var statsBadge = E('span', { 'style': 'margin-left: 8px;' });

		var logArea = E('textarea', {
			'id': 'syslog',
			'class': 'cbi-input-textarea',
			'style': 'width: 100%; height: 520px; font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; padding: 10px; box-sizing: border-box; line-height: 1.5; white-space: pre; overflow-y: scroll;',
			'readonly': 'readonly',
			'wrap': 'off'
		}, [ initialLogs || '' ]);

		window.requestAnimationFrame(function() {
			logArea.value = filterLogContent(initialLogs || '');
			logArea.scrollTop = logArea.scrollHeight;
			updateLogStats(initialLogs || '');
		});

		// User scroll position detector
		logArea.addEventListener('scroll', function() {
			var isNearBottom = (logArea.scrollHeight - logArea.scrollTop - logArea.clientHeight <= 40);
			isAutoScroll = isNearBottom;
		});

		var lineSelect = E('select', { 'id': 'log-lines', 'style': 'margin-right: 8px;' }, [
			E('option', { 'value': '100' }, '100 ' + _('Lines')),
			E('option', { 'value': '200', 'selected': 'selected' }, '200 ' + _('Lines')),
			E('option', { 'value': '500' }, '500 ' + _('Lines'))
		]);

		var filterInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': _('Filter keywords (e.g. ERROR, router_web)...'),
			'style': 'width: 220px; margin-right: 8px;',
			'input': function() {
				logArea.value = filterLogContent(rawLogContent);
				if (isAutoScroll) {
					logArea.scrollTop = logArea.scrollHeight;
				}
			}
		});

		var refreshBtn = E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'style': 'margin-right: 6px;',
			'click': function(ev) {
				var btn = ev.target;
				btn.disabled = true;
				var lines = parseInt(lineSelect.value, 10) || 200;
				fetchLogs(lines).then(function(content) {
					rawLogContent = content;
					logArea.value = filterLogContent(content);
					updateLogStats(content);
					logArea.scrollTop = logArea.scrollHeight;
					isAutoScroll = true;
				}).finally(function() {
					btn.disabled = false;
				});
			}
		}, _('Refresh'));

		var pauseBtn = E('button', {
			'class': 'btn cbi-button',
			'style': 'margin-right: 6px;',
			'click': function() {
				isPaused = !isPaused;
				if (isPaused) {
					pauseBtn.textContent = _('Resume Auto-refresh');
					pauseBtn.style.color = '#e67e22';
					pauseBtn.style.borderColor = '#e67e22';
					ui.addNotification(null, E('p', {}, _('Log auto-refresh paused.')), 'info');
				} else {
					pauseBtn.textContent = _('Pause Auto-refresh');
					pauseBtn.style.color = '';
					pauseBtn.style.borderColor = '';
					ui.addNotification(null, E('p', {}, _('Log auto-refresh resumed.')), 'info');
				}
			}
		}, _('Pause Auto-refresh'));

		var clearBtn = E('button', {
			'class': 'btn cbi-button cbi-button-reset',
			'style': 'margin-right: 6px;',
			'click': function() {
				if (!confirm(_('Are you sure you want to clear the runtime log file?'))) return;
				fs.exec('/etc/init.d/rathole', ['clear_log']).catch(function() {
					return fs.write('/var/log/rathole.log', '');
				}).catch(function() {
					return fs.write('/tmp/log/rathole.log', '');
				}).then(function() {
					rawLogContent = '';
					logArea.value = _('No log data available.');
					updateLogStats('');
					ui.addNotification(null, E('p', {}, _('Log file cleared successfully.')), 'info');
				}).catch(function(err) {
					ui.addNotification(null, E('p', {}, _('Failed to clear log: ') + (err.message || err)), 'error');
				});
			}
		}, _('Clear Log'));

		var copyBtn = E('button', {
			'class': 'btn cbi-button',
			'style': 'margin-right: 6px;',
			'click': function() {
				navigator.clipboard.writeText(logArea.value).then(function() {
					ui.addNotification(null, E('p', {}, _('Log copied to clipboard!')), 'info');
				});
			}
		}, _('Copy'));

		var downloadBtn = E('button', {
			'class': 'btn cbi-button cbi-button-save',
			'click': function() {
				var blob = new Blob([logArea.value || ''], { type: 'text/plain;charset=utf-8' });
				var link = document.createElement('a');
				link.href = window.URL.createObjectURL(blob);
				link.download = 'rathole-' + (new Date().toISOString().slice(0, 10)) + '.log';
				link.click();
			}
		}, _('Download Log'));

		// Polling update every 4s
		poll.add(function() {
			if (isPaused) return;
			var lines = parseInt(lineSelect.value, 10) || 200;
			return fetchLogs(lines).then(function(content) {
				rawLogContent = content;
				updateLogStats(content);
				var el = document.getElementById('syslog');
				if (el) {
					el.value = filterLogContent(content);
					if (isAutoScroll) {
						el.scrollTop = el.scrollHeight;
					}
				}
			});
		}, 4);

		return E([], [
			E('h2', { 'class': 'section-title' }, _('Rathole - Runtime Log')),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'style': 'margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;' }, [
					E('div', { 'style': 'display: flex; align-items: center; flex-wrap: wrap; gap: 6px;' }, [
						E('label', { 'style': 'margin-right: 4px;' }, _('Display:')),
						lineSelect,
						filterInput,
						statsBadge
					]),
					E('div', { 'style': 'display: flex; gap: 6px; flex-wrap: wrap;' }, [
						refreshBtn,
						pauseBtn,
						clearBtn,
						copyBtn,
						downloadBtn
					])
				]),
				E('div', { 'class': 'cbi-section-node' }, [
					logArea
				])
			])
		]);
	}
});
