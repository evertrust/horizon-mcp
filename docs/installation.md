# Installation

## Prerequisites

- Python 3.11+
- An Evertrust Horizon instance (tested on 2.8, expected to work on 2.7 and 2.9)
- API credentials or a client certificate with appropriate permissions

## Install from source

```bash
git clone https://github.com/evertrust/horizon-mcp
cd horizon-mcp
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
```

Verify the module is importable:

```bash
.venv/bin/python -c "from horizon_mcp.server import mcp; print(f'{len(mcp._tool_manager._tools)} tools registered')"
```

Note the **absolute path** to the Python binary in the venv  -  you'll need it
for [client configuration](client-setup.md):

```bash
echo "$(pwd)/.venv/bin/python"
```

## OIDC browser authentication (optional)

For OIDC browser-based login, install Playwright and its browser:

```bash
pip install -e ".[oidc]"
playwright install chromium
```

## Next steps

- [Authentication](authentication.md)  -  configure how the server connects to Horizon
- [Client setup](client-setup.md)  -  connect your LLM client to the server
