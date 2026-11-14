# Build from the repository root: docker build -f services/browser/infra/Dockerfile -t lope-browser .
# Release tag verified against Selkies 2.2.1's images workflow. Pin resolved digests in production.
FROM node:24-trixie-slim AS node
FROM ghcr.io/selkies-project/selkies/base:2.2.1-debiantrixie
USER 0
SHELL ["/bin/sh", "-c"]
# Google Chrome on x86-64: the same browser, codecs (H.264/AAC) and Widevine DRM
# people run on their own computers, fetched fresh from Google on every image build.
# Other architectures, which Google does not build for, keep Debian Chromium.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl openbox x11-utils fonts-noto-color-emoji \
    && if [ "$(dpkg --print-architecture)" = amd64 ]; then \
         curl -fsSL --retry 5 --connect-timeout 30 -o /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
         && apt-get install -y --no-install-recommends /tmp/google-chrome.deb && rm -f /tmp/google-chrome.deb \
         && test -x /opt/google/chrome/chrome && ln -s /opt/google/chrome/chrome /usr/local/bin/lope-chrome; \
       else \
         apt-get install -y --no-install-recommends chromium chromium-sandbox && ln -s /usr/bin/chromium /usr/local/bin/lope-chrome; \
       fi \
    && rm -rf /var/lib/apt/lists/* /etc/cron.daily/google-chrome \
    && find / -xdev -type f -perm /6000 -exec chmod a-s {} + \
    && rm -f /usr/local/bin/sudo-root \
    && mkdir -p /opt/lope /profiles /opt/lope-services \
    && chown 1000:1000 /profiles
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --chown=0:0 packages/browser-client/src /opt/lope/packages/browser-client/src
COPY --chown=0:0 services/browser/src /opt/lope/services/browser/src
COPY --chown=0:0 services/runtime/browser-bridge.js services/runtime/config.js /opt/lope/services/runtime/
COPY --chown=0:0 services/browser/infra/entrypoint.sh /opt/lope/entrypoint.sh
COPY --chown=0:0 services/browser/infra/worker.run /opt/lope-services/browser/run
COPY --chown=0:0 services/browser/infra/openbox.run /opt/lope-services/openbox/run
# Keep first-run promotions (sign-in, privacy notices, default-browser checks) off the kiosk window.
COPY --chown=0:0 services/browser/infra/chrome-policies.json /etc/opt/chrome/policies/managed/lope.json
COPY --chown=0:0 services/browser/infra/chrome-policies.json /etc/chromium/policies/managed/lope.json
# s6 and its supervision files live in ephemeral writable storage.
RUN cp -a /etc/service/. /opt/lope-services/ \
    && sed -i 's|/etc/service|/tmp/lope-services|g' /etc/container-entrypoint.sh \
    && grep -q 'exec selkies --public ' /etc/selkies-entrypoint.sh \
    && sed -i 's/exec selkies --public /exec selkies /' /etc/selkies-entrypoint.sh \
    && chmod -R a-w /opt/lope /opt/lope-services \
    && chmod a+rx /opt/lope/entrypoint.sh /opt/lope-services/browser/run /opt/lope-services/openbox/run
USER 1000:1000
ENV SELKIES_WAYLAND=false SELKIES_ENABLE_HTTPS=false SELKIES_ADDR=127.0.0.1 SELKIES_PUBLIC=false \
    SELKIES_SUBFOLDER=/api/browser/stream SELKIES_PORT=8080 SELKIES_MODE=websockets \
    SELKIES_ENABLE_BASIC_AUTH=true SELKIES_BASIC_AUTH_USER=lope SELKIES_COMMAND_ENABLED=false \
    SELKIES_FILE_TRANSFERS=none SELKIES_PRINTING_ENABLED=false SELKIES_ENABLE_SHARING=false \
    SELKIES_WEBCAM_ENABLED="false|locked" SELKIES_MICROPHONE_ENABLED="false|locked" SELKIES_GAMEPAD_ENABLED="false|locked" \
    SELKIES_ENABLE_CLIPBOARD=true SELKIES_CLIPBOARD_SEAMLESS="false|locked" \
    SELKIES_UI_SHOW_SIDEBAR=false SELKIES_ENABLE_INTERNAL_TURN=false SELKIES_ENABLE_DUAL_MODE=false \
    LOPE_BROWSER_BIND=0.0.0.0 LOPE_BROWSER_HOSTS=browser-worker,127.0.0.1,localhost \
    LOPE_BROWSER_DATA=/profiles/normal CHROMIUM_EXECUTABLE=/usr/local/bin/lope-chrome \
    SELKIES_URL=http://127.0.0.1:8080
# CPU path; the host allocator overrides these when a GPU encodes. Stream at CSS
# pixels: HiDPI on a 2x screen makes Chromium render and x264 encode 4x the pixels.
# Encode only when the screen changes, not every frame of a still page.
# Software x264 on a CPU host: 30 fps and 4:2:0 color roughly halve encode time against
# Selkies' 60 fps 4:4:4 defaults. People can still raise the frame rate up to 60.
ENV SELKIES_USE_CSS_SCALING="true|locked" SELKIES_VIDEO_STREAMING_MODE="false|locked" \
    SELKIES_FRAMERATE="30,8-60" SELKIES_VIDEO_FULLCOLOR="false" UV_THREADPOOL_SIZE=16
WORKDIR /opt/lope
EXPOSE 4175
ENTRYPOINT ["/opt/lope/entrypoint.sh"]
