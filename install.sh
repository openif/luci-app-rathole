#!/bin/sh
# =================================================================
# luci-app-rathole 1-Click Online Installer for OpenWrt / iStoreOS
# Repository: https://github.com/openif/luci-app-rathole
# =================================================================

set -e

echo "================================================="
echo " Installing luci-app-rathole for OpenWrt..."
echo "================================================="

# 1. Verify OpenWrt environment
if [ ! -f /etc/openwrt_release ] && [ ! -f /etc/os-release ]; then
    echo "[-] Error: This installer is intended for OpenWrt or iStoreOS routers."
    exit 1
fi

# 2. Check rathole core binary
if ! command -v rathole >/dev/null 2>&1 && [ ! -x /usr/bin/rathole ]; then
    echo "[!] Notice: 'rathole' core program not found in PATH or /usr/bin/rathole."
    ARCH=$(uname -m 2>/dev/null || echo "unknown")
    echo "    Router architecture detected: $ARCH"
    echo "    Please download the matching pre-built binary for your router from:"
    echo "    https://github.com/rapiz1/rathole/releases"
    echo "    and place it at /usr/bin/rathole (run: chmod +x /usr/bin/rathole)."
fi

# 3. Download and install release packages
TMP_APP_IPK="/tmp/luci-app-rathole_latest.ipk"
TMP_I18N_IPK="/tmp/luci-i18n-rathole-zh-cn_latest.ipk"
RELEASE_APP_URL="https://github.com/openif/luci-app-rathole/releases/download/v1.0.0/luci-app-rathole_1.0.0-1_all.ipk"
RELEASE_I18N_URL="https://github.com/openif/luci-app-rathole/releases/download/v1.0.0/luci-i18n-rathole-zh-cn_1.0.0-1_all.ipk"

echo "[*] Downloading package..."
DOWNLOAD_SUCCESS=0
if command -v curl >/dev/null 2>&1; then
    curl -fLs -o "$TMP_APP_IPK" "$RELEASE_APP_URL" && curl -fLs -o "$TMP_I18N_IPK" "$RELEASE_I18N_URL" && DOWNLOAD_SUCCESS=1 || true
elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TMP_APP_IPK" "$RELEASE_APP_URL" && wget -qO "$TMP_I18N_IPK" "$RELEASE_I18N_URL" && DOWNLOAD_SUCCESS=1 || true
fi

if [ "$DOWNLOAD_SUCCESS" -eq 1 ] && [ -s "$TMP_APP_IPK" ]; then
    echo "[*] Installing packages via opkg..."
    opkg install "$TMP_APP_IPK" "$TMP_I18N_IPK" 2>/dev/null || opkg install "$TMP_APP_IPK"
    rm -f "$TMP_APP_IPK" "$TMP_I18N_IPK"
else
    echo "[*] IPK not directly accessible yet. Installing plugin files directly..."
    RAW_BASE="https://raw.githubusercontent.com/openif/luci-app-rathole/main"

    dl() {
        local target="$1"
        local url="${RAW_BASE}/$2"
        mkdir -p "$(dirname "$target")"
        if command -v curl >/dev/null 2>&1; then
            curl -fsSL -o "$target" "$url"
        else
            wget -qO "$target" "$url"
        fi
    }

    dl "/etc/init.d/rathole" "root/etc/init.d/rathole"
    dl "/etc/config/rathole" "root/etc/config/rathole"
    dl "/etc/uci-defaults/40_luci-rathole" "root/etc/uci-defaults/40_luci-rathole"
    dl "/usr/share/luci/menu.d/luci-app-rathole.json" "root/usr/share/luci/menu.d/luci-app-rathole.json"
    dl "/usr/share/rpcd/acl.d/luci-app-rathole.json" "root/usr/share/rpcd/acl.d/luci-app-rathole.json"
    dl "/www/luci-static/resources/view/rathole/config.js" "htdocs/luci-static/resources/view/rathole/config.js"
    dl "/www/luci-static/resources/view/rathole/log.js" "htdocs/luci-static/resources/view/rathole/log.js"
    dl "/usr/lib/lua/luci/i18n/rathole.zh-cn.lmo" "po/zh_Hans/rathole.zh-cn.lmo"

    chmod +x /etc/init.d/rathole
    chmod +x /etc/uci-defaults/40_luci-rathole
    [ -f /etc/uci-defaults/40_luci-rathole ] && /etc/uci-defaults/40_luci-rathole && rm -f /etc/uci-defaults/40_luci-rathole
    /etc/init.d/rpcd restart
fi

echo ""
echo "================================================="
echo " [✓] luci-app-rathole installed successfully!"
echo " Please refresh your LuCI Web interface:"
echo " Go to: Services -> Rathole"
echo "================================================="
