# Copyright (C) 2024-2026 luci-app-rathole contributors
# This is free software, licensed under the Apache License, Version 2.0

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-rathole
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

LUCI_TITLE:=LuCI for Rathole NAT Traversal Proxy
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all
LUCI_DESCRIPTION:=LuCI interface for managing Rathole, a lightweight and \
 high-performance reverse proxy for NAT traversal written in Rust. \
 Features real-time status dashboard, client service mapping, \
 Noise protocol encryption, and log viewing.

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=OpenIF <https://github.com/openif>

include $(firstword $(wildcard $(TOPDIR)/feeds/luci/luci.mk ../../luci.mk))

# call BuildPackage - OpenWrt buildroot signature
$(eval $(call BuildPackage,$(PKG_NAME)))
