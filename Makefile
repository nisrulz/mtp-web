SHELL := /bin/sh

NODE ?= node
NPX ?= npx --no-install

.DEFAULT_GOAL := help

.PHONY: help install test lint lint-fix format format-check typecheck check \
	audit e2e manual-test demo-bundle demo-bundle-check pages pack publish \
	rebuild

help: ## List the available targets
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install the Node.js dependencies
	yarn install --frozen-lockfile

test: ## Run the unit tests
	$(NODE) --test test/mtp.test.js test/usb.test.js

lint: ## Check the code with ESLint
	$(NPX) eslint .

lint-fix: ## Fix the issues that ESLint can fix
	$(NPX) eslint . --fix

format: ## Format the files with Prettier
	$(NPX) prettier --write .

format-check: ## Check the formatting
	$(NPX) prettier --check .

typecheck: ## Type-check the JavaScript with the JSDoc types
	$(NPX) tsc -p tsconfig.json

check: format-check lint typecheck demo-bundle-check test ## Run every automated check

audit: ## Check the dependencies for known vulnerabilities
	yarn audit --level high

e2e: ## Run the E2E suite against a physical device
	$(NODE) --test e2e/device.test.js

manual-test: ## Run the hardware smoke test
	$(NODE) scripts/manual-test.js

demo-bundle: ## Build the standalone browser bundle in _site
	$(NODE) scripts/build-demo.js
	mkdir -p _site/img
	cp img/logo.svg _site/img/logo.svg

demo-bundle-check: ## Verify the standalone browser bundle is current
	$(NODE) scripts/build-demo.js --check
	cmp -s img/logo.svg _site/img/logo.svg || (echo "_site/img/logo.svg is stale. Run \`make demo-bundle\`."; exit 1)

pages: demo-bundle ## Prepare the GitHub Pages demo in _site

pack: ## Inspect the npm tarball
	npm pack --dry-run

publish: check ## Publish the package to npm
	npm publish --access public

rebuild: ## Rebuild the usb native module
	npm rebuild usb
