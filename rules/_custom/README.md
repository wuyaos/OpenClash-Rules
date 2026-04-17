# Local Patch Files for `scripts/sync-ruleset.js`

Use this directory to keep local custom changes after upstream sync.

## File naming

- `rules/_custom/<source-name>.append.list`
- `rules/_custom/<source-name>.remove.list`

Current `<source-name>` values:

- `app-mutated`
- `game-mutated`
- `awavenue-ads`

## Behavior

- `remove.list`: remove exact matched lines from synced output first.
- `append.list`: append custom lines, then de-duplicate.
- Empty lines and lines starting with `#` or `;` are ignored.

## Example

For `awavenue-ads`:

- `rules/_custom/awavenue-ads.remove.list`
- `rules/_custom/awavenue-ads.append.list`

Each file uses one rule per line, e.g.:

```text
DOMAIN,example.com
DOMAIN-SUFFIX,example.org
```
