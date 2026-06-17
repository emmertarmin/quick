# Quick CLI

Quick's CLI deploys and manages static sites on a Quick server.

During local development in this monorepo, run commands with:

```sh
bun cli <command>
```

When installed as the package binary, the command name is:

```sh
quick <command>
```

## Global options

These options are accepted on every command path:

- `--help`, `-h` — show help for the current command.
- `--version`, `-v` — print the installed CLI version.

Examples:

```sh
quick --help
quick deploy --help
quick --version
```

## Remote resolution

Commands that talk to a Quick server resolve the remote in this order:

1. `--remote <url>`
2. `QUICK_REMOTE`
3. `quick config set remote <url>`
4. `QUICK_DOMAIN`, optionally with `QUICK_SCHEME` (defaults to `https`)

Remote URLs must use `http` or `https`. Query strings, hashes, and trailing slashes are normalized away.

## Configuration files

The CLI stores config using the XDG config directory:

- Config: `$XDG_CONFIG_HOME/quick/config.json`, or `~/.config/quick/config.json`
- Auth state: same directory, `auth.json`

Auth state is written with `0600` permissions where supported.

## Commands

### `quick auth`

Manage authentication.

```sh
quick auth <subcommand>
```

#### `quick auth login`

Log in to a Quick server with a browser-based OpenAuth flow.

```sh
quick auth login [--remote <url>]
```

The CLI starts a temporary local callback server, opens your browser, exchanges the authorization code, verifies the session, and saves auth state.

#### `quick auth status`

Show whether the CLI is logged in to the resolved remote.

```sh
quick auth status [--remote <url>]
quick auth whoami [--remote <url>]
```

If the server returns refreshed tokens, they are saved automatically.

#### `quick auth logout`

Delete local auth state.

```sh
quick auth logout
```

### `quick config`

Inspect and update CLI config.

```sh
quick config
```

With no subcommand, this prints the config file path and the current config JSON.

#### `quick config get`

Print all config values or a single key.

```sh
quick config get
quick config get remote
```

Currently supported key: `remote`.

#### `quick config set`

Set a config value.

```sh
quick config set remote https://quick.example.com
```

Currently supported key: `remote`.

#### `quick config path`

Print the config file path.

```sh
quick config path
```

### `quick deploy`

Package a static site directory and upload it to a Quick server.

```sh
quick deploy [options] <dir> <site>
```

Arguments:

- `<dir>` — directory containing static site files. It must exist and contain `index.html`.
- `<site>` — site name. Use lowercase letters, numbers, and hyphens; it must start and end with a letter or number and can be up to 63 characters.

Options:

- `--remote <url>` — override the resolved Quick server URL.
- `--dry-run` — validate and package the site without uploading.

Examples:

```sh
quick deploy . fun
quick deploy ./site fun --remote https://quick.example.com
quick deploy ./site fun --dry-run
```

Deploy creates a gzipped tar archive of the directory and sends it to the server. You must be logged in to the same remote first:

```sh
quick auth login --remote https://quick.example.com
```

If the target site already exists, the server may return a conflict. In an interactive terminal, the CLI asks you to type the site name to confirm overwrite.

On success, the CLI prints the deployed site name, file count, and URL.

### `quick help`

Show top-level help or help for a command path.

```sh
quick help
quick help deploy
quick help auth login
```

Alias: `quick h`.

### `quick version`

Print the installed CLI version.

```sh
quick version
quick --version
quick v
```
