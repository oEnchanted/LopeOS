# Docker seccomp profile

`docker-default-seccomp.json` is the upstream Moby/Docker default profile at commit
`f862455628f78f84c937e967e4a03902fb1dee11`:
https://github.com/moby/profiles/blob/f862455628f78f84c937e967e4a03902fb1dee11/seccomp/default.json

The upstream Apache 2.0 license is included as `DOCKER-PROFILES-LICENSE`.
`make-seccomp.mjs` creates a derived runtime profile enabling namespace system calls
for Chromium's own sandbox; the vendored upstream profile remains unchanged.
