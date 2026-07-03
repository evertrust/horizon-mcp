## [2.0.0](https://github.com/evertrust/horizon-mcp/compare/v1.2.0...v2.0.0) (2026-07-03)

### ⚠ BREAKING CHANGES

* streamable HTTP transport (hostable) + remove OIDC browser auth (#15)

### Features

* streamable HTTP transport (hostable) + remove OIDC browser auth ([#15](https://github.com/evertrust/horizon-mcp/issues/15)) ([fbfe22d](https://github.com/evertrust/horizon-mcp/commit/fbfe22de5d171570dd3840bd54e9cc4bf4edbf77))

### Bug Fixes

* ship only the JS bundle in the npm tarball ([#16](https://github.com/evertrust/horizon-mcp/issues/16)) ([4d456bd](https://github.com/evertrust/horizon-mcp/commit/4d456bd01a980612969e9ce2606c5f9d3a05de1a))

## [2.0.0](https://github.com/evertrust/horizon-mcp/compare/v1.2.0...v2.0.0) (2026-07-02)

### ⚠ BREAKING CHANGES

* streamable HTTP transport (hostable) + remove OIDC browser auth (#15)

### Features

* streamable HTTP transport (hostable) + remove OIDC browser auth ([#15](https://github.com/evertrust/horizon-mcp/issues/15)) ([fbfe22d](https://github.com/evertrust/horizon-mcp/commit/fbfe22de5d171570dd3840bd54e9cc4bf4edbf77))

## [1.2.0](https://github.com/evertrust/horizon-mcp/compare/v1.1.3...v1.2.0) (2026-06-18)

### Features

* add Horizon 2.10 configuration CRUD tools (v2.0.0) ([#13](https://github.com/evertrust/horizon-mcp/issues/13)) ([8f5303a](https://github.com/evertrust/horizon-mcp/commit/8f5303a4d4f33aedc0341c16cc169a59aba6c669))

## [1.1.3](https://github.com/evertrust/horizon-mcp/compare/v1.1.2...v1.1.3) (2026-05-21)

### Bug Fixes

* batch of various fixes and small improvements ([9c5795f](https://github.com/evertrust/horizon-mcp/commit/9c5795f235cf8eee4e1eade257334f726c402958))

## [1.1.2](https://github.com/evertrust/horizon-mcp/compare/v1.1.1...v1.1.2) (2026-05-19)

### Bug Fixes

* run npm pkg fix command ([#10](https://github.com/evertrust/horizon-mcp/issues/10)) ([0bc7d01](https://github.com/evertrust/horizon-mcp/commit/0bc7d0121afa9b5efcd321368d676788368fe3bb))

## [1.1.1](https://github.com/evertrust/horizon-mcp/compare/v1.1.0...v1.1.1) (2026-05-19)

### Bug Fixes

* ci configuration for public access ([#8](https://github.com/evertrust/horizon-mcp/issues/8)) ([89b99b8](https://github.com/evertrust/horizon-mcp/commit/89b99b81d485f2b3227fe84541a4a66c33107b99))
* public package access ([#7](https://github.com/evertrust/horizon-mcp/issues/7)) ([94d2495](https://github.com/evertrust/horizon-mcp/commit/94d249514cc7726b281b863c56e7969be54bb6f8))
* trailing slash in package.json ([#9](https://github.com/evertrust/horizon-mcp/issues/9)) ([a8dff02](https://github.com/evertrust/horizon-mcp/commit/a8dff02bad7a0952ce8de7a2dbba06fb3dfa4633))

## [1.1.0](https://github.com/evertrust/horizon-mcp/compare/v1.0.1...v1.1.0) (2026-04-29)

### Features

* add docs search tools and small-model guidance ([#4](https://github.com/evertrust/horizon-mcp/issues/4)) ([77c86e4](https://github.com/evertrust/horizon-mcp/commit/77c86e42f342c5626963ab471c52f7d75e852b74))
* add new tools for doc search & improve MCP usability for small models ([#5](https://github.com/evertrust/horizon-mcp/issues/5)) ([b60c551](https://github.com/evertrust/horizon-mcp/commit/b60c551f4977eb9243a33bdaa97d6b842f086db3))

## [1.0.1](https://github.com/evertrust/horizon-mcp/compare/v1.0.0...v1.0.1) (2026-04-08)

### Bug Fixes

* release public version ([#2](https://github.com/evertrust/horizon-mcp/issues/2)) ([5239907](https://github.com/evertrust/horizon-mcp/commit/5239907fe4640a74f4d9906baf386fa53c60c369))

## 1.0.0 (2026-04-03)

### Features

* add decode_crl, decode_ocsp, decode_tsa + fix RFC5280 endpoints + E2E + LLM scenarios ([4d4c6cb](https://github.com/evertrust/horizon-mcp/commit/4d4c6cbdb5b7d57b2879ba330c97f745788b4608))
* add discovery-workflows hint on create_discovery_campaign docstring ([f4a3d8c](https://github.com/evertrust/horizon-mcp/commit/f4a3d8c2d224c83264400ecf968a0dc8c1dce079))
* add discovery-workflows knowledge hints to all discovery tool docstrings ([564db1b](https://github.com/evertrust/horizon-mcp/commit/564db1bfcb4290ad5ec470e66b34a7d43c87065b))
* add discovery-workflows knowledge resource with comprehensive CLI guidance ([d6963a0](https://github.com/evertrust/horizon-mcp/commit/d6963a0292ce7b2484b76deeaecf58fd44ad8dff))
* add fetch_exposed_certificate tool for remote TLS cert retrieval ([937b7cb](https://github.com/evertrust/horizon-mcp/commit/937b7cba95cb5f58edae5e8d79b00980496bb0f0))
* first release ([2cb30e4](https://github.com/evertrust/horizon-mcp/commit/2cb30e4b76c2f9a5e9adc1cf75e53b9055110c80))
* hint MCP to use fetch_exposed_certificate for deployment checks ([ff9f235](https://github.com/evertrust/horizon-mcp/commit/ff9f235e9ef26fcfb190a48013b312a3ab2987d0))
* initial commit with Phase 1/Phase 2 tool registration split ([105fdc4](https://github.com/evertrust/horizon-mcp/commit/105fdc403cb2b67c186b95287b7a9efef3fde45a))
* lifecycle tool guidance — ask user for fields, EST/SCEP support, revocation reasons ([c4afbb7](https://github.com/evertrust/horizon-mcp/commit/c4afbb707beb90249ef3993b1a35a78861f51015))
* Phase 1 TypeScript scaffold - core infrastructure + representative tools ([f7f7fbf](https://github.com/evertrust/horizon-mcp/commit/f7f7fbfd10f9564ee498551f177cadcc76415021))
* Phase 2 bulk tool migration - all 81 tools ported ([ce3ccf4](https://github.com/evertrust/horizon-mcp/commit/ce3ccf4e8032c22b93144e53fd5dc91ec94cf007))
* Phase 3 polish - golden tests, E2E scaffolding, docstring fixes, build pipeline ([6d6dd00](https://github.com/evertrust/horizon-mcp/commit/6d6dd0059861c08398d0561af24595fee85a12ce))
* PKCS[#12](https://github.com/evertrust/horizon-mcp/issues/12) retrieval hints — guide MCP to look in request, not certificate ([3e1c88c](https://github.com/evertrust/horizon-mcp/commit/3e1c88c1442050f33cbeb386f44224f106bd4c06))
* server instruction rule 7 — never use openssl, always use decode tools ([622ef75](https://github.com/evertrust/horizon-mcp/commit/622ef7519016b7ad968f24e07a774d1b204c29a8))

### Bug Fixes

* computation rule tool uses correct API mode + exhaustive expression syntax docs ([1c4390c](https://github.com/evertrust/horizon-mcp/commit/1c4390c61224bfdde3f707b8b3eaf24711d53883))
* correct knowledge resource count in README why-knowledge section ([0e7787e](https://github.com/evertrust/horizon-mcp/commit/0e7787e7928c004672d6af92dfccad53b8d0193a))
* correct MCP config command (python -m horizon_mcp.server) + OIDC playwright install ([ec04e79](https://github.com/evertrust/horizon-mcp/commit/ec04e795efc7d3d49c429d686c2badca13f052a9))
* dashboard create uses POST, computation rule detects template vs rule syntax ([9cf9c6a](https://github.com/evertrust/horizon-mcp/commit/9cf9c6ad5982cc9b76aff3129ae2ac47b56da299))
* feed_discovery_certificate payload + document certificate lifecycle stages ([f7fa7cd](https://github.com/evertrust/horizon-mcp/commit/f7fa7cdac0825eebd348185d0561fa610895283f))
* increase LLM eval timeout to 300s for complex scenarios ([3482b81](https://github.com/evertrust/horizon-mcp/commit/3482b81b83296a9d9b7872cff80329f0a107f953))
* match Python error-handling behavior for approve/deny/cancel request tools ([9e64cad](https://github.com/evertrust/horizon-mcp/commit/9e64cad3b94c09f770e71c7241d87e9f3087e253))
* README audit — correct auth mode count, verify command, path references, dev commands ([4c96ff7](https://github.com/evertrust/horizon-mcp/commit/4c96ff7c4b6a11950e75e3fb2a414a112cbc53d5))
* replace Panorama example with generic webhook (syntax preserved) ([329d6f1](https://github.com/evertrust/horizon-mcp/commit/329d6f13396925919c4e86b3e73a6e93c13a0e8d))
* soften rule 7 — hint available decode tools instead of forbidding openssl ([00efd00](https://github.com/evertrust/horizon-mcp/commit/00efd006568674f59ad8b59ea252f5a96d07792a))
* tool bugs (dashboard POST, profile PUT path, discovery port types) + E2E test fixes ([1632b91](https://github.com/evertrust/horizon-mcp/commit/1632b917c82544d8500fbe6a3436cdad0ee5beb4))
* use two-arg z.record() to work around Zod 4.3.6 bug ([232924d](https://github.com/evertrust/horizon-mcp/commit/232924d8b10eca7d31539ce8fc5a31f2a36a77d7))
