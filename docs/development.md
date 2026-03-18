# Development

## Setup

```bash
pip install -e ".[dev]"
```

## Unit tests

```bash
pytest tests/ -m "not e2e and not llm_evaluation" -v
```

## E2E tests

Run against a live Horizon instance:

```bash
export HORIZON_E2E_URL=https://your-qa-instance.evertrust.io
export HORIZON_E2E_API_ID=your-api-id
export HORIZON_E2E_API_KEY=your-api-key
pytest -m e2e -v
```

## Linting and type checking

```bash
ruff check src/   # lint
mypy src/          # type check
```
