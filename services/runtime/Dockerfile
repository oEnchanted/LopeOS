FROM node:22-bookworm-slim AS pty-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/lope-pty
COPY agent/package*.json ./
RUN npm ci --omit=dev && find node_modules/node-pty -name spawn-helper -type f -exec chmod 755 {} +

FROM node:22-bookworm-slim
# The base image supplies Node; intentionally install the Unix compatibility set.
RUN apt-get update && apt-get install -y --no-install-recommends bash zsh coreutils grep sed gawk findutils tar git curl python3 less vim-tiny util-linux procps ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && usermod -l lope -d /home/lope -m -s /bin/bash node && groupmod -n lope node
COPY --from=pty-build /opt/lope-pty /opt/lope-pty
COPY agent/main.js agent/protocol.js /opt/lope-pty/
COPY fs.py /usr/local/lib/lope-fs.py
COPY session.py /usr/local/lib/lope-session.py
COPY isolation-probe.py /usr/local/lib/lope-isolation-probe.py
COPY sandbox-smoke.cjs /usr/local/lib/lope-sandbox-smoke.cjs
COPY bashrc /etc/lope-bashrc
RUN printf '\n[ -f /etc/lope-bashrc ] && . /etc/lope-bashrc\n' >> /etc/bash.bashrc \
 && printf '\nHISTFILE=$HOME/.zsh_history\nHISTSIZE=10000\nSAVEHIST=10000\nsetopt APPEND_HISTORY INC_APPEND_HISTORY\nautoload -Uz compinit; compinit\n' >> /etc/zsh/zshrc
RUN find / -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} +
USER 1000:1000
WORKDIR /home/lope
ENV HOME=/home/lope TERM=xterm-256color
CMD ["sleep", "infinity"]
