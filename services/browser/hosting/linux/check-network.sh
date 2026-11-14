#!/usr/bin/env bash
set -euo pipefail
[[ $EUID = 0 ]] || exit 1
iptables -C INPUT -i lope-browser0 -m conntrack ! --ctstate ESTABLISHED,RELATED -j REJECT
iptables -C DOCKER-USER -i lope-browser0 -j LOPE-BROWSER
iptables -C LOPE-BROWSER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for network in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
  iptables -C LOPE-BROWSER -d "$network" -j REJECT
done
iptables -C LOPE-BROWSER -p tcp -m multiport --dports 80,443 -j RETURN
iptables -C LOPE-BROWSER -d 1.1.1.1 -p udp --dport 53 -j RETURN
iptables -C LOPE-BROWSER -d 1.1.1.1 -p tcp --dport 53 -j RETURN
iptables -C LOPE-BROWSER -j REJECT
