# Operational shortcuts for running CloudCLI UI as a background service.
#
#   make start           production server (builds first if no build exists)
#   make start MODE=dev  dev stack: backend via tsx + Vite with hot reload
#
# Each mode keeps its own PID and log file under .run/, so a production server
# and a dev stack are managed independently.
#
# The service-* targets install the production server as a systemd unit
# instead, which restarts it on failure and at boot. The remote-* targets do
# the same on another machine over SSH:
#
#   make remote-install REMOTE=root@192.168.1.10
#
# Run `make help` for every target.

SHELL := /bin/bash
.DEFAULT_GOAL := help

MODE ?= prod
ifeq ($(filter $(MODE),prod dev),)
$(error MODE must be "prod" or "dev", got "$(MODE)")
endif

RUN_DIR  := .run
PID_FILE := $(RUN_DIR)/$(MODE).pid
LOG_FILE := $(RUN_DIR)/$(MODE).log

# Same defaults the server applies when .env leaves them unset.
env_value = $(shell sed -n 's/^$(1)=//p' .env 2>/dev/null | tail -n 1 | tr -d '[:space:]')
# Like env_value, but keeps inner spaces and drops surrounding quotes (e.g. a full name).
env_text = $(shell sed -n 's/^$(1)=//p' .env 2>/dev/null | tail -n 1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$$//;s/^"\(.*\)"$$/\1/')
SERVER_PORT := $(or $(call env_value,SERVER_PORT),3001)
VITE_PORT   := $(or $(call env_value,VITE_PORT),5173)
BIND_HOST   := $(or $(call env_value,HOST),0.0.0.0)
# A wildcard bind address is not connectable; probe loopback instead.
PROBE_HOST  := $(if $(filter 0.0.0.0 :: localhost,$(BIND_HOST)),127.0.0.1,$(BIND_HOST))
HEALTH_URL  := http://$(PROBE_HOST):$(SERVER_PORT)/health

ifeq ($(MODE),dev)
RUN_CMD := npm run dev
APP_URL := http://localhost:$(VITE_PORT)
else
RUN_CMD := npm run server
APP_URL := http://localhost:$(SERVER_PORT)
endif

# Seconds to wait for /health after start, and for a graceful exit after SIGTERM.
START_TIMEOUT ?= 60
STOP_TIMEOUT  ?= 15

# Exit status 0 when the PID file names a live process.
is_running = [ -f $(PID_FILE) ] && kill -0 "$$(cat $(PID_FILE))" 2>/dev/null

# ----------------------------------------------------------------------------
# systemd service settings. The unit is generated from these values at
# `make service-install`; rerun it after changing any of them.
SERVICE_NAME ?= cloudcli
# Account the server, its terminals and the agent CLIs run as. Prefer a
# dedicated user over root; that user must have the agent CLIs logged in.
SERVICE_USER ?= $(shell id -un)
SERVICE_HOME := $(shell getent passwd $(SERVICE_USER) | cut -d: -f6)
# Absolute node path, so a version-manager install (nvm) works without a login
# shell. The service user must be able to execute it.
NODE_BIN     ?= $(shell command -v node)
# Agent CLIs are looked up on PATH: include node's bin dir (npm -g installs)
# and ~/.local/bin (Claude Code native installer).
SERVICE_PATH ?= $(dir $(NODE_BIN)):$(SERVICE_HOME)/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Optional: run the service on a port other than SERVER_PORT from .env.
SERVICE_PORT ?=
UNIT_FILE    := /etc/systemd/system/$(SERVICE_NAME).service
SERVICE_HEALTH_URL := http://$(PROBE_HOST):$(or $(SERVICE_PORT),$(SERVER_PORT))/health
SUDO         := $(if $(filter 0,$(shell id -u)),,sudo)

# Git identity of the commits made by the service (agents, terminals, git
# panel): `git config --global` for SERVICE_USER. Read from .env, where the
# remote-* targets also copy it, so every node commits as the same person.
GIT_USER_NAME  ?= $(call env_text,GIT_USER_NAME)
GIT_USER_EMAIL ?= $(call env_text,GIT_USER_EMAIL)
# They travel inside single-quoted remote commands and double-quoted arguments.
ifneq ($(findstring ',$(GIT_USER_NAME)$(GIT_USER_EMAIL))$(findstring ",$(GIT_USER_NAME)$(GIT_USER_EMAIL)),)
$(error GIT_USER_NAME and GIT_USER_EMAIL must not contain quotes)
endif

define UNIT_CONTENT
[Unit]
Description=CloudCLI UI ($(SERVICE_NAME))
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(SERVICE_USER)
WorkingDirectory=$(CURDIR)
Environment=NODE_ENV=production
Environment=PATH=$(SERVICE_PATH)$(if $(SERVICE_PORT),
Environment=SERVER_PORT=$(SERVICE_PORT))
# Same recovery step `npm run server` runs before starting (preserver script).
ExecStartPre=$(NODE_BIN) scripts/promote-dist-server.mjs recover
ExecStart=$(NODE_BIN) dist-server/server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
endef
export UNIT_CONTENT

.PHONY: help install build ensure-build service-wait start stop restart status logs dev test test-client lint typecheck check \
	service-unit service-install service-uninstall service-start service-stop service-restart service-status service-logs git-identity \
	remote-check remote-sync remote-install remote-deploy remote-start remote-stop remote-restart remote-status \
	remote-logs remote-uninstall remote-ssh remote-git-identity require-remote

help: ## Show this help
	@echo "Usage: make <target> [MODE=prod|dev]   (current MODE=$(MODE))"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

build: ## Build frontend (dist/) and backend (dist-server/)
	npm run build

ensure-build:
	@if [ ! -f dist/index.html ] || [ ! -f dist-server/server/index.js ]; then \
		echo "No build found, running 'make build' first."; $(MAKE) --no-print-directory build; \
	fi

start: $(if $(filter prod,$(MODE)),ensure-build) ## Start the server in the background (MODE=prod|dev)
	@mkdir -p $(RUN_DIR)
	@if $(is_running); then \
		echo "Already running ($(MODE), PID $$(cat $(PID_FILE)))."; exit 0; \
	fi; \
	if curl -fsS -o /dev/null --max-time 2 $(HEALTH_URL) 2>/dev/null; then \
		echo "Port $(SERVER_PORT) already answers $(HEALTH_URL): another instance is running outside make." >&2; exit 1; \
	fi; \
	echo "=== $$(date '+%F %T') start ($(MODE)) ===" >> $(LOG_FILE); \
	setsid $(RUN_CMD) >> $(LOG_FILE) 2>&1 < /dev/null & echo $$! > $(PID_FILE); \
	echo -n "Starting $(MODE) (PID $$(cat $(PID_FILE)))"; \
	for i in $$(seq $(START_TIMEOUT)); do \
		if curl -fsS -o /dev/null --max-time 2 $(HEALTH_URL) 2>/dev/null; then \
			echo; echo "Ready: $(APP_URL)  (log: $(LOG_FILE))"; exit 0; \
		fi; \
		if ! $(is_running); then \
			echo; echo "Process exited during startup. Last log lines:" >&2; tail -n 20 $(LOG_FILE) >&2; \
			rm -f $(PID_FILE); exit 1; \
		fi; \
		echo -n "."; sleep 1; \
	done; \
	echo; echo "Still not answering $(HEALTH_URL) after $(START_TIMEOUT)s; check $(LOG_FILE)." >&2; exit 1

stop: ## Stop the background server (MODE=prod|dev)
	@if ! $(is_running); then \
		echo "Not running ($(MODE))."; rm -f $(PID_FILE); exit 0; \
	fi; \
	pid=$$(cat $(PID_FILE)); \
	echo -n "Stopping $(MODE) (PID $$pid)"; \
	kill -TERM -- -$$pid 2>/dev/null || kill -TERM $$pid; \
	for i in $$(seq $(STOP_TIMEOUT)); do \
		if ! kill -0 $$pid 2>/dev/null; then echo; echo "Stopped."; rm -f $(PID_FILE); exit 0; fi; \
		echo -n "."; sleep 1; \
	done; \
	echo; echo "No exit after $(STOP_TIMEOUT)s, sending SIGKILL."; \
	kill -KILL -- -$$pid 2>/dev/null || kill -KILL $$pid; rm -f $(PID_FILE)

restart: ## Stop, then start again (MODE=prod|dev)
	@$(MAKE) --no-print-directory stop
	@$(MAKE) --no-print-directory start

status: ## Show process and health state for both modes
	@for m in prod dev; do \
		f=$(RUN_DIR)/$$m.pid; \
		if [ -f $$f ] && kill -0 "$$(cat $$f)" 2>/dev/null; then \
			echo "$$m: running (PID $$(cat $$f), log $(RUN_DIR)/$$m.log)"; \
		elif [ -f $$f ]; then \
			echo "$$m: stale PID file $$f (process gone)"; \
		else \
			echo "$$m: stopped"; \
		fi; \
	done; \
	if command -v systemctl >/dev/null && [ -f $(UNIT_FILE) ]; then \
		echo "service $(SERVICE_NAME): $$(systemctl is-active $(SERVICE_NAME)), $$(systemctl is-enabled $(SERVICE_NAME)) at boot"; \
		if [ "$(SERVICE_HEALTH_URL)" != "$(HEALTH_URL)" ]; then \
			body=$$(curl -fsS --max-time 2 $(SERVICE_HEALTH_URL) 2>/dev/null) || body="not answering"; \
			echo "service health: $(SERVICE_HEALTH_URL) -> $$body"; \
		fi; \
	fi; \
	if body=$$(curl -fsS --max-time 2 $(HEALTH_URL) 2>/dev/null); then \
		echo "health: $(HEALTH_URL) -> $$body"; \
	else \
		echo "health: $(HEALTH_URL) not answering"; \
	fi

logs: ## Follow the log of the selected MODE
	@[ -f $(LOG_FILE) ] || { echo "No log yet: $(LOG_FILE)"; exit 1; }
	tail -n 50 -f $(LOG_FILE)

dev: ## Run the dev stack in the foreground (Ctrl+C to stop)
	npm run dev

test: ## Backend tests
	npm test

test-client: ## Frontend tests
	npm run test:client

lint: ## oxlint on src/ and server/
	npm run lint

typecheck: ## TypeScript check for frontend and backend
	npm run typecheck

check: lint typecheck test test-client ## Lint, typecheck and all tests

# ----------------------------------------------------------------------------
# systemd service (production build only)

service-unit: ## Print the systemd unit service-install would write
	@echo "# $(UNIT_FILE)"
	@printf '%s\n' "$$UNIT_CONTENT" | sed '/^$$/N;/^\n$$/D'

service-install: ensure-build ## Install, enable and start the systemd service
	@command -v systemctl >/dev/null && [ -d /run/systemd/system ] || \
		{ echo "systemd is not running on this machine." >&2; exit 1; }
	@[ -n "$(SERVICE_HOME)" ] || { echo "User '$(SERVICE_USER)' does not exist." >&2; exit 1; }
	@[ -x "$(NODE_BIN)" ] || { echo "node not found; pass NODE_BIN=/path/to/node." >&2; exit 1; }
	@$(SUDO) runuser -u $(SERVICE_USER) -- test -x $(NODE_BIN) || \
		{ echo "$(SERVICE_USER) cannot execute $(NODE_BIN); install node for that user or pass NODE_BIN." >&2; exit 1; }
	@$(SUDO) runuser -u $(SERVICE_USER) -- test -r dist-server/server/index.js || \
		{ echo "$(SERVICE_USER) cannot read $(CURDIR)." >&2; exit 1; }
	@if [ "$(or $(SERVICE_PORT),$(SERVER_PORT))" = "$(SERVER_PORT)" ] && [ -f $(RUN_DIR)/prod.pid ] && kill -0 "$$(cat $(RUN_DIR)/prod.pid)" 2>/dev/null; then \
		echo "A 'make start' production server is running on the same port; run 'make stop' first." >&2; exit 1; \
	fi
	@[ "$(SERVICE_USER)" != root ] || echo "Warning: the service will run as root; a dedicated user is safer."
	@printf '%s\n' "$$UNIT_CONTENT" | sed '/^$$/N;/^\n$$/D' | $(SUDO) tee $(UNIT_FILE) >/dev/null
	@echo "Wrote $(UNIT_FILE)"
	$(SUDO) systemctl daemon-reload
	$(SUDO) systemctl enable $(SERVICE_NAME)
	$(SUDO) systemctl restart $(SERVICE_NAME)
	@$(MAKE) --no-print-directory service-wait

service-uninstall: ## Stop, disable and remove the systemd service
	@[ -f $(UNIT_FILE) ] || { echo "$(UNIT_FILE) not installed."; exit 0; }
	-$(SUDO) systemctl disable --now $(SERVICE_NAME)
	$(SUDO) rm -f $(UNIT_FILE)
	$(SUDO) systemctl daemon-reload

service-start: ## Start the systemd service
	$(SUDO) systemctl start $(SERVICE_NAME)
	@$(MAKE) --no-print-directory service-wait

service-stop: ## Stop the systemd service
	$(SUDO) systemctl stop $(SERVICE_NAME)

service-restart: ## Restart the systemd service (after `make build`)
	$(SUDO) systemctl restart $(SERVICE_NAME)
	@$(MAKE) --no-print-directory service-wait

service-status: ## systemctl status of the service
	@systemctl status $(SERVICE_NAME) --no-pager || true

service-logs: ## Follow the service journal
	$(SUDO) journalctl -u $(SERVICE_NAME) -n 50 -f

git-identity: ## Set git user.name/user.email of SERVICE_USER from GIT_USER_NAME/GIT_USER_EMAIL in .env
	@if [ -z "$(GIT_USER_NAME)" ] || [ -z "$(GIT_USER_EMAIL)" ]; then \
		echo "GIT_USER_NAME/GIT_USER_EMAIL not set in .env; git identity left unchanged."; exit 0; \
	fi; \
	git_as_user() { $(SUDO) runuser -u $(SERVICE_USER) -- env HOME=$(SERVICE_HOME) git config --global "$$@"; }; \
	git_as_user user.name "$(GIT_USER_NAME)" && git_as_user user.email "$(GIT_USER_EMAIL)" && \
	echo "git identity of $(SERVICE_USER): $(GIT_USER_NAME) <$(GIT_USER_EMAIL)>"

# Waits for /health so service-* targets report real readiness, not just "started".
service-wait:
	@echo -n "Waiting for $(SERVICE_HEALTH_URL)"; \
	for i in $$(seq $(START_TIMEOUT)); do \
		if curl -fsS -o /dev/null --max-time 2 $(SERVICE_HEALTH_URL) 2>/dev/null; then echo; echo "Ready."; exit 0; fi; \
		if systemctl is-failed --quiet $(SERVICE_NAME); then \
			echo; echo "Service failed. Recent journal:" >&2; $(SUDO) journalctl -u $(SERVICE_NAME) -n 20 --no-pager >&2; exit 1; \
		fi; \
		echo -n "."; sleep 1; \
	done; \
	echo; echo "Not answering after $(START_TIMEOUT)s; see 'make service-logs'." >&2; exit 1

# ----------------------------------------------------------------------------
# Remote node over SSH. The working tree (including uncommitted changes) is
# copied with rsync, then built and run as the systemd service on the remote,
# by this same Makefile. Native modules are compiled there, for its platform.

# SSH destination, e.g. root@192.168.1.10. Required by every remote-* target.
REMOTE      ?=
REMOTE_DIR  ?= /opt/claudecodeui
# Extra ssh options, e.g. "-p 2222 -i ~/.ssh/node_key".
SSH_OPTS    ?=
# Allocates a terminal so sudo on the remote can ask for a password.
SSH_TTY     ?= -t
# service settings given on this command line are forwarded to the remote make;
# the rest default on the remote side (SERVICE_USER = the SSH user there).
REMOTE_MAKE_VARS := $(foreach v,SERVICE_NAME SERVICE_USER SERVICE_PORT NODE_BIN,$(if $(filter command line,$(origin $(v))),$(v)=$($(v))))
# Non-interactive SSH shells skip ~/.bashrc, so load nvm explicitly when present.
REMOTE_INIT := export NVM_DIR="$$HOME/.nvm"; [ -s "$$NVM_DIR/nvm.sh" ] && . "$$NVM_DIR/nvm.sh";
# $(call remote_run,<command>) runs <command> in REMOTE_DIR on the remote.
remote_run = ssh $(SSH_OPTS) $(SSH_TTY) $(REMOTE) '$(REMOTE_INIT) cd $(REMOTE_DIR) && { $(1); }'
# $(call remote_env_set,KEY,value): replace KEY in the remote .env (ending it with a newline first).
remote_env_set = { tail -c1 .env | read -r _ || echo >> .env; } && sed -i "/^$(1)=/d" .env && echo "$(1)=$(2)" >> .env
# Copies the git identity from the local .env into the remote one and applies it
# there; a no-op when the local .env does not define it.
REMOTE_GIT_IDENTITY = $(if $(and $(GIT_USER_NAME),$(GIT_USER_EMAIL)),$(call remote_env_set,GIT_USER_NAME,$(GIT_USER_NAME)) && $(call remote_env_set,GIT_USER_EMAIL,$(GIT_USER_EMAIL)) && make --no-print-directory git-identity $(REMOTE_MAKE_VARS) &&)

require-remote:
	@[ -n "$(REMOTE)" ] || { echo "Set REMOTE, e.g. make $(MAKECMDGOALS) REMOTE=root@192.168.1.10" >&2; exit 1; }

remote-check: require-remote ## Check SSH access and prerequisites on REMOTE
	@ssh $(SSH_OPTS) $(REMOTE) '$(REMOTE_INIT) \
		ok=1; \
		check() { if command -v "$$1" >/dev/null; then printf "  %-10s %s\n" "$$1" "$$($$2 2>&1 | head -n 1)"; else printf "  %-10s MISSING\n" "$$1"; ok=0; fi; }; \
		echo "$$(id -un)@$$(hostname): $$(uname -sm)"; \
		check node "node -v"; check npm "npm -v"; check make "make -v"; check rsync "rsync --version"; check curl "curl -V"; check git "git --version"; \
		node -e "process.exit(+process.versions.node.split(\".\")[0] >= 22 ? 0 : 1)" 2>/dev/null || { echo "  node 22+ required"; ok=0; }; \
		if [ -d /run/systemd/system ]; then echo "  systemd    running"; else echo "  systemd    not running"; ok=0; fi; \
		for cli in claude codex cursor-agent opencode; do command -v $$cli >/dev/null && echo "  agent CLI  $$cli"; done; \
		[ $$ok = 1 ] && echo "Ready." || { echo "Missing prerequisites."; exit 1; }'

remote-sync: require-remote ## Copy the working tree to REMOTE_DIR (keeps the remote .env, node_modules, builds and databases)
	@mkdir -p $(RUN_DIR)
	@# Skip what git ignores and does not track (node_modules, local builds, logs...).
	@# Not rsync's .gitignore filter: it would also drop tracked files that match an
	@# ignore pattern, such as the tasks.json translation files.
	@git ls-files -z --others --ignored --exclude-standard --directory | tr '\0' '\n' | sed 's|^|/|' > $(RUN_DIR)/rsync-exclude
	@# Excluded paths are also protected from --delete, which keeps the remote's own state.
	rsync -az --delete --info=stats1 \
		--rsync-path="mkdir -p $(REMOTE_DIR) && rsync" \
		-e "ssh $(SSH_OPTS)" \
		--exclude-from=$(RUN_DIR)/rsync-exclude \
		--exclude=/node_modules/ --exclude=/dist/ --exclude='/dist-server*/' --exclude=/.run/ --exclude=/.env \
		--exclude='*.db' --exclude='*.db-shm' --exclude='*.db-wal' \
		./ $(REMOTE):$(REMOTE_DIR)/

remote-install: remote-check remote-sync ## First install on REMOTE: sync, npm install, build, systemd service
	$(call remote_run,[ -f .env ] || { cp .env.example .env && echo "Created .env from .env.example"; }; \
		$(REMOTE_GIT_IDENTITY) npm install && make build && make service-install $(REMOTE_MAKE_VARS))

remote-deploy: remote-sync ## Update REMOTE: sync, npm install, build, restart the service
	$(call remote_run,$(REMOTE_GIT_IDENTITY) npm install && make build && make service-restart $(REMOTE_MAKE_VARS))

remote-git-identity: require-remote ## Copy GIT_USER_NAME/GIT_USER_EMAIL from .env to REMOTE and apply them
	@[ -n "$(GIT_USER_NAME)" ] && [ -n "$(GIT_USER_EMAIL)" ] || { echo "Set GIT_USER_NAME and GIT_USER_EMAIL in .env first." >&2; exit 1; }
	$(call remote_run,$(REMOTE_GIT_IDENTITY) true)

remote-start: require-remote ## Start the service on REMOTE
	$(call remote_run,make service-start $(REMOTE_MAKE_VARS))

remote-stop: require-remote ## Stop the service on REMOTE
	$(call remote_run,make service-stop $(REMOTE_MAKE_VARS))

remote-restart: require-remote ## Restart the service on REMOTE
	$(call remote_run,make service-restart $(REMOTE_MAKE_VARS))

remote-status: require-remote ## Service and health state on REMOTE
	@$(call remote_run,make --no-print-directory status $(REMOTE_MAKE_VARS))

remote-logs: require-remote ## Follow the service journal on REMOTE
	$(call remote_run,make service-logs $(REMOTE_MAKE_VARS))

remote-uninstall: require-remote ## Remove the service on REMOTE (files in REMOTE_DIR are kept)
	$(call remote_run,make service-uninstall $(REMOTE_MAKE_VARS))

remote-ssh: require-remote ## Open a shell in REMOTE_DIR on REMOTE
	ssh $(SSH_OPTS) -t $(REMOTE) 'cd $(REMOTE_DIR) && exec $$SHELL -l'
