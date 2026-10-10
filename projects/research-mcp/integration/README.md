# Optional Pi bridge check

`pi-connection-check.mjs` exercises an installed `pi-mcp-extension` configuration loader, server manager and tool bridge with captured Pi registration hooks. It makes no model-inference calls and does not modify a running Pi session. It resolves `example-client-config.json` into the current checkout and a disposable HOME rather than reading an operator's real client configuration.

This is an additional compatibility check, not a dependency of the Python unit suite or CI. It requires:

- the Python virtual environment already prepared;
- an existing Pi package installation (including its `jiti` dependency), identified by `PI_PACKAGE_ROOT`;
- an existing `pi-mcp-extension` installation, identified by `PI_MCP_PACKAGE_ROOT`;
- a Linux sandbox with read-only source/toolchain, a private128MiB `/scratch` tmpfs, `HOME=/scratch/home`, clean allowlisted environment and appropriate process/time/memory limits.

Mount only the required installed package roots, not account/config/auth stores. Set `PATH=/usr/bin:/bin`, and run the following **inside that sandbox with external networking disabled**:

```bash
node --jitless --max-old-space-size=256 integration/pi-connection-check.mjs
```

Node may need an8GiB address-space reservation allowance even with a256MiB heap cap. The check starts a temporary stdio server, discovers five tools, calls local-only operations, verifies server-side input validation, checks cwd shadowing resistance, and confirms shutdown/instance-lock release.

`--live` additionally searches public providers. This requires explicit operator approval, deliberately enabled network access/DNS/public CA certificates, and adherence to provider limits. `--openalex-only` narrows that optional live search. Do not repeatedly run it to bypass rate limits or while another operator's research server is active. A provider outage can make it exit nonzero; that is not permission for an unbounded retry loop.

The standalone check does not prove activation in a particular chat. In Pi, verify `/mcp research` reports ready and then actually call a research tool. Live observations and their limitations are recorded in [VALIDATION.md](../VALIDATION.md).
