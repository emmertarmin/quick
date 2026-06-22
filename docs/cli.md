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
2. `remote` in repo-local `.quick.json`
3. `QUICK_REMOTE`
4. `quick config set remote <url>`
5. `QUICK_DOMAIN`, optionally with `QUICK_SCHEME` (defaults to `https`)

Remote URLs must use `http` or `https`. Query strings, hashes, and trailing slashes are normalized away.

## Configuration files

The CLI stores global config using the XDG config directory:

- Config: `$XDG_CONFIG_HOME/quick/config.json`, or `~/.config/quick/config.json`
- Auth state: same directory, `auth.json`

Auth state is written with `0600` permissions where supported.

A repo may also contain `.quick.json`. `quick init` creates a minimal file with only `$schema` and `site`; add other defaults explicitly when you want commands to infer them:

```json
{
  "$schema": "https://quick.example.com/api/schemas/quick.schema.json",
  "site": "gallery",
  "remote": "https://quick.example.com",
  "deploy": {
    "input": "dist",
    "confirmOverwrite": true
  },
  "thumbnail": {
    "capture": {
      "format": "webp",
      "output": ".quick/thumbnail.webp"
    }
  }
}
```

The schema is served by each Quick server at `/api/schemas/quick.schema.json`.

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

### `quick init`

Initialize a Quick site directory.

```sh
quick init [path]
```

Arguments:

- `[path]` — directory to initialize. Defaults to the current working directory.

`quick init` writes a minimal `.quick.json` containing `$schema` and `site`, verifies the site name, and installs the Quick agent skillfile under `.agents/skills/quick/SKILL.md`.

Examples:

```sh
quick init
quick init ./site
```

### `quick deploy`

Package a static site directory and upload it to a Quick server.

```sh
quick deploy [options] [dir] [site]
```

Arguments:

- `[dir]` — directory containing static site files. It must exist and contain `index.html`. If omitted, Quick reads `deploy.input` from repo-local `.quick.json`.
- `[site]` — site name. Use lowercase letters, numbers, and hyphens; it must start and end with a letter or number and can be up to 63 characters. If omitted, Quick reads `site` from repo-local `.quick.json`.

A single positional argument is always interpreted as `[dir]`, not `[site]`. To deploy a configured input to a different site, pass both arguments, for example `quick deploy . fun`.

Options:

- `--remote <url>` — override the resolved Quick server URL.
- `--dry-run` — validate and package the site without uploading.

Examples:

```sh
quick deploy
quick deploy .
quick deploy . fun
quick deploy ./site fun --remote https://quick.example.com
quick deploy ./site fun --dry-run
```

Deploy creates a gzipped tar archive of the directory and sends it to the server. You must be logged in to the same remote first:

```sh
quick auth login --remote https://quick.example.com
```

If the target site already exists, the server may return a conflict. In an interactive terminal, the CLI asks you to type the site name to confirm overwrite. Set `deploy.confirmOverwrite` to `true` in `.quick.json` only for repos where overwriting that site should be the default.

On success, the CLI prints the deployed site name, file count, and URL.

### `quick thumbnail`

Capture and upload site thumbnail images.

```sh
quick thumbnail <subcommand>
```

#### `quick thumbnail capture`

Capture an authenticated 4:3 screenshot for one or more sites.

```sh
quick thumbnail capture [options] [site...]
```

If `[site...]` is omitted, Quick reads `site` from repo-local `.quick.json`. Repo config can also set `thumbnail.capture.format` and `thumbnail.capture.output`.

Options:

- `--remote <url>` — override the resolved Quick server URL.
- `--output webp|png` — image format. Defaults to `webp`, unless configured.
- `--file <path>` — output file path. Only valid when capturing one site.

Examples:

```sh
quick thumbnail capture
quick thumbnail capture gallery
quick thumbnail upload gallery ~/.local/share/quick/thumbnails/gallery.webp
```

#### `quick thumbnail upload`

Upload a selected thumbnail image.

```sh
quick thumbnail upload [options] <site> <file>
```

Options:

- `--remote <url>` — override the resolved Quick server URL.
- `--yes`, `-y` — upload without interactive confirmation.

### `quick purge`

Permanently delete a site from a Quick server.

```sh
quick purge [options] <site>
```

Purging removes the deployed `sites/<site>` source folder, uploaded blobs under `files/<site>`, database documents, and deploy metadata. The CLI warns that this cannot be undone and requires you to type the exact site name in an interactive terminal before it sends the request.

Options:

- `--remote <url>` — override the resolved Quick server URL.

Example:

```sh
quick purge todo
```

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
