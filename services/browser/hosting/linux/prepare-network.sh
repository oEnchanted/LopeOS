#!/usr/bin/env bash
set -euo pipefail
[[ $EUID = 0 ]] || exit 1
if ! docker network inspect lope-browser-public >/dev/null 2>&1; then
  docker network create --driver bridge --opt com.docker.network.bridge.name=lope-browser0 --opt com.docker.network.bridge.enable_icc=false lope-browser-public >/dev/null
fi
# Only our dedicated network enters this chain. Leave all unrelated Docker traffic alone.
iptables -I DOCKER-USER 1 -i lope-browser0 -m comment --comment lope-browser-update -j DROP
# Traffic to the WSL host itself uses INPUT rather than DOCKER-USER. Permit
# responses to host-initiated control connections, but reject new worker access.
iptables -C INPUT -i lope-browser0 -m conntrack ! --ctstate ESTABLISHED,RELATED -j REJECT 2>/dev/null || iptables -I INPUT 1 -i lope-browser0 -m conntrack ! --ctstate ESTABLISHED,RELATED -j REJECT
iptables -N LOPE-BROWSER 2>/dev/null || true
iptables -F LOPE-BROWSER
iptables -A LOPE-BROWSER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for network in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
  iptables -A LOPE-BROWSER -d "$network" -j REJECT
done
iptables -A LOPE-BROWSER -p tcp -m multiport --dports 80,443 -j RETURN
iptables -A LOPE-BROWSER -d 1.1.1.1 -p udp --dport 53 -j RETURN
iptables -A LOPE-BROWSER -d 1.1.1.1 -p tcp --dport 53 -j RETURN
iptables -A LOPE-BROWSER -j REJECT
iptables -C DOCKER-USER -i lope-browser0 -j LOPE-BROWSER 2>/dev/null || iptables -I DOCKER-USER 1 -i lope-browser0 -j LOPE-BROWSER
bash /opt/lope-browser/check-network.sh
iptables -D DOCKER-USER -i lope-browser0 -m comment --comment lope-browser-update -j DROP
