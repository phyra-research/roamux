# Running the host as a background service

`openremote host` runs in the foreground and dies when the terminal closes. To
keep a machine online across terminal-close, logout, and reboot, install the
host as a **user-level** background service:

```sh
openremote service install     # macOS: launchd agent · Linux: systemd --user unit
openremote service status      # is it installed / running?
openremote service uninstall   # stop and remove it
```

`install` reads `HOST_NAME`, `TRANSPORT`, `AGENT_ADAPTER`, `HOST_DB_PATH`, and
`OPENCODE_URL` from the shell you run it in and bakes them into the unit file.
`ABLY_API_KEY` is a secret, so it is written to `~/.openremote-live/service.env`
(mode `0600`) and referenced from there — never inlined into the unit
(`~/Library/LaunchAgents/ai.phyra.openremote.plist` on macOS,
`~/.config/systemd/user/openremote.service` on Linux). Logs stream to
`~/.openremote-live/logs/host.out.log` and `host.err.log`
(`journalctl --user -u openremote` also works on Linux). Windows is not
supported yet — run `openremote host` in a terminal there.
