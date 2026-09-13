# Running the host as a background service

`roamux host` runs in the foreground and dies when the terminal closes. To
keep a machine online across terminal-close, logout, and reboot, install the
host as a **user-level** background service:

```sh
roamux service install     # macOS: launchd agent · Linux: systemd --user unit
roamux service status      # is it installed / running?
roamux service uninstall   # stop and remove it
```

`install` reads `HOST_NAME`, `TRANSPORT`, `AGENT_ADAPTER`, `HOST_DB_PATH`, and
`OPENCODE_URL` from the shell you run it in and bakes them into the unit file.
`ABLY_API_KEY` is a secret, so it is written to `~/.roamux-live/service.env`
(mode `0600`) and referenced from there — never inlined into the unit
(`~/Library/LaunchAgents/ai.phyra.roamux.plist` on macOS,
`~/.config/systemd/user/roamux.service` on Linux). Logs stream to
`~/.roamux-live/logs/host.out.log` and `host.err.log`
(`journalctl --user -u roamux` also works on Linux). Windows is not
supported yet — run `roamux host` in a terminal there.
